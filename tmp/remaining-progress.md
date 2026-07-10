# CoC Remaining Rule Subsystems — Progress

> **维护说明（2026-07-10）：** 这是历史执行日志。下文提到的 ZCode sync、
> “Both plugins”和双副本校验只描述当时环境；该 track 已由 `e314156`
> 移除，当前只维护 `plugins/coc-keeper/`。

Baseline: 648 tests pass.

## Batch 1: Magic casting engine + spell learning — DONE
- Created `plugins/coc-keeper/scripts/coc_magic.py` (+ zcode sync)
  - `cast_spell(spell_name, caster_state, *, is_first_cast, is_npc, pushed, rng, mp_pool)`
    - First PC cast: Hard POW roll (success/failure).
    - NPC/monster cast: auto-success, no roll.
    - Subsequent PC cast: auto-success.
    - Pushed cast: MP x1D6, HP overspill, spell always works.
    - MP deducted via `coc_mp.MPool.spend_mp` (or inline vs caster_state).
    - SAN cost applied on success.
    - Returns {success, roll_result, mp_spent, hp_damage, san_lost, pushed, ...}.
  - `learn_spell(spell_name, learner_state, source, *, rng, campaign_dir)`
    - Hard INT roll (pushable from caller side).
    - From tome: 2D6 weeks; from person: 1D8 days.
    - Schedules `spell_study_complete` trigger via `coc_time.schedule_trigger`.
    - Returns {learned, roll_result, study_weeks, study_days, completion_trigger_id}.
- Added `tests/test_magic.py` (24 tests).
- Synced to `plugins/coc-keeper-zcode/`.
- All 672 tests pass. Both plugins validate.

## Batch 2: Firearm malfunction + CM tracking + bout result resolution — DONE
- **Firearm malfunction** (coc_combat.py):
  - `_check_malfunction(actor_id, weapon, roll_value, turn_id)`: if weapon has
    a non-null `malfunction` number and the attack roll >= that number, the
    weapon jams (unusable until repaired). Adds `jammed_weapons` set on the
    session, records a `malfunction_event` on the turn + appends to
    `damage_chain`. Integrated into `_resolve_attack` (checks after the attack
    roll, before target response). Made `_update_conditions` robust to
    non-damage damage_chain entries (uses `.get()` guards).
- **Cthulhu Mythos tracking** (new `coc_mythos.py` + zcode sync):
  - `gain_mythos(investigator_state, *, amount, is_first)`: first encounter
    +5 CM, subsequent +1 (p.167). Recomputes `max_san = 99 - cm_value`,
    clamps `current_san` down to the new max.
  - `max_san_for(cm_value)` helper.
  - `gain_mythos_persisted(campaign_dir, investigator_id, ...)` reads/writes
    investigator-state + logs events.jsonl.
- **Bout result resolution** (coc_sanity.py):
  - `_resolve_bout_result(table_key, bout_roll)`: looks up result text + kind
    from Table VII (realtime) / Table VIII (summary) via coc_rules.
  - `_trigger_temporary_insanity` now records `bout_result` + `bout_kind` on
    the bout record (and the bout_of_madness event).
- Added `tests/test_malfunction.py` (7 tests), `tests/test_mythos.py` (18 tests).
- Synced to `plugins/coc-keeper-zcode/`.
- All 697 tests pass. Both plugins validate.
## Batch 3: Opposed-roll difficulty + Mythos-Hardened + awfulness cap + SAN reward at 90 — DONE
- **Opposed-roll difficulty from opponent skill** (p.83):
  - Added `from_opponent` block to `difficulty-levels.json` (threshold_regular=50,
    threshold_hard=90).
  - Added `core.difficulty.from_opponent` rule-id to `rule-index.json`.
  - Added `difficulty_from_opponent(opponent_skill)` in coc_rules.py: <50→Regular,
    50-89→Hard, 90+→Extreme.
  - Made `difficulty_target()` robust: raises a clear ValueError for the
    `from_opponent` lookup block (no divisor).
- **Mythos-Hardened** (p.169): SanitySession now carries `cm_value`. In
  `sanity_check`, when `cm_value > current_san`, SAN loss is halved (round
  down). Recorded as `mythos_hardened` on the roll record + event.
- **Awfulness cap** (p.169): SanitySession carries `awfulness_caps` dict. When
  `creature_type` is passed to `sanity_check`, cumulative SAN loss per creature
  type is tracked and capped at the creature's max possible loss
  (success + max-failure). Beyond the cap, losses are zero.
- **SAN reward at skill 90+** (p.95): Added `sanity_reward` block (2D6) to
  `development.json`, `core.development.sanity_reward` rule-id, and a
  `sanity_reward_rule()` accessor in coc_rules.py (also surfaced inside
  `development_rule()`).
- Snapshot now includes `cm_value` + `awfulness_caps`.
- Added `tests/test_subsystems3.py` (17 tests).
- Synced to `plugins/coc-keeper-zcode/`.
- All 714 tests pass. Both plugins validate.
## Batch 4: Idea/Know rolls + believer bomb + psychotherapy — DONE
- **Idea/Know rolls**: Added `idea_roll(int_value, ...)` (target=INT) and
  `know_roll(edu_value, ...)` (target=EDU) to coc_roll.py — thin wrappers over
  `percentile_check` stamping `roll_kind` + `characteristic`. Added
  `core.resolution.idea_roll` and `core.resolution.know_roll` rule-ids
  (source_table percentile-check.json) to rule-index.json.
- **Becoming a believer (p.179)**:
  - Replaced the `read_believer_bomb` stub in coc_rule_signals.py with a real
    signal computing pending SAN loss = current CM, resulting SAN, and whether
    it triggers permanent insanity.
  - Added `become_believer(investigator_state, *, source, mythos_gain, is_first)`
    to coc_mythos.py: first-hand encounter forces belief (SAN bomb = current
    CM); tome source may choose not to believe (no SAN points lost; still gain
    CM, lose max SAN). Added `become_believer_persisted` campaign wrapper.
  - Added `core.mythos.become_believer` rule-id to rule-index.json.
- **Psychotherapy/asylum/self-help (p.164)**: Added `PsychotherapySession`
  class to coc_healing.py:
  - `psychoanalysis(skill_value)`: weekly roll; regular→1D3 SAN, hard→2D3,
    extreme→3D3.
  - `confine_to_asylum()`: 1D6 months confinement.
  - `resolve_asylum_release(skill)`: success recovers to max SAN.
  - `self_help()`: SAN roll; success +1D6 SAN, failure -1 SAN.
- Added `tests/test_subsystems4.py` (23 tests).
- Synced to `plugins/coc-keeper-zcode/`.
- All 737 tests pass. Both plugins validate.

## Summary
- Baseline: 648 tests. Final: 737 tests (+89 new, all green).
- New modules: coc_magic.py, coc_mythos.py.
- Touched: coc_combat.py, coc_sanity.py, coc_rules.py, coc_roll.py,
  coc_rule_signals.py, coc_healing.py, difficulty-levels.json, development.json,
  rule-index.json.
- Both plugins (coc-keeper + coc-keeper-zcode) identical and validate clean.

<promise>ALL REMAINING RULE SUBSYSTEMS IMPLEMENTED MAGIC MALFUNCTION MYTHOS BOUT DIFFICULTY HARDENED AWFULNESS REWARD IDEA BELIEVER PSYCHOTHERAPY TESTS GREEN</promise>
