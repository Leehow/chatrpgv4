"""#78: each engine declares how its files under `save/` follow a moving clock --
`SAVE_PATHS` (what it writes there) and `rebase_clock(state, delta)` (that state with every
absolute clock minute moved by `delta`, the new clock minus the old) -- and the worldline
finds the engines by looking at the `coc.rules` package rather than by keeping a list.

These pin the pure functions and the convention. The product path -- a time loop with
`reset.investigators: keep` and `reset.clock: anchor` -- is `tests/kernel/test_worldline_due.py`.
"""

from __future__ import annotations

import copy
import random
import sys

import pytest
from conftest import CONTENT_DIR, KERNEL_DIR

sys.path.insert(0, str(KERNEL_DIR))

from coc import worldline  # noqa: E402
from coc.rules import healing, magic, mp, sanity  # noqa: E402
from coc.rules.sanity import SanitySession  # noqa: E402
from coc.rules.tables import RuleTables  # noqa: E402

INVESTIGATOR = "thomas-hayes"
ENGINES = (healing, magic, mp, sanity)


@pytest.fixture(scope="module")
def tables() -> RuleTables:
    return RuleTables(CONTENT_DIR / "rulesets" / "coc7" / "rules-json")


# ---- the convention -------------------------------------------------------------------------

def test_the_engines_are_found_by_looking_not_by_being_listed():
    found = worldline.clock_engines()
    for engine in ENGINES:
        assert engine in found
    for engine in found:
        assert isinstance(engine.SAVE_PATHS, tuple) and engine.SAVE_PATHS
        assert all(path.startswith("save/") and not path.endswith("/") for path in engine.SAVE_PATHS)
        assert callable(engine.rebase_clock)


@pytest.mark.parametrize("engine, path_of", [
    (healing, healing.healing_state_path), (magic, magic.magic_state_path), (mp, mp.mp_state_path),
    (sanity, sanity.sanity_snapshot_path), (sanity, sanity.sanity_gain_pending_path),
], ids=["healing", "magic", "mp", "sanity-snapshot", "sanity-gain-pending"])
def test_an_engine_writes_where_it_says_it_writes(engine, path_of, tmp_path):
    """The declaration and the writer share one constant, so a file an engine writes is a
    file the worldline can hand back to that engine."""
    written = path_of(tmp_path, INVESTIGATOR).relative_to(tmp_path).as_posix()
    assert any(written.startswith(claim + "/") for claim in engine.SAVE_PATHS), (written, engine.SAVE_PATHS)


# ---- sanity ---------------------------------------------------------------------------------

def test_sanity_moves_both_deadlines_and_the_reminted_ids_name_the_moved_minute():
    state = {
        "investigator_id": INVESTIGATOR, "temporary_insane": True, "temporary_insane_remaining_hours": 2,
        "recovery_trigger": {"trigger_id": sanity.recovery_trigger_id(INVESTIGATOR, 600),
                             "handler": "recover_temporary_insanity", "due_elapsed_minutes": 600,
                             "policy": "auto_apply_if_safe", "payload": {"condition": "temporary_insane"}},
        "treatment_trigger": {"trigger_id": sanity.treatment_trigger_id(INVESTIGATOR, 43680),
                              "due_elapsed_minutes": 43680},
        "events": [{"type": "recovery_trigger_scheduled", "payload": {"due_elapsed_minutes": 600}}],
    }
    before = copy.deepcopy(state)
    moved = sanity.rebase_clock(state, -480)
    assert state == before and moved is not state
    assert moved["recovery_trigger"]["due_elapsed_minutes"] == 120
    assert moved["recovery_trigger"]["trigger_id"] == f"recover-temporary:{INVESTIGATOR}:120"
    assert moved["recovery_trigger"]["handler"] == "recover_temporary_insanity"
    assert moved["recovery_trigger"]["payload"] == {"condition": "temporary_insane"}
    assert moved["treatment_trigger"] == {"trigger_id": f"apply-treatment:{INVESTIGATOR}:43200",
                                          "due_elapsed_minutes": 43200}
    assert moved["temporary_insane_remaining_hours"] == 2  # a length, not an instant
    assert moved["events"] == before["events"]  # the log says what was scheduled at the time


def test_sanity_reminting_matches_what_the_session_mints(tables):
    """The id the rebase writes is the id the session would have written for that minute:
    one helper mints both, so the two cannot drift into different shapes."""
    session = SanitySession(INVESTIGATOR, san_max=50, int_value=50, rng=random.Random(1),
                            tables=tables, clock_minutes=480)
    session._schedule_recovery_trigger(2)
    session._schedule_monthly_treatment_trigger()
    snapshot = session.snapshot()
    assert snapshot["recovery_trigger"]["trigger_id"] == sanity.recovery_trigger_id(INVESTIGATOR, 600)
    assert snapshot["treatment_trigger"]["trigger_id"] == sanity.treatment_trigger_id(INVESTIGATOR, 480 + 30 * 24 * 60)
    moved = sanity.rebase_clock(snapshot, -480)
    again = SanitySession(INVESTIGATOR, san_max=50, int_value=50, rng=random.Random(1),
                          tables=tables, clock_minutes=0)
    again._schedule_recovery_trigger(2)
    again._schedule_monthly_treatment_trigger()
    assert moved["recovery_trigger"] == again.snapshot()["recovery_trigger"]
    assert moved["treatment_trigger"] == again.snapshot()["treatment_trigger"]


def test_sanity_leaves_an_id_it_did_not_mint_and_lets_an_overdue_deadline_go_negative():
    state = {"investigator_id": INVESTIGATOR, "treatment_trigger": None,
             "recovery_trigger": {"trigger_id": "keeper-said-so", "due_elapsed_minutes": 500}}
    moved = sanity.rebase_clock(state, -600)
    assert moved["recovery_trigger"] == {"trigger_id": "keeper-said-so", "due_elapsed_minutes": -100}
    assert moved["treatment_trigger"] is None


def test_sanity_gain_pending_receipt_carries_no_clock_and_passes_through():
    receipt = {"schema_version": 1, "investigator_id": INVESTIGATOR, "san_gain": 3, "gain_source": "psychoanalysis"}
    assert sanity.rebase_clock(receipt, -480) == receipt


# ---- magic ----------------------------------------------------------------------------------

def test_magic_moves_a_study_due_and_nothing_else():
    state = {"investigator_id": INVESTIGATOR, "learned_spells": ["Elder Sign"], "cast_spells": ["Elder Sign"],
             "studying_spells": [
                 {"spell": "Contact Deity", "source": "tome", "source_ref": "tome-1", "study_weeks": 3,
                  "study_days": 21, "due_elapsed_minutes": 30720},
                 {"spell": "Dominate", "source": "person", "source_ref": None, "study_weeks": 0,
                  "study_days": 4, "due_elapsed_minutes": 300}]}
    before = copy.deepcopy(state)
    moved = magic.rebase_clock(state, -480)
    assert state == before and moved is not state
    assert [row["due_elapsed_minutes"] for row in moved["studying_spells"]] == [30240, -180]
    assert moved["studying_spells"][0]["study_days"] == 21 and moved["learned_spells"] == ["Elder Sign"]
    # A study that had completed on the abandoned loop is still complete on the new clock, and
    # one still running has the same days left.
    assert magic.known_spells(before, 480) == ["Elder Sign", "Dominate"]
    assert magic.known_spells(moved, 0) == ["Elder Sign", "Dominate"]
    assert 30720 - 480 == 30240 - 0


# ---- healing --------------------------------------------------------------------------------

def test_healing_moves_the_wound_and_the_attempt_by_the_delta():
    state = {"investigator_id": INVESTIGATOR, "current_hp": 5, "conditions": ["major_wound"],
             "healing_usage": {"active_wound_id": "active-wound", "active_day_id": "day-0", "records": {}},
             "wound_ledger": [{"wound_id": "wound-t2-c1", "source_damage_roll_id": None,
                               "occurred_elapsed_minutes": 480, "status": "active"}],
             "major_wound_recovery_ledger": [{"wound_id": "wound-t2-c1", "attempt_elapsed_minutes": 10560}]}
    before = copy.deepcopy(state)
    moved = healing.rebase_clock(state, -60)
    assert state == before and moved is not state
    assert moved["wound_ledger"][0]["occurred_elapsed_minutes"] == 420
    assert moved["major_wound_recovery_ledger"][0]["attempt_elapsed_minutes"] == 10500
    assert moved["healing_usage"] == before["healing_usage"] and moved["conditions"] == ["major_wound"]


def test_healing_carries_a_wound_older_than_the_clocks_origin():
    """A wound taken before the anchor lands before minute zero, and that is honest.

    This engine used to refuse such a rewind, because `rules/graph.py` dropped a negative
    stamp as corruption and the wound would have vanished from the first-aid hour and the
    weekly-recovery fact without a word. Those readers now accept a minute before the origin
    (the clock itself still may not go negative), so the stamp simply moves: `now - occurred`
    goes on saying how old the wound is, which is the whole question those readers ask.
    Clamping to zero was never an option -- it would re-open the first-aid hour on an old
    wound and postpone its weekly roll by the overhang."""
    state = {"investigator_id": INVESTIGATOR,
             "wound_ledger": [{"wound_id": "wound-t2-c1", "occurred_elapsed_minutes": 480, "status": "active"}]}
    assert healing.rebase_clock(state, -540)["wound_ledger"][0]["occurred_elapsed_minutes"] == -60
    # Landing exactly on the origin is unremarkable, and so is landing before it.
    assert healing.rebase_clock(state, -480)["wound_ledger"][0]["occurred_elapsed_minutes"] == 0
    attempts = {"investigator_id": INVESTIGATOR,
                "major_wound_recovery_ledger": [{"wound_id": "wound-a", "attempt_elapsed_minutes": 100}]}
    assert healing.rebase_clock(attempts, -101)["major_wound_recovery_ledger"][0]["attempt_elapsed_minutes"] == -1


# ---- mp -------------------------------------------------------------------------------------

def test_mp_keeps_no_clock_minute_and_says_so():
    state = {"investigator_id": INVESTIGATOR, "mp": 3, "mp_max": 11, "current_hp": 9, "regen_remainder_minutes": 45}
    moved = mp.rebase_clock(state, -480)
    assert moved == state and moved is not state
    assert moved["regen_remainder_minutes"] == 45  # minutes banked toward the next point: a length
