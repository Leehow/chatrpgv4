"""#78: a loop rewind moves the world clock back to the anchor, but the per-investigator
engine snapshots under `save/` are not in `RESET_FACETS` and are never rewritten.

`worldline.reset_world` restores `world.json` (clock included, under the default
`reset.clock = anchor`) and `worldline.reset_sheets` restores `party/<inv>.json`. Nothing
touches `save/sanity-state/<inv>.json`, `save/magic-state/<inv>.json` or
`save/healing-state/<inv>.json`, and those files hold their deadlines as *absolute* clock
minutes (`recovery_trigger.due_elapsed_minutes`, `studying_spells[].due_elapsed_minutes`,
`wound_ledger[].occurred_elapsed_minutes`). A rewind therefore leaves every one of them
pointing at a minute the new loop has not reached and will not reach for as long as the
line it came from had already run.

The two tests that name the defect are `xfail(strict=True)`: they assert the invariant a
fix must restore, whichever of the two fixes is chosen (reset the engine snapshots with
the anchor, or store the deadlines as offsets from it), so they turn into XPASS the moment
either lands. The `clock: keep` test passes today and guards the path that is already
sound -- it is the control that shows the clock rewind, not the fork, is what strands a
deadline."""

from __future__ import annotations

import pytest
from conftest import (RpcClient, campaign_dir, create_campaign, narrate, narrate_opening,
                      read_json)
from test_rules_families import CONFRONTATION_PATH, resolve
from test_worldline import loop_content

INVESTIGATOR = "thomas-hayes"
#: How long the first loop runs before the investigator goes temporarily insane. Any
#: number larger than the 1D10 hours of p.176 makes the stranding visible.
ELAPSED = 480


def sanity_state(client) -> dict:
    return read_json(campaign_dir(client.workspace) / "save" / "sanity-state" / f"{INVESTIGATOR}.json")


def world_of(client) -> dict:
    return read_json(campaign_dir(client.workspace) / "world.json")


def clock_of(client) -> int:
    return int((world_of(client).get("clock") or {}).get("minutes") or 0)


def sheet_of(client) -> dict:
    return read_json(campaign_dir(client.workspace) / "party" / f"{INVESTIGATOR}.json")


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


def rewind(client) -> None:
    """One turn that asks the module's loop to rewind to its anchor."""
    client.table("player_input", text="我要回到今天早上。")
    client.table("apply", call_id="t2-c1", effects=[{"kind": "fork", "name": "loop-2", "mode": "loop"}])
    narrate(client, "t2-c2", "你眼前一黑，又回到了诺特的办公室。")


@pytest.mark.xfail(strict=True, reason="#78: the rewind moves the clock but not the engine snapshots")
def test_a_rewind_never_leaves_a_deadline_further_away_than_its_own_rule(tmp_path):
    """p.176 prices temporary insanity at 1D10 hours. After a rewind the investigator must
    owe at most those hours -- either the madness went back with the clock, or its deadline
    did. Owing the abandoned loop's elapsed time on top of them is neither."""
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


@pytest.mark.xfail(strict=True, reason="#78: the engine snapshot outlives the sheet the anchor restored")
def test_a_rewind_leaves_the_sheet_and_the_sanity_engine_saying_the_same_thing(tmp_path):
    """`reset_sheets` puts the anchor's SAN back on the sheet, but the sanity engine keeps
    its own number in `save/`; the next SAN check reads the engine's and writes it back
    over the sheet, so the restoration lasts exactly until the investigator looks at
    something."""
    client = RpcClient(tmp_path / "ws", content=loop_content(tmp_path), env={"COC_KERNEL_SEED": "1"})
    try:
        play_into_temporary_insanity(client)
        rewind(client)

        assert sheet_of(client)["current_san"] == 55  # the anchor's, restored
        assert sanity_state(client)["san_current"] == sheet_of(client)["current_san"]
        assert sanity_state(client)["temporary_insane"] is False
    finally:
        client.close()


def test_a_rewind_that_keeps_the_clock_keeps_every_deadline_reachable(tmp_path):
    """The control: with `reset.clock = keep` the clock does not move, so the absolute due
    the sanity engine saved is still the 1D10 hours away it was written to be. This is the
    path that is sound today, and it must stay sound under either fix."""
    content = loop_content(tmp_path, reset={"clock": "keep", "investigators": "anchor"})
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


def test_a_rewind_rewrites_the_world_and_the_sheets_and_no_engine_snapshot(tmp_path):
    """What the rewind actually writes, named: `world.json` and `party/`. Every engine
    snapshot under `save/` crosses the fork byte for byte, which is why the deadlines
    inside them are stranded. A fix that resets them changes this test on purpose."""
    client = RpcClient(tmp_path / "ws", content=loop_content(tmp_path), env={"COC_KERNEL_SEED": "1"})
    try:
        play_into_temporary_insanity(client)
        before_saves = engine_saves(client)
        before_sheet = sheet_of(client)
        assert set(before_saves) == {f"sanity-state/{INVESTIGATOR}.json",
                                     f"healing-state/{INVESTIGATOR}.json",
                                     f"mp-state/{INVESTIGATOR}.json"}

        rewind(client)

        assert engine_saves(client) == before_saves
        assert sheet_of(client) != before_sheet  # the sheet went back; the snapshots did not
    finally:
        client.close()
