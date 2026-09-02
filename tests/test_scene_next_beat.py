"""The next-beat nudge must be reachable, and reachable in the scenes it is for.

`scene.context` computes a `recommended_next_beat` on every read, and its
comment promises the Keeper a forward nudge "without a separate director.advise
call". Neither half held:

* Nothing delivered it. One producer line, no consumer anywhere in the
  repository, and zero occurrences across every live playtest transcript — the
  RPC wire whitelist did not name it, so no Keeper has ever seen one.
* Its PRESSURE branch could not be reached in the scenes it was written for.
  The branch order is agenda NPC, then undiscovered clues, then pressure, and
  an authored climax always has an NPC with an agenda. Across ~30 live turns in
  `scene-church-climax` — whose dramatic question is literally "before the bell
  rings" — the beat was NPC_MOVE every single time while `clock-loop-doom` sat
  at 0/6 and the loop reset it gates stayed unreachable.

A lethal pressure move on a clock that is still running now outranks a routine
agenda beat. Lethality and the tick are authored facts, not a pacing opinion,
and the override records what it superseded so the choice stays auditable.
"""
from __future__ import annotations

import importlib.util
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


kernel = _load("coc_operation_kernel_next_beat_tests", SCRIPTS / "coc_operation_kernel.py")


LETHAL_MOVE = {
    "id": "pyre-lit", "cue": "火炬向柴堆逼近", "tick": 2,
    "clock_id": "clock-loop-doom", "lethal": True,
}
QUIET_MOVE = {"id": "ghost-manifests", "cue": "断骨伸向亵渎者", "tick": 0}
LIVE_CLOCK = {"clock_id": "clock-loop-doom", "full": False}
SPENT_CLOCK = {"clock_id": "clock-loop-doom", "full": True}


def _beat_source() -> str:
    """The ranking, read out of the producer rather than restated here."""
    text = (SCRIPTS / "coc_operation_kernel.py").read_text(encoding="utf-8")
    start = text.index('_next_beat: dict[str, Any] = {"action": "CONTINUE"')
    return text[start:text.index('data["recommended_next_beat"]', start)]


def _rank(pressure, clocks, *, agenda_npc=True):
    """Replay the producer's own override rule against one scene shape."""
    source = _beat_source()
    assert "superseded_action" in source, (
        "the lethal-pressure override is gone; the PRESSURE branch is "
        "unreachable again in any scene with an agenda NPC"
    )
    base = {"action": "NPC_MOVE" if agenda_npc else "CONTINUE"}
    live = {row["clock_id"] for row in clocks if not row["full"]}
    urgent = [
        move for move in pressure
        if move.get("lethal") is True and move.get("clock_id") in live
    ]
    if urgent and base["action"] != "PRESSURE":
        return {
            "action": "PRESSURE",
            "moves": urgent[:2],
            "superseded_action": base["action"],
        }
    return base


def test_the_producer_still_owns_the_override_this_test_replays():
    source = _beat_source()
    assert 'move.get("lethal") is True' in source
    assert 'move.get("clock_id") in _live_clocks' in source
    assert '"superseded_action"' in source


def test_a_lethal_move_on_a_running_clock_outranks_an_agenda_beat():
    beat = _rank([LETHAL_MOVE, QUIET_MOVE], [LIVE_CLOCK])
    assert beat["action"] == "PRESSURE"
    assert [move["id"] for move in beat["moves"]] == ["pyre-lit"]
    assert beat["superseded_action"] == "NPC_MOVE", (
        "the override must record what it displaced"
    )


def test_a_spent_clock_does_not_override():
    # Once the clock is full its consequence is already due; pressing the same
    # move again is not the urgent thing.
    assert _rank([LETHAL_MOVE], [SPENT_CLOCK])["action"] == "NPC_MOVE"


def test_a_non_lethal_move_does_not_override():
    assert _rank([QUIET_MOVE], [LIVE_CLOCK])["action"] == "NPC_MOVE"


def test_a_lethal_move_with_no_clock_does_not_override():
    orphan = {**LETHAL_MOVE, "clock_id": None}
    assert _rank([orphan], [LIVE_CLOCK])["action"] == "NPC_MOVE"


def test_the_beat_is_carried_to_the_table():
    """Reachability is the other half; a nudge nobody receives is not a nudge."""
    wire = (SCRIPTS / "coc_mcp_wire.py").read_text(encoding="utf-8")
    start = wire.index("def _compact_scene(")
    body = wire[start:wire.index("\ndef ", start + 1)]
    carried = (
        set(re.findall(r'"([a-z_]+)"', body[:body.index("# Where the main line")]))
        | set(re.findall(r'projected\["([a-z_]+)"\]\s*=', body))
    )
    assert "recommended_next_beat" in carried, (
        "the kernel computes a next beat on every scene read and the RPC path "
        "does not carry it, which is why no live transcript has ever contained "
        "one"
    )
