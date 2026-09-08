"""#78: a loop rewind moves the world clock back to the anchor, while the per-investigator
engine snapshots under `save/` (`sanity-state`, `magic-state`, `healing-state`) file their
deadlines as *absolute* clock minutes (`recovery_trigger.due_elapsed_minutes`,
`studying_spells[].due_elapsed_minutes`, `wound_ledger[].occurred_elapsed_minutes`). Left
alone across a rewind, every one of them points at a minute the new loop will not reach for
as long as the abandoned line had already run.

Two halves, both fixed and both pinned here. Under the default `reset.investigators: anchor`
the engine snapshots are restored with the world and the sheets (`history.restore_tree`), so
a deadline either went back with the clock or was never there. Under `investigators: keep`
with `clock: anchor` -- the module saying the loop wears people down -- the snapshots stand
and each engine moves its own minutes (`rebase_clock`) by the clock's delta; a file under
`save/` whose engine has not said how its clock moves refuses the rewind by name, inside the
`apply` batch, and so does an engine whose state cannot be expressed on the new clock. The
`clock: keep` test is the control: nothing is rewound there, and nothing may be stranded."""

from __future__ import annotations

import json
from pathlib import Path

from conftest import (MODULE, RpcClient, campaign_dir, create_campaign, narrate, narrate_opening,
                      read_json)
from test_rules_families import CONFRONTATION_PATH, resolve, resolve_err
from test_worldline import loop_content, meta_of

INVESTIGATOR = "thomas-hayes"
#: How long the first loop runs before the investigator goes temporarily insane. Any
#: number larger than the 1D10 hours of p.176 makes the stranding visible.
ELAPSED = 480


def sanity_state(client) -> dict:
    """The sanity engine's own state, or `{}` when it has none.

    Empty is a real answer after a rewind: the anchor commit predates the investigator's
    first SAN check, so restoring `save/` to it *removes* the file. The engine then has no
    opinion of its own and the next load seeds it from the sheet -- which is exactly the
    agreement these tests are about."""
    path = campaign_dir(client.workspace) / "save" / "sanity-state" / f"{INVESTIGATOR}.json"
    return read_json(path) if path.exists() else {}


def world_of(client) -> dict:
    return read_json(campaign_dir(client.workspace) / "world.json")


def clock_of(client) -> int:
    return int((world_of(client).get("clock") or {}).get("minutes") or 0)


def sheet_of(client) -> dict:
    return read_json(campaign_dir(client.workspace) / "party" / f"{INVESTIGATOR}.json")


def healing_state(client) -> dict:
    path = campaign_dir(client.workspace) / "save" / "healing-state" / f"{INVESTIGATOR}.json"
    return read_json(path) if path.exists() else {}


def loop_content_anchored_at(tmp_path: Path, scene: str, *, reset: dict) -> Path:
    """`loop_content` with its `resets-to` pointed at `scene` instead of the briefing, so the
    anchor is a turn the party reaches after the clock has run: the anchor's own minute is
    then above zero, and a wound younger than it fits on the rewound clock."""
    root = loop_content(tmp_path, reset=reset)
    path = root / "starters" / MODULE / "module-graph.json"
    graph = json.loads(path.read_text(encoding="utf-8"))
    for relation in graph["relations"]:
        if relation["relation_kind"] == "resets-to":
            relation["to_node_id"] = f"scene-{scene}"
    path.write_text(json.dumps(graph, ensure_ascii=False), encoding="utf-8")
    return root


def engine_saves(client) -> dict[str, str]:
    """Every per-investigator engine snapshot on disk, by path. `worldlines/` and
    `continuation/` are the loop machinery's own files and are excluded."""
    root = campaign_dir(client.workspace) / "save"
    return {str(path.relative_to(root)): path.read_text(encoding="utf-8")
            for path in sorted(root.rglob("*")) if path.is_file()
            and path.parts[-2] not in ("worldlines", "continuation")}


def play_into_temporary_insanity(client) -> None:
    """Open the table, spend `ELAPSED` minutes of the first loop, walk to Corbitt and fail
    the SAN check his profile prices at 1/1D8. Leaves the turn open."""
    create_campaign(client)
    narrate_opening(client)
    client.table("player_input", text="我们花了一整天打听，然后去老宅。")
    client.table("apply", call_id="t1-c1", effects=[{"kind": "time", "minutes": ELAPSED}])
    for index, scene in enumerate(CONFRONTATION_PATH, start=2):
        client.table("apply", call_id=f"t1-c{index}", effects=[{"kind": "move", "to": scene}])
    ordinal = 2 + len(CONFRONTATION_PATH)
    checked = resolve(client, f"t1-c{ordinal}", intent="investigate", goal="看见科比特的尸体动了",
                      method="", target="Walter Corbitt", decision="sanity:check",
                      involuntary={"kind": "freeze", "summary": "手电筒的光柱僵在原地"})
    assert checked["outcome"]["temporary_insane"] is True
    ordinal += 1
    # The bout is a session; close it so the rewind is an ordinary effect batch.
    for _ in range(10):
        if not sanity_state(client).get("bout_active"):
            break
        resolve(client, f"t1-c{ordinal}", intent="montage", goal="等这阵过去", method="",
                decision="sanity:bout-end")
        ordinal += 1
    narrate(client, f"t1-c{ordinal}", "他坐了起来，你僵在原地。")


def rewind(client, turn: int = 2) -> None:
    """One turn that asks the module's loop to rewind to its anchor."""
    client.table("player_input", text="我要回到今天早上。")
    client.table("apply", call_id=f"t{turn}-c1", effects=[{"kind": "fork", "name": "loop-2", "mode": "loop"}])
    narrate(client, f"t{turn}-c2", "你眼前一黑，又回到了诺特的办公室。")


def test_a_rewind_never_leaves_a_deadline_further_away_than_its_own_rule(tmp_path):
    """p.176 prices temporary insanity at 1D10 hours. After a rewind the investigator must
    owe at most those hours -- either the madness went back with the clock, or its deadline
    did. Owing the abandoned loop's elapsed time on top of them is neither.

    The madness goes back: `save/` is restored to the anchor with the world and the sheets."""
    client = RpcClient(tmp_path / "ws", content=loop_content(tmp_path), env={"COC_KERNEL_SEED": "1"})
    try:
        play_into_temporary_insanity(client)
        before = sanity_state(client)
        budget = int(before["temporary_insane_remaining_hours"]) * 60
        assert before["recovery_trigger"]["due_elapsed_minutes"] == clock_of(client) + budget

        rewind(client)

        assert world_of(client)["active_scene"] == "commission-briefing"
        assert clock_of(client) == 0  # the default `reset.clock` is `anchor`
        trigger = sanity_state(client).get("recovery_trigger")
        owed = None if trigger is None else int(trigger["due_elapsed_minutes"]) - clock_of(client)
        assert owed is None or owed <= budget, (
            f"the rewind left {owed} minutes owed for a {budget}-minute madness")
    finally:
        client.close()


def test_a_rewind_leaves_the_sheet_and_the_sanity_engine_saying_the_same_thing(tmp_path):
    """The sheet and the engine must not come out of a rewind disagreeing.

    They used to: `reset_sheets` put the anchor's SAN back on the sheet while the engine kept
    its own number in `save/`, and the next check read the engine's and wrote it back over the
    sheet, so the restoration lasted exactly until the investigator looked at something. Two
    endings satisfy the invariant and the fix produces the second: the engine agrees with the
    sheet, or -- as here, the anchor predating the first check -- it has no state at all and
    the next load seeds it from the restored sheet."""
    client = RpcClient(tmp_path / "ws", content=loop_content(tmp_path), env={"COC_KERNEL_SEED": "1"})
    try:
        play_into_temporary_insanity(client)
        rewind(client)

        state = sanity_state(client)
        assert sheet_of(client)["current_san"] == 55  # the anchor's, restored
        assert not state or state["san_current"] == sheet_of(client)["current_san"]
        assert not state.get("temporary_insane")
    finally:
        client.close()


def test_a_rewind_that_keeps_the_clock_keeps_every_deadline_reachable(tmp_path):
    """The control: with `reset.clock = keep` the clock does not move, so a deadline the
    engine saved is still the 1D10 hours away it was written to be -- and with
    `investigators = keep` the engine state it lives in stays too, because §15.2's `keep`
    means the table is left standing. Nothing is rewound here, and nothing may be stranded."""
    content = loop_content(tmp_path, reset={"clock": "keep", "investigators": "keep"})
    client = RpcClient(tmp_path / "ws", content=content, env={"COC_KERNEL_SEED": "1"})
    try:
        play_into_temporary_insanity(client)
        before = sanity_state(client)
        budget = int(before["temporary_insane_remaining_hours"]) * 60
        due = int(before["recovery_trigger"]["due_elapsed_minutes"])
        assert clock_of(client) == ELAPSED and due == ELAPSED + budget

        rewind(client)

        assert world_of(client)["active_scene"] == "commission-briefing"
        assert clock_of(client) == ELAPSED
        assert int(sanity_state(client)["recovery_trigger"]["due_elapsed_minutes"]) - clock_of(client) == budget
    finally:
        client.close()


def test_a_rewind_rewrites_the_world_the_sheets_and_the_engine_saves(tmp_path):
    """What the rewind actually writes, named: `world.json`, `party/`, and `save/`.

    The engine snapshots used to cross the fork byte for byte, which is what stranded the
    deadlines inside them. They now go back to the anchor with everyone else -- and going
    back to a commit made before the investigator's first check means those files are
    *removed*, not rewritten, which is the same statement: at the anchor they did not exist.
    `save/` is restored wholesale from the commit rather than file by file, so an engine
    added later is rewound without anyone remembering to list it."""
    client = RpcClient(tmp_path / "ws", content=loop_content(tmp_path), env={"COC_KERNEL_SEED": "1"})
    try:
        play_into_temporary_insanity(client)
        before_saves = engine_saves(client)
        before_sheet = sheet_of(client)
        assert set(before_saves) == {f"sanity-state/{INVESTIGATOR}.json",
                                     f"healing-state/{INVESTIGATOR}.json",
                                     f"mp-state/{INVESTIGATOR}.json"}

        rewind(client)

        assert engine_saves(client) == {}  # the anchor predates every one of them
        assert sheet_of(client) != before_sheet
        # The loop's own bookkeeping is not the fiction and does not rewind with it.
        assert (campaign_dir(client.workspace) / "save" / "worldlines").is_dir()
    finally:
        client.close()


def test_a_kept_investigator_does_not_owe_the_rewound_time(tmp_path):
    """The other half (§15.2 `investigators: keep` with `clock: anchor`).

    `keep` is how a module says the loop wears people down: the madness rides through the
    rewind on purpose, so the engine state is left standing -- and the clock is wound back out
    from under it. The deadline inside that state was an absolute minute of the old clock, so
    the investigator used to come out owing the abandoned loop's 480 minutes on top of the
    rule's own hours. Each engine now moves its own minutes with the clock: the madness is
    still there, the sheet and the engine still agree, the deadline is exactly the rule's
    hours away and its id names the moved minute -- and, the proof that counts, spending
    exactly those hours on the new clock brings the recovery due and lets it resolve."""
    content = loop_content(tmp_path, reset={"clock": "anchor", "investigators": "keep"})
    client = RpcClient(tmp_path / "ws", content=content, env={"COC_KERNEL_SEED": "1"})
    try:
        play_into_temporary_insanity(client)
        before = sanity_state(client)
        budget = int(before["temporary_insane_remaining_hours"]) * 60
        assert clock_of(client) == ELAPSED
        assert int(before["recovery_trigger"]["due_elapsed_minutes"]) == ELAPSED + budget

        rewind(client)

        assert world_of(client)["active_scene"] == "commission-briefing" and clock_of(client) == 0
        state = sanity_state(client)
        assert state["temporary_insane"] is True  # `keep`: the madness came through
        assert state["san_current"] == before["san_current"] == sheet_of(client)["current_san"]
        due = int(state["recovery_trigger"]["due_elapsed_minutes"])
        assert due - clock_of(client) == budget, f"owes {due - clock_of(client)} minutes for a {budget}-minute madness"
        assert state["recovery_trigger"]["trigger_id"] == f"recover-temporary:{INVESTIGATOR}:{due}"

        # The rule's own hours, spent on the new clock, are enough: the recovery falls due and resolves.
        client.table("player_input", text="我找个安全的地方等这阵过去。")
        early = resolve_err(client, "t3-c1", intent="montage", goal="缓过来", method="", decision="sanity:recover-temporary")
        assert early["code"] in ("needs", "turn_state")
        client.table("apply", call_id="t3-c2", effects=[{"kind": "time", "minutes": budget}])
        assert "sanity:recover-temporary" in {s["decision"] for s in client.table("look")["where"]["situations"]}
        recovered = resolve(client, "t3-c3", intent="montage", goal="缓过来", method="", decision="sanity:recover-temporary")
        assert recovered["outcome"]["recovered"] is True and recovered["outcome"]["temporary_insane"] is False
    finally:
        client.close()


def test_a_kept_rewind_is_refused_by_name_while_state_no_engine_can_move_is_on_the_table(tmp_path):
    """An engine that has not said how its clock moves is not presumed harmless.

    The engines are found by looking at the `coc.rules` package for `SAVE_PATHS` and
    `rebase_clock`, not by a list, so the only way to be an engine nobody taught is to write
    under `save/` without declaring it. This plants exactly that -- a file from an engine
    that does not exist -- and the fork is refused inside its batch, naming the file, before
    anything moves; with the file gone the same fork goes through and the kept deadline is
    moved by the clock's delta."""
    content = loop_content(tmp_path, reset={"clock": "anchor", "investigators": "keep"})
    client = RpcClient(tmp_path / "ws", content=content, env={"COC_KERNEL_SEED": "1"})
    try:
        play_into_temporary_insanity(client)
        stray = campaign_dir(client.workspace) / "save" / "tide-state" / f"{INVESTIGATOR}.json"
        stray.parent.mkdir()
        stray.write_text(json.dumps({"investigator_id": INVESTIGATOR, "due_elapsed_minutes": 700}), encoding="utf-8")
        before = sanity_state(client)

        client.table("player_input", text="我要回到今天早上。")
        error = client.table_err("apply", call_id="t2-c1", effects=[{"kind": "fork", "name": "loop-2", "mode": "loop"}])
        assert error["code"] == "not_implemented"
        assert f"save/tide-state/{INVESTIGATOR}.json" in error["message"]
        assert error["details"]["unclaimed"] == [f"save/tide-state/{INVESTIGATOR}.json"]
        assert error["details"]["refused"] == {}
        assert error["details"]["clock_delta"] == -ELAPSED  # the anchor's minute 0 minus the loop's 480
        # Nothing moved: same line, same clock, same deadline.
        assert meta_of(client)["active_worldline"] == "main"
        assert clock_of(client) == ELAPSED and sanity_state(client) == before

        stray.unlink()
        client.table("apply", call_id="t2-c2", effects=[{"kind": "fork", "name": "loop-2", "mode": "loop"}])
        narrate(client, "t2-c3", "你眼前一黑，又回到了诺特的办公室。")
        assert meta_of(client)["active_worldline"] == "loop-2" and clock_of(client) == 0
        assert int(sanity_state(client)["recovery_trigger"]["due_elapsed_minutes"]) == \
            int(before["recovery_trigger"]["due_elapsed_minutes"]) - ELAPSED
    finally:
        client.close()


def test_a_kept_rewind_is_refused_while_a_wound_predates_the_rewound_clock(tmp_path):
    """The healing engine's own limit, stated instead of hidden.

    A wound is filed as the minute it happened, and the first-aid hour and the weekly
    recovery baseline are measured from it. Rewound to the anchor's minute 0, a wound taken at
    minute 480 and rewound at minute 540 happened 60 minutes *before* the new loop began -- a
    minute the ledger's readers (`rules/graph.py`) do not accept, so the engine refuses rather
    than let the wound drop out of the first-aid hour or silence the weekly roll; clamping it
    to zero would re-open the first-aid hour on an old wound. The refusal names the wound and
    the shortfall, and nothing moves."""
    content = loop_content(tmp_path, reset={"clock": "anchor", "investigators": "keep"})
    client = RpcClient(tmp_path / "ws", content=content, env={"COC_KERNEL_SEED": "1"})
    try:
        play_into_temporary_insanity(client)  # the clock stands at ELAPSED
        client.table("player_input", text="我从楼梯上摔了下去。")
        client.table("apply", call_id="t2-c1", effects=[{"kind": "damage", "dice": "1D1", "why": "摔下楼梯"}])
        narrate(client, "t2-c2", "你摔得不轻。")
        wound = healing_state(client)["wound_ledger"][0]
        assert wound["occurred_elapsed_minutes"] == ELAPSED

        client.table("player_input", text="我撑了一个小时，然后想回到今天早上。")
        error = client.table_err("apply", call_id="t3-c1", effects=[{"kind": "time", "minutes": 60},
                                                                  {"kind": "fork", "name": "loop-2", "mode": "loop"}])
        assert error["code"] == "not_implemented"
        assert error["details"]["unclaimed"] == []
        path = f"save/healing-state/{INVESTIGATOR}.json"
        assert list(error["details"]["refused"]) == [path]
        reason = error["details"]["refused"][path]
        assert wound["wound_id"] in reason and "60 minutes before the clock's origin" in reason
        assert error["details"]["clock_delta"] == -(ELAPSED + 60)
        assert meta_of(client)["active_worldline"] == "main" and clock_of(client) == ELAPSED
    finally:
        client.close()


def test_a_kept_wound_younger_than_the_anchor_stays_exactly_as_old(tmp_path):
    """The healing ledger moves like the sanity deadline when it fits. With the anchor at the
    scene the party reached at minute 480, a wound taken at 480 and rewound from 540 is filed
    at 420 on the rewound clock -- sixty minutes old before, sixty minutes old after -- and the
    madness's deadline keeps its own distance too: both engines moved by the same delta, the
    anchor's minute minus the loop's."""
    content = loop_content_anchored_at(tmp_path, "corbitt-confrontation",
                                       reset={"clock": "anchor", "investigators": "keep"})
    client = RpcClient(tmp_path / "ws", content=content, env={"COC_KERNEL_SEED": "1"})
    try:
        play_into_temporary_insanity(client)  # turn 1 ends in the confrontation at ELAPSED: the anchor
        client.table("player_input", text="我从楼梯上摔了下去。")
        client.table("apply", call_id="t2-c1", effects=[{"kind": "damage", "dice": "1D1", "why": "摔下楼梯"}])
        narrate(client, "t2-c2", "你摔得不轻。")
        client.table("player_input", text="我撑了一个小时。")
        client.table("apply", call_id="t3-c1", effects=[{"kind": "time", "minutes": 60}])
        narrate(client, "t3-c2", "一个小时过去了。")
        assert clock_of(client) == ELAPSED + 60
        left_before = int(sanity_state(client)["recovery_trigger"]["due_elapsed_minutes"]) - clock_of(client)
        assert healing_state(client)["wound_ledger"][0]["occurred_elapsed_minutes"] == ELAPSED

        rewind(client, turn=4)

        assert world_of(client)["active_scene"] == "corbitt-confrontation" and clock_of(client) == ELAPSED
        wound = healing_state(client)["wound_ledger"][0]
        assert wound["occurred_elapsed_minutes"] == ELAPSED - 60  # sixty minutes old, as it was
        state = sanity_state(client)
        assert state["temporary_insane"] is True
        assert int(state["recovery_trigger"]["due_elapsed_minutes"]) - clock_of(client) == left_before
    finally:
        client.close()
