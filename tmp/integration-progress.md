# Time + Subsystems Integration Progress

Tracking the 5-task integration of the time system + new rule subsystems.
Baseline: 584 tests. Promise: `TIME SYSTEM INTEGRATED MP HEALING PHOBIA MANIA SANITY TRIGGERS ALL TESTS GREEN`

## Checklist

- [x] **Task 1 — Time integration into director + apply layers**
  - [x] `coc_story_director.py`: loads `coc_time`; `build_director_context()` reads `time_state` + builds `time_signals` → `context["time_signals"]`; `generate_director_plan()` emits `time_advance` (mode/category/delta/confidence/reason) derived from action + signals.
  - [x] `coc_director_apply.py`: loads `coc_time`; `apply_plan()` calls `apply_time_advance_from_plan()` after pacing write, before memory writes; events appended + persisted to `logs/events.jsonl`.
  - [x] Tests: `test_apply_plan_advances_time`, `test_apply_plan_without_time_advance_is_noop` in `tests/test_time.py`.
  - [x] Synced to `coc-keeper-zcode`.
  - [x] pytest: 586 passed. Validators: clean on both trees.
- [x] **Task 2 — MP economy system (`coc_mp.py`)**
  - [x] `MPool` class: init `POW//5`, `spend_mp` (overspill → HP 1:1), `regen_mp` (1/hr, 2/hr if POW>100, capped at mp_max), `can_spend`.
  - [x] Persists `mp`/`mp_max` (merge) into `save/investigator-state/<id>.json`; events → `logs/events.jsonl`.
  - [x] `handle_time_trigger()` integrates regen with coc_time delta_minutes (downtime/sleep).
  - [x] Reads `mp_economy` block from `spells.json`.
  - [x] Tests: `tests/test_mp.py` (20 tests: init, spend, overspill, regen, cap, persistence, time trigger).
  - [x] Synced to `coc-keeper-zcode`.
  - [x] pytest: 606 passed. Validators: clean on both trees.
- [x] **Task 3 — Healing/recovery system (`coc_healing.py`)**
  - [x] `HealingSession` class: `first_aid` (+1 HP, push once, once-per-wound), `medicine` (+1D3, hard if not same day), `weekly_recovery` (1 HP/day; major wound CON roll: fail=0/reg=1D3/extreme=2D3).
  - [x] HP capped at `hp_max`; `major_wound` clears at ≥ half-max; dying/unconscious cannot heal until stabilized.
  - [x] Persists `current_hp`+`conditions` into investigator-state; events → `logs/events.jsonl`.
  - [x] `handle_time_trigger()` integrates downtime/sleep (≥6h = 1 day rest recovery) with coc_time.
  - [x] Tests: `tests/test_healing.py` (19 tests: first_aid, push, medicine, weekly_recovery, major wound CON roll, capping, persistence, time trigger).
  - [x] Synced to `coc-keeper-zcode`.
  - [x] pytest: 625 passed. Validators: clean on both trees.
- [x] **Task 4 — Phobia/mania state application (extend `coc_sanity.py`)**
  - [x] Bout-of-madness result 9 → `_roll_phobia()` rolls 1D100 on Table IX (phobias.json), records `phobia` + `phobia:<name>` condition.
  - [x] Bout-of-madness result 10 → `_roll_mania()` rolls 1D100 on Table X (manias.json), records `mania` + `mania:<name>` condition.
  - [x] `is_insane` property + `penalty_die_for_exposure(phobia_source, mania_source)` → 1 penalty die when insane AND exposed to matching source (p159); stacks; case-insensitive substring match.
  - [x] `snapshot()` now includes `phobia`/`mania`/`conditions`.
  - [x] Tests: `tests/test_phobia_mania.py` (14 tests: roll phobia/mania, bout 9/10 integration, penalty die sane/insane/match/stack/snapshot).
  - [x] Synced to `coc-keeper-zcode`.
  - [x] pytest: 639 passed. Validators: clean on both trees.
- [x] **Task 5 — Sanity trigger integration (extend `coc_sanity.py`)**
  - [x] `SanitySession.__init__` now accepts optional `campaign_dir`; loads `coc_time` as sibling (graceful degradation).
  - [x] `_trigger_temporary_insanity()` schedules a recovery trigger via `coc_time.schedule_trigger()` (due = current_elapsed + remaining_hours×60, handler `recover_temporary_insanity`, policy `auto_apply_if_safe`). Initializes time-state if missing. Emits `recovery_trigger_scheduled` event.
  - [x] `recover_temporary()` clears condition + emits `sanity_recovered` event.
  - [x] `end_day()` resets daily SAN counter + records `day_started_elapsed` anchor in the investigator's sanity period (when time layer attached).
  - [x] Tests: `tests/test_sanity_time_integration.py` (9 tests: trigger scheduling, due-time math, graceful degradation, init-if-missing, recover, end_day anchor, full bout→pass→safe-rest→fire flow).
  - [x] Synced to `coc-keeper-zcode`.
  - [x] pytest: 648 passed. Validators: clean on both trees.

## Final status
- Baseline 584 → **648 passed** (+64 tests across 5 new/extended subsystems).
- `coc-keeper` and `coc-keeper-zcode` scripts + rule data in sync.
- All 5 tasks complete.

## Per-task verification (run after each task)
1. Sync ALL changed files to `plugins/coc-keeper-zcode/`
2. `python3 -m pytest tests/ -q`
3. `python3 plugins/coc-keeper/scripts/coc_validate.py rules plugins/coc-keeper`
4. `python3 plugins/coc-keeper/scripts/coc_validate.py rules plugins/coc-keeper-zcode`
5. Update this checklist.
