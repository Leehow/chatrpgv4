"""Tests for the structured sanity engine (Chapter 8). Ported from the old
tree's `tests/test_sanity_session.py` and `tests/test_phobia_mania.py`
(subject: `coc_sanity.py`, now `kernel/coc/rules/sanity.py`'s `SanitySession`),
plus the bout-of-madness-table resolution tests that lived in
`tests/test_mythos.py` (that file's actual subject there was
`coc_sanity.SanitySession`, not `coc_mythos.py`; they belong here instead of
in `tests/kernel/engines/test_mythos.py`).

Validates Chapter 8 SAN mechanics: SAN roll + loss notation, involuntary
action on failure, 5+ loss -> temp insanity (INT roll, counter-intuitive
success=insane), bout of madness structure + Table VII/VIII result lookup,
indefinite insanity threshold, permanent insanity at 0 SAN, recovery, SAN
gain, delusions + reality check (p.162-163), phobia/mania rolls + structured
penalty-die exposure (p.159), and the sanity-gain-pending receipt.

API change from the port: `SanitySession` takes a keyword-only `tables:
RuleTables` (bout tables, phobias/manias tables, and the injected `RollApi`
all come from it instead of a module-global rules dir); `SanitySession.load()`
takes `tables` too. `_load_phobia_mania_table` also takes `tables` as its new
first argument.

Dropped (subject deleted):
- `test_save_does_not_overwrite_mismatched_investigator_mirror` and
  `test_sync_writes_phobia_mania_tags_to_investigator_state` -- `save()` no
  longer mirrors into a shared `save/investigator-state/<inv>.json` document
  (no more `strict_mirror` kwarg, no `SanityStateIdentityError` on a mirror
  clash). Per `save()`'s own docstring: "the kernel mirrors `san_current` into
  the party sheet through the settlement context instead." `SanityStateIdentityError`
  itself is still raised elsewhere (a malformed/mismatched snapshot on load),
  which the identity test below still covers.

Adapted:
- `test_load_fails_closed_for_missing_or_mismatched_investigator_identity`
  used to seed the old *legacy* single-owner path (`save/sanity.json`), which
  `load()` no longer falls back to (`legacy_sanity_snapshot_path` is gone --
  there is only the per-investigator `save/sanity-state/<inv>.json`). The
  seeded file below is written to that canonical per-investigator path
  instead; the identity-mismatch rule itself (`SanityStateIdentityError`,
  a `ValueError`) is unchanged.
"""

from __future__ import annotations

import json
import random
import sys

import pytest
from conftest import CONTENT_DIR, KERNEL_DIR

sys.path.insert(0, str(KERNEL_DIR))

from coc.rules.sanity import (  # noqa: E402
    BACKSTORY_FIELDS,
    SanitySession,
    SanityStateIdentityError,
    _load_phobia_mania_table,
    consume_sanity_gain_pending,
    record_psychoanalysis_gain_pending,
    sanity_snapshot_path,
    validate_san_loss_expression,
    write_sanity_gain_pending,
)
from coc.rules.tables import RuleTables  # noqa: E402

RULES = CONTENT_DIR / "rulesets" / "coc7" / "rules-json"


@pytest.fixture(scope="module")
def tables() -> RuleTables:
    return RuleTables(RULES)


def _make_session(tables, san=65, int_val=60, seed=42, **kwargs):
    return SanitySession("ada", san_max=san, int_value=int_val, rng=random.Random(seed),
                         tables=tables, **kwargs)


# --------------------------------------------------------------------------- #
# validate_san_loss_expression
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("expression", ["1", "7", "1D6", "2d10+3"])
def test_validate_san_loss_expression_accepts_runtime_grammar(expression):
    validate_san_loss_expression(expression)


@pytest.mark.parametrize("expression", ["", "0", "-1", "0D6", "1D0", "not-dice"])
def test_validate_san_loss_expression_rejects_unsafe_bounds(expression):
    with pytest.raises(ValueError):
        validate_san_loss_expression(expression)


@pytest.mark.parametrize("expression", ["101D6", "1D1001", "1D6+100001", "100D1000+1", "100001"])
def test_validate_san_loss_expression_rejects_oversized_work(expression):
    with pytest.raises(ValueError):
        validate_san_loss_expression(expression)


# --------------------------------------------------------------------------- #
# Core SAN roll / loss
# --------------------------------------------------------------------------- #
def test_sanity_session_initial_state(tables):
    s = _make_session(tables, san=50)
    assert s.san_current == 50
    assert s.san_max == 50
    assert not s.temporary_insane
    assert not s.indefinite_insane
    assert not s.permanently_insane


def test_successful_san_roll_loses_success_amount(tables):
    """SAN roll success: lose the 'success' side of X/YdZ (p.166)."""
    s = _make_session(tables, san=90, seed=1)
    s.sanity_check("mild shock", san_loss_success=0, san_loss_fail_expr="1D4")
    assert s.san_current <= 90  # lost 0 or fail-loss


def test_failed_san_roll_loses_dice_amount(tables):
    """SAN roll failure: lose the 'failure' side (rolled)."""
    s = _make_session(tables, san=5, seed=50)  # low SAN -> likely fail
    san_before = s.san_current
    s.sanity_check("horror", san_loss_success=0, san_loss_fail_expr="1D4", involuntary_kind="freeze")
    assert s.san_current < san_before  # definitely lost some


def test_failed_san_roll_triggers_involuntary_action(tables):
    """p.166: every failed SAN roll causes an involuntary action."""
    s = _make_session(tables, san=5, seed=50)
    s.sanity_check("horror", 0, "1D4", involuntary_kind="cry_out", involuntary_summary="screams")
    assert len(s.involuntary_actions) >= 1
    assert s.involuntary_actions[-1]["kind"] == "cry_out"


def test_san_loss_5_plus_triggers_int_roll_and_possible_temp_insanity(tables):
    """p.167: losing 5+ SAN from one source -> INT roll.
    Counter-intuitive: INT success = temp insane; INT failure = repressed."""
    s = _make_session(tables, san=10, int_val=90, seed=80)
    s.sanity_check("seeing Cthulhu", 1, "1D10", involuntary_kind="freeze", alone=True)
    has_temp = s.temporary_insane
    has_bout = len(s.bouts_of_madness) > 0
    assert has_temp == has_bout


def test_bout_of_madness_alone_uses_summary_mode(tables):
    """p.171: lone investigator uses Table VIII Summary."""
    s = _make_session(tables, san=10, int_val=99, seed=99)
    s.sanity_check("horror", 1, "1D10", involuntary_kind="freeze", alone=True,
                   module_bout_override={"force_mode": "summary"})
    if s.bouts_of_madness:
        assert s.bouts_of_madness[-1]["mode"] == "summary"
        assert s.bouts_of_madness[-1]["summary_table"] == "table_viii_summary"


def test_bout_of_madness_with_others_uses_realtime_mode(tables):
    """p.171: investigator with others uses Table VII Real-Time."""
    s = _make_session(tables, san=10, int_val=99, seed=99)
    s.sanity_check("horror", 1, "1D10", involuntary_kind="freeze", alone=False)
    if s.bouts_of_madness:
        assert s.bouts_of_madness[-1]["mode"] == "real_time"


def test_one_fifth_san_lost_in_day_triggers_indefinite_insanity(tables):
    """p.168: lose >=1/5 current SAN in one day -> indefinite insanity."""
    s = _make_session(tables, san=20, int_val=10, seed=1)
    s.sanity_check("horror 1", 0, "1D4", involuntary_kind="freeze")
    s.sanity_check("horror 2", 0, "1D4", involuntary_kind="freeze")
    s.sanity_check("horror 3", 0, "1D4", involuntary_kind="freeze")
    if s.daily_san_lost >= 20 // 5:
        assert s.indefinite_insane is True


def test_san_zero_triggers_permanent_insanity(tables):
    """p.168: SAN = 0 -> permanent insanity."""
    s = _make_session(tables, san=1, seed=100)  # SAN 1, almost guaranteed fail
    s.sanity_check("final horror", 0, "1D10", involuntary_kind="freeze")
    if s.san_current == 0:
        assert s.permanently_insane is True


def test_recover_temporary_ends_temp_insanity(tables):
    """p.176: temporary insanity recovers after 1D10 hours."""
    s = _make_session(tables)
    s.temporary_insane = True
    s.temporary_insane_remaining_hours = 3
    assert s.recover_temporary() is True
    assert s.temporary_insane is False


def test_gain_san_capped_at_max(tables):
    """SAN cannot exceed san_max."""
    s = _make_session(tables, san=65)
    s.gain_san(100, "generous reward")
    assert s.san_current == 65


def test_gain_san_records_event_and_roll(tables):
    """SAN gain produces an event and a pending roll."""
    s = _make_session(tables, san=60)
    s.san_current = 50
    s.gain_san(5, "reward")
    assert s.san_current == 55
    assert len(s.pending_rolls) >= 1
    events = [e for e in s.events if e["type"] == "sanity_gain"]
    assert len(events) >= 1


def test_end_day_resets_daily_counter(tables):
    """Keeper calls end_day to reset the 1/5 daily loss tracker."""
    s = _make_session(tables, san=50, seed=1)
    s.sanity_check("horror", 0, "1D4", involuntary_kind="freeze")
    s.end_day()
    assert s.daily_san_lost == 0


def test_snapshot_has_full_schema(tables):
    """Snapshot includes all fields needed for save/sanity-state/<inv>.json."""
    s = _make_session(tables)
    s.sanity_check("test", 0, "1D4", involuntary_kind="freeze")
    snap = s.snapshot()
    for key in ("investigator_id", "san_max", "san_current", "temporary_insane", "indefinite_insane",
                "permanently_insane", "daily_san_lost", "bouts_of_madness", "involuntary_actions", "events"):
        assert key in snap


def test_permanently_insane_skips_further_san_checks(tables):
    """Once permanently insane, no further SAN checks are processed."""
    s = _make_session(tables, san=1, seed=100)
    s.permanently_insane = True
    san_before = s.san_current
    s.sanity_check("another horror", 0, "1D10", involuntary_kind="freeze")
    assert s.san_current == san_before  # unchanged


def test_fumbled_san_roll_loses_maximum_san(tables):
    """p.166: a fumbled Sanity roll loses the maximum possible SAN, not a
    random roll. For SAN 1/1D8, a fumble should lose 8 (max of 1D8)."""
    s = _make_session(tables, san=40, seed=97)
    san_before = s.san_current
    s.sanity_check("horror", san_loss_success=0, san_loss_fail_expr="1D8", involuntary_kind="freeze")
    drained = s.drain_pending()
    san_roll = next((r for r in drained if r["skill"] == "SAN"), None)
    if san_roll and san_roll["outcome"] == "fumble":
        assert san_roll["san_loss"] == 8  # max of 1D8
        assert s.san_current == san_before - 8


def test_no_san_loss_during_active_bout(tables):
    """p.157: the investigator cannot lose further SAN while experiencing a
    bout of madness."""
    s = _make_session(tables, san=60)
    s.bout_active = True
    ev = s.sanity_check("horror", 1, "1D6", involuntary_kind="freeze")
    assert ev["type"] == "sanity_check_skipped"
    assert s.san_current == 60


def test_underlying_insanity_any_loss_triggers_new_bout(tables):
    """p.158: while underlying insane, any further SAN loss (even 1 point)
    results in another bout of madness."""
    s = _make_session(tables, san=5, seed=50)  # low SAN -> the roll fails, loses 1D4
    s.temporary_insane = True  # underlying phase
    before = len(s.bouts_of_madness)
    s.sanity_check("aftershock", 1, "1D4", involuntary_kind="freeze")
    assert s.san_current < 5
    assert len(s.bouts_of_madness) == before + 1


def test_realtime_bout_sets_active_and_ticks_down(tables):
    """Real-time bouts last 1D10 rounds (p.157); tick_bout_round counts down
    and end_bout returns control (underlying insanity continues)."""
    s = _make_session(tables, san=60)
    s._start_bout("ghoul", alone=False, module_bout_override=None)
    assert s.bout_active is True
    rounds = s.bout_rounds_remaining
    assert rounds >= 1
    for _ in range(rounds):
        s.tick_bout_round()
    assert s.bout_active is False
    assert any(e["type"] == "bout_ended" for e in s.events)


def test_bout_state_survives_save_load(tables, tmp_path):
    s = SanitySession("ada", san_max=60, int_value=50, rng=random.Random(4),
                      campaign_dir=tmp_path, tables=tables)
    s._start_bout("ghoul", alone=False, module_bout_override=None)
    s.save(tmp_path)
    loaded = SanitySession.load(tmp_path, "ada", tables=tables)
    assert loaded.bout_active is True
    assert loaded.bout_rounds_remaining == s.bout_rounds_remaining


def test_bout_id_is_stable_across_reload_and_bout_end_event(tables, tmp_path):
    s = SanitySession("ada", san_max=60, int_value=50, rng=random.Random(4),
                      campaign_dir=tmp_path, tables=tables)
    bout = s._start_bout("ghoul", alone=False, module_bout_override=None)
    bout_id = bout["bout_id"]
    assert isinstance(bout_id, str) and bout_id
    assert s.active_bout_id == bout_id
    s.save(tmp_path)

    loaded = SanitySession.load(tmp_path, "ada", rng=random.Random(99), tables=tables)
    assert loaded.active_bout_id == bout_id
    loaded.end_bout()

    assert loaded.active_bout_id is None
    ended = [event for event in loaded.events if event["type"] == "bout_ended"][-1]
    assert ended["payload"]["bout_id"] == bout_id


@pytest.mark.parametrize(
    "mutate",
    [
        lambda snap: snap.update({"bout_active": True, "active_bout_id": None}),
        lambda snap: snap.update({"bout_active": False, "active_bout_id": "bout:forged",
                                  "bout_rounds_remaining": 2}),
        lambda snap: snap.update({"active_bout_id": "bout:missing"}),
    ],
)
def test_load_rejects_inconsistent_active_bout_snapshot(tables, tmp_path, mutate):
    s = SanitySession("ada", san_max=60, int_value=50, rng=random.Random(4),
                      campaign_dir=tmp_path, tables=tables)
    s._start_bout("ghoul", alone=False, module_bout_override=None)
    s.save(tmp_path)
    path = sanity_snapshot_path(tmp_path, "ada")
    snapshot = json.loads(path.read_text())
    mutate(snapshot)
    path.write_text(json.dumps(snapshot))
    before = path.read_bytes()

    with pytest.raises(ValueError, match="bout"):
        SanitySession.load(tmp_path, "ada", tables=tables)

    assert path.read_bytes() == before


def test_indefinite_insanity_threshold_uses_day_start_current_san(tables):
    """p.168: the 1/5 threshold is against *current* SAN at the start of the
    day, not max SAN. san_max=99 but day starts at 25 -> losing 5 triggers."""
    s = _make_session(tables, san=99, seed=1)
    s.san_current = 25
    s.end_day()  # anchor day_start_san = 25
    s.daily_san_lost = 0
    s.sanity_check("shock", san_loss_success=5, san_loss_fail_expr="5", involuntary_kind="freeze")
    assert s.daily_san_lost >= 5
    assert s.indefinite_insane is True


def test_day_start_san_survives_save_load(tables, tmp_path):
    s = SanitySession("ada", san_max=99, int_value=50, rng=random.Random(1),
                      campaign_dir=tmp_path, tables=tables)
    s.san_current = 40
    s.end_day()
    s.save(tmp_path)
    loaded = SanitySession.load(tmp_path, "ada", tables=tables)
    assert loaded.day_start_san == 40


def test_load_fails_closed_for_mismatched_investigator_identity(tables, tmp_path):
    """Adapted from the old `test_load_fails_closed_for_missing_or_mismatched_investigator_identity`:
    the legacy single-owner `save/sanity.json` fallback is gone, so the mismatched
    snapshot is seeded straight at the canonical per-investigator path
    `load()` actually reads."""
    snapshot = SanitySession("inv2", san_max=55, int_value=70, rng=random.Random(131),
                             tables=tables).snapshot()
    snapshot["investigator_id"] = "inv2"
    path = sanity_snapshot_path(tmp_path, "inv1")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(snapshot), encoding="utf-8")

    with pytest.raises(SanityStateIdentityError, match="investigator_id"):
        SanitySession.load(tmp_path, "inv1", rng=random.Random(132), tables=tables)


def test_summary_bout_carries_backstory_amend_suggestion(tables):
    """W1-2 (p.157): a bout of madness suggests corrupting a backstory entry.
    Summary bouts end immediately, so the suggestion rides the bout event."""
    s = _make_session(tables, seed=3)
    bout = s._start_bout("ghoul", alone=True, module_bout_override=None)
    suggestion = bout.get("backstory_amend_suggestion")
    assert suggestion is not None
    assert suggestion["mode"] in ("corrupt_existing", "add_irrational")
    assert suggestion["backstory_field"] in BACKSTORY_FIELDS
    assert suggestion["keeper_note"]
    ev = [e for e in s.events if e["type"] == "bout_of_madness"][-1]
    assert ev["payload"]["backstory_amend_suggestion"] == suggestion


def test_realtime_bout_end_event_carries_backstory_amend_suggestion(tables):
    """W1-2: for real-time bouts the suggestion is surfaced again on the
    bout_ended event, when control returns to the player."""
    s = _make_session(tables, seed=3)
    s._start_bout("ghoul", alone=False, module_bout_override=None)
    s.end_bout()
    ev = [e for e in s.events if e["type"] == "bout_ended"][-1]
    suggestion = ev["payload"].get("backstory_amend_suggestion")
    assert suggestion is not None
    assert suggestion["backstory_field"] in BACKSTORY_FIELDS


# --------------------------------------------------------------------------- #
# W1-3: delusions + reality check (p.162-163)
# --------------------------------------------------------------------------- #
def _underlying_session(tables, seed=7):
    """Session in the underlying-insanity phase (insane, no active bout)."""
    s = _make_session(tables, seed=seed)
    s.temporary_insane = True
    s.bout_active = False
    return s


def test_plant_delusion_requires_underlying_phase(tables):
    s = _make_session(tables)
    try:
        s.plant_delusion("the nurse has no face")
    except ValueError as exc:
        assert "underlying" in str(exc)
    else:
        raise AssertionError("expected ValueError when sane")

    s2 = _underlying_session(tables)
    s2.bout_active = True
    try:
        s2.plant_delusion("the nurse has no face")
    except ValueError as exc:
        assert "bout" in str(exc)
    else:
        raise AssertionError("expected ValueError during bout")


def test_plant_delusion_records_structured_delusion(tables):
    s = _underlying_session(tables)
    d = s.plant_delusion("the nurse has no face", backstory_field="significant_people")
    assert s.active_delusion["description"] == "the nurse has no face"
    assert s.active_delusion["backstory_field"] == "significant_people"
    assert d == s.active_delusion


def test_reality_check_success_clears_delusion_and_grants_resistance(tables):
    s = _underlying_session(tables)
    s.plant_delusion("the walls breathe")
    out = s.reality_check(roll_result=1)  # forced success
    assert out["success"] is True
    assert s.active_delusion is None
    assert s.delusion_resistant is True


def test_reality_check_failure_costs_1_san_and_triggers_bout(tables):
    s = _underlying_session(tables)
    s.plant_delusion("the walls breathe")
    san_before = s.san_current
    bouts_before = len(s.bouts_of_madness)
    out = s.reality_check(roll_result=100)  # forced failure
    assert out["success"] is False
    assert s.san_current == san_before - 1
    assert len(s.bouts_of_madness) == bouts_before + 1
    assert s.active_delusion is not None  # delusion persists


def test_delusion_resistance_lapses_on_next_san_loss(tables):
    s = _underlying_session(tables, seed=50)
    s.plant_delusion("the walls breathe")
    s.reality_check(roll_result=1)
    assert s.delusion_resistant is True
    s.sanity_check("fresh horror", 1, "1D4")
    assert s.delusion_resistant is False


def test_delusion_state_survives_save_load(tables, tmp_path):
    s = SanitySession("ada", san_max=60, int_value=50, rng=random.Random(9),
                      campaign_dir=tmp_path, tables=tables)
    s.temporary_insane = True
    s.plant_delusion("the walls breathe", backstory_field="meaningful_locations")
    s.delusion_resistant = False
    s.save(tmp_path)
    loaded = SanitySession.load(tmp_path, "ada", tables=tables)
    assert loaded.active_delusion["description"] == "the walls breathe"
    assert loaded.delusion_resistant is False


def test_load_restores_phobia_mania_awfulness_and_conditions(tables, tmp_path):
    """W0-7: reloading a session must not amnesia away phobia/mania/awfulness
    caps/conditions/bout history."""
    s = SanitySession("ada", san_max=60, int_value=50, rng=random.Random(9),
                      campaign_dir=tmp_path, tables=tables)
    s.phobia = "Arachnophobia"
    s.mania = "Ablutomania"
    s.conditions = ["phobia:Arachnophobia", "mania:Ablutomania"]
    s.awfulness_caps = {"ghoul": 7}
    s.bouts_of_madness = [{"mode": "summary", "bout_roll": 3}]
    s.involuntary_actions = [{"kind": "freeze", "summary": "froze"}]
    s.save(tmp_path)
    loaded = SanitySession.load(tmp_path, "ada", tables=tables)
    assert loaded.phobia == "Arachnophobia"
    assert loaded.mania == "Ablutomania"
    assert loaded.awfulness_caps == {"ghoul": 7}
    assert "phobia:Arachnophobia" in loaded.conditions
    assert loaded.bouts_of_madness == [{"mode": "summary", "bout_roll": 3}]
    assert loaded.involuntary_actions == [{"kind": "freeze", "summary": "froze"}]


def test_critical_success_on_san_roll_is_best_outcome(tables):
    """Critical (roll=01) on SAN roll = success (lose success amount only)."""
    for seed in range(20):
        s2 = _make_session(tables, san=99, seed=seed)
        s2.sanity_check("test", 0, "1D4", involuntary_kind="freeze")
        drained = s2.drain_pending()
        san_roll = next((r for r in drained if r["skill"] == "SAN"), None)
        if san_roll and san_roll["roll"] == 1:
            assert san_roll["outcome"] == "critical"
            assert san_roll["san_loss"] == 0
            return
    # If no seed produced roll=1, that's OK -- the test is conditional.


def test_sanity_gain_pending_receipt_round_trip(tmp_path):
    path = write_sanity_gain_pending(tmp_path, "ada", san_gain=3, gain_source="psychoanalysis")
    assert path == tmp_path / "save" / "sanity-gain-pending" / "ada.json"
    document = json.loads(path.read_text(encoding="utf-8"))
    assert document == {"schema_version": 1, "investigator_id": "ada", "san_gain": 3,
                        "gain_source": "psychoanalysis"}
    written = record_psychoanalysis_gain_pending(tmp_path, "ada", 1, succeeded=True)
    assert written == path
    assert json.loads(path.read_text(encoding="utf-8"))["san_gain"] == 1
    assert record_psychoanalysis_gain_pending(tmp_path, "ada", 0) is None
    consume_sanity_gain_pending(tmp_path, "ada")
    assert not path.exists()
    consume_sanity_gain_pending(tmp_path, "ada")


# --------------------------------------------------------------------------- #
# Bout result resolution (Table VII/VIII lookup). Old subject: coc_sanity.py,
# tested (misleadingly) from tests/test_mythos.py.
# --------------------------------------------------------------------------- #
def test_bout_resolves_result_and_kind_from_table(tables):
    """A bout of madness record should carry result text + kind from the
    Table VII (realtime) or Table VIII (summary) lookup."""
    s = SanitySession("inv1", san_max=70, int_value=60, rng=random.Random(1), tables=tables)
    ev = s.sanity_check("deep one", san_loss_success=0, san_loss_fail_expr="1D6",
                        involuntary_kind="freeze")
    if s.daily_san_lost >= 5:
        assert len(s.bouts_of_madness) >= 1
        bout = s.bouts_of_madness[-1]
        assert "bout_result" in bout
        assert "bout_kind" in bout
        assert bout["bout_result"] != ""
        assert bout["bout_kind"] != ""


def test_bout_summary_mode_when_alone(tables):
    """When alone=True, the bout uses summary mode (Table VIII)."""
    s = SanitySession("inv1", san_max=70, int_value=60, rng=random.Random(3), tables=tables)
    s._trigger_temporary_insanity("test source", alone=True, module_bout_override=None)
    bout = s.bouts_of_madness[-1]
    assert bout["mode"] == "summary"
    assert bout["summary_table"] == "table_viii_summary"
    assert "bout_result" in bout


def test_bout_realtime_mode_when_not_alone(tables):
    s = SanitySession("inv1", san_max=70, int_value=60, rng=random.Random(3), tables=tables)
    s._trigger_temporary_insanity("test source", alone=False, module_bout_override=None)
    bout = s.bouts_of_madness[-1]
    assert bout["mode"] == "real_time"
    assert bout["summary_table"] == "table_vii_realtime"
    assert "bout_result" in bout


def test_resolve_bout_result_realtime_lookup(tables):
    s = SanitySession("inv1", san_max=70, int_value=60, rng=random.Random(1), tables=tables)
    entry = s._resolve_bout_result("realtime", 1)
    assert entry["result"] == "Amnesia"
    assert entry["kind"] == "loss_of_memory"


def test_resolve_bout_result_summary_lookup(tables):
    s = SanitySession("inv1", san_max=70, int_value=60, rng=random.Random(1), tables=tables)
    entry = s._resolve_bout_result("summary", 7)
    assert entry["result"] == "Institutionalized"
    assert entry["kind"] == "institutionalized"


def test_resolve_bout_result_missing_roll_returns_empty(tables):
    s = SanitySession("inv1", san_max=70, int_value=60, rng=random.Random(1), tables=tables)
    entry = s._resolve_bout_result("realtime", 99)
    assert entry == {}


# --------------------------------------------------------------------------- #
# Phobia / mania (Chapter 8 extension, p.159 / p.171 / p.162)
# --------------------------------------------------------------------------- #
def test_phobias_json_every_entry_has_trigger_tags():
    data = json.loads((RULES / "phobias.json").read_text(encoding="utf-8"))
    entries = data["phobias"]
    assert len(entries) >= 90
    for name, entry in entries.items():
        tags = entry.get("trigger_tags")
        assert isinstance(tags, list) and len(tags) >= 2, f"{name} missing trigger_tags"
        assert len(tags) <= 5, f"{name} should have 2-5 tags, got {len(tags)}"
        for tag in tags:
            assert isinstance(tag, str) and tag == tag.lower()
            assert " " not in tag
            assert tag.replace("_", "").isalnum()


def test_manias_json_every_entry_has_trigger_tags():
    data = json.loads((RULES / "manias.json").read_text(encoding="utf-8"))
    entries = data["manias"]
    assert len(entries) >= 90
    for name, entry in entries.items():
        tags = entry.get("trigger_tags")
        assert isinstance(tags, list) and len(tags) >= 2, f"{name} missing trigger_tags"
        for tag in tags:
            assert isinstance(tag, str) and tag == tag.lower()
            assert " " not in tag
            assert tag.replace("_", "").isalnum()


def test_roll_phobia_records_name_and_condition(tables):
    s = _make_session(tables, seed=7)
    name = s._roll_phobia()
    assert name is not None
    assert s.phobia == name
    assert f"phobia:{name}" in s.conditions
    assert isinstance(s.phobia_tags, list) and len(s.phobia_tags) >= 1
    assert any(ev.get("type") == "phobia_gained" for ev in s.events)


def test_roll_mania_records_name_and_condition(tables):
    s = _make_session(tables, seed=7)
    name = s._roll_mania()
    assert name is not None
    assert s.mania == name
    assert f"mania:{name}" in s.conditions
    assert isinstance(s.mania_tags, list) and len(s.mania_tags) >= 1
    assert s.mania_unindulged is True
    assert any(ev.get("type") == "mania_gained" for ev in s.events)


def test_roll_phobia_uses_1d100_range(tables):
    """The phobia roll should pick from the 100-entry table."""
    table = _load_phobia_mania_table(tables, "phobias")
    assert len(table) >= 90
    for seed in range(20):
        s = _make_session(tables, seed=seed)
        name = s._roll_phobia()
        assert name in table


def test_roll_phobia_does_not_duplicate_condition(tables):
    s = _make_session(tables, seed=3)
    s._roll_phobia()
    s._roll_phobia()
    phobia_conds = [c for c in s.conditions if c.startswith("phobia:")]
    assert len(phobia_conds) == len(set(phobia_conds))


def _seed_for_bout_roll(target_roll: int) -> int:
    """Find a seed where _trigger_temporary_insanity's bout_roll == target."""
    for seed in range(500):
        rng = random.Random(seed)
        rng.randint(1, 10)  # duration_hours
        if rng.randint(1, 10) == target_roll:
            return seed
    raise RuntimeError(f"no seed found for bout_roll={target_roll}")


def test_bout_roll_9_yields_phobia(tables):
    seed = _seed_for_bout_roll(9)
    s = _make_session(tables, san=65, int_val=60, seed=seed)
    s._trigger_temporary_insanity("test horror", alone=False, module_bout_override=None)
    assert s.phobia is not None
    assert s.mania is None
    last_bout = s.bouts_of_madness[-1]
    assert last_bout["bout_roll"] == 9
    assert "phobia" in last_bout


def test_bout_roll_10_yields_mania(tables):
    seed = _seed_for_bout_roll(10)
    s = _make_session(tables, san=65, int_val=60, seed=seed)
    s._trigger_temporary_insanity("test horror", alone=False, module_bout_override=None)
    assert s.mania is not None
    assert s.phobia is None
    last_bout = s.bouts_of_madness[-1]
    assert last_bout["bout_roll"] == 10
    assert "mania" in last_bout
    assert s.mania_unindulged is True


def test_bout_roll_below_9_yields_no_phobia_or_mania(tables):
    seed = _seed_for_bout_roll(5)
    s = _make_session(tables, san=65, int_val=60, seed=seed)
    s._trigger_temporary_insanity("test horror", alone=False, module_bout_override=None)
    assert s.phobia is None
    assert s.mania is None


def test_penalty_die_zero_when_sane(tables):
    s = _make_session(tables)
    s.phobia = "Claustrophobia"
    s.phobia_tags = ["confined_space", "enclosed", "crowded_room"]
    assert s.is_insane is False
    result = s.penalty_die_for_exposure(exposure_tags={"confined_space"})
    assert result["penalty_dice"] == 0
    assert result["reason"] == "not_insane"


def test_penalty_die_one_when_insane_and_tags_intersect(tables):
    s = _make_session(tables)
    s.phobia = "Claustrophobia"
    s.phobia_tags = ["confined_space", "enclosed", "crowded_room"]
    s.temporary_insane = True
    result = s.penalty_die_for_exposure(exposure_tags={"confined_space", "darkness"})
    assert result["penalty_dice"] == 1
    assert "confined_space" in result["matched"]


def test_penalty_die_one_when_insane_and_mania_tags_intersect(tables):
    s = _make_session(tables)
    s.mania = "Pyromania"
    s.mania_tags = ["fire", "flames", "burning"]
    s.indefinite_insane = True
    result = s.penalty_die_for_exposure(exposure_tags=["fire", "heights"])
    assert result["penalty_dice"] == 1
    assert "fire" in result["matched"]


def test_penalty_die_zero_when_tags_disjoint(tables):
    s = _make_session(tables)
    s.phobia = "Claustrophobia"
    s.phobia_tags = ["confined_space", "enclosed"]
    s.temporary_insane = True
    result = s.penalty_die_for_exposure(exposure_tags={"heights", "cliff_edge"})
    assert result["penalty_dice"] == 0
    assert result["reason"] == "no_structured_exposure_evidence"
    assert result["matched"] == []


def test_penalty_die_zero_when_no_exposure_tags(tables):
    s = _make_session(tables)
    s.phobia = "Arachnophobia"
    s.phobia_tags = ["spiders", "webs"]
    s.temporary_insane = True
    result = s.penalty_die_for_exposure(exposure_tags=None)
    assert result["penalty_dice"] == 0
    assert result["reason"] == "no_structured_exposure_evidence"


def test_penalty_die_zero_when_symptoms_suppressed(tables):
    s = _make_session(tables)
    s.phobia = "Claustrophobia"
    s.phobia_tags = ["confined_space"]
    s.temporary_insane = True
    out = s.suppress_insanity_symptoms()
    assert out["symptoms_suppressed_until_next_san_loss"] is True
    result = s.penalty_die_for_exposure(exposure_tags={"confined_space"})
    assert result["penalty_dice"] == 0
    assert result["reason"] == "symptoms_suppressed"


def test_suppression_lapses_after_san_loss(tables):
    s = _make_session(tables, san=65, seed=1)
    s.temporary_insane = True
    s.suppress_insanity_symptoms()
    assert s.symptoms_suppressed_until_next_san_loss is True
    s.sanity_check("horror", san_loss_success=1, san_loss_fail_expr="1D4", involuntary_kind="freeze")
    assert s.symptoms_suppressed_until_next_san_loss is False


def test_indulge_mania_clears_unindulged_flag(tables):
    s = _make_session(tables, seed=7)
    s._roll_mania()
    assert s.mania_unindulged is True
    out = s.indulge_mania()
    assert s.mania_unindulged is False
    assert out["mania_unindulged"] is False


def test_snapshot_includes_phobia_mania_conditions(tables):
    s = _make_session(tables)
    s._roll_phobia()
    snap = s.snapshot()
    assert snap["phobia"] == s.phobia
    assert snap["phobia_tags"] == s.phobia_tags
    assert "conditions" in snap
    assert any(c.startswith("phobia:") for c in snap["conditions"])


def test_phobia_mania_tags_survive_save_load(tables, tmp_path):
    s = SanitySession("ada", san_max=60, int_value=50, rng=random.Random(9),
                      campaign_dir=tmp_path, tables=tables)
    s._roll_phobia()
    s._roll_mania()
    s.symptoms_suppressed_until_next_san_loss = True
    s.save(tmp_path)
    loaded = SanitySession.load(tmp_path, "ada", tables=tables)
    assert loaded.phobia == s.phobia
    assert loaded.phobia_tags == s.phobia_tags
    assert loaded.mania == s.mania
    assert loaded.mania_tags == s.mania_tags
    assert loaded.mania_unindulged is True
    assert loaded.symptoms_suppressed_until_next_san_loss is True
