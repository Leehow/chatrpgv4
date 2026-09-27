# Keeper time skip — tickets

Spec: `docs/specs/keeper-time-skip.md`. Contract: §145. Branch `claude/keeper-time-skip-20260926` (from line-2 @ `855630ac5`).
Order: TS-01, then TS-03 (kernel), then TS-02 (host); TS-04 last.

## TS-01 — `apply time {until}`

Status: ready-for-human

`time` takes `until: {days, time}` in the slot `minutes` fills, days counted from the day the turn began; the kernel
binds it against the staged clock, beside `stated` (§136.22). Refusals `until_none`, `until_conflict`, `until_invalid`,
`until_not_forward`. Receipt carries `until` and the
bound `minutes`. Tool schema and fake kernel offer it. Tests: `tests/kernel/test_time_until.py`, the extension schema
test. See spec F1.

## TS-02 — the host's time reading

Status: ready-for-human

`runtime/jev/time-reading-domain.ts` (family `time-reading` v1: Score `cut`, Choice `ends_at`, state = delivery text
only), inventoried in SL-00; `time_reading` budget block in `content/rulesets/coc7/host-budgets.json`; taken on the
explicit, embedded and implicit delivery paths at the same time as speech attribution; fail open; once per text per
turn; opening exempt; rides on `table.narrate` outside the digest with `refusable`; `lane: "time-reading"` telemetry.
A kernel refusal for `time_unrecorded` spends the turn's one steer (§135.11). See spec F2.

## TS-03 — the kernel's reconciliation

Status: ready-for-human

`table.narrate` compares the reading with this turn's clock movement and the clock's day part; refuses once per turn
(`time_gate`), else delivers with a `warnings` row; the capsule's `unrecorded` gains the `time` kind until a later
`time` receipt. Telemetry `lane: "delivery", reason: "time_unrecorded"`. See spec F3.

## TS-04 — verification

Status: ready-for-human

Live Jev over the retained prose (done before implementation, see Comments), then one real table with this session
as the only player.

## Comments

**2026-09-26, pre-implementation probe (live Jev `jev-1.13.0`, Mac; key from the App vault; script in the session
scratchpad `time-reading-probe.mjs`).** Outcomes were written down before the first request.

- `npc-acts-b2` turns 0–10: turn 8 reads `next_day` 0.99, `ends_at: morning` 1.00. Every other turn reads
  `continuous` 0.82–0.99, including turns 4, 5 and 9, whose dialogue talks about tomorrow or tonight. ~300 ms per
  request.
- 40 random delivered turns from other retained tables with no time or travel minutes: none reads `later_today` or
  beyond at ≥ 0.6 (one `later_today` at 0.46). No refusal would have fired.
- 20 random turns where the Keeper landed ≥ 240 minutes: real overnight skips read `next_day` 0.90, 0.97, 0.82 (one
  0.55). One turn landed 480 minutes, reads `later_today` 0.70 / `ends_at: evening` 0.99, and the clock after it read
  16:47 (afternoon). Exact day-part equality would have refused a Keeper that did account for the time, so F3
  tolerates an adjacent day part; the floor still catches turn 8 (15 minutes against a night). `next_day`'s floor is
  240, not 360: a skip from the small hours to the same morning is under six hours.
- `ends_at` alone is noisy on turns without a cut (turn 0 and 2 read `evening` at 0.42 / 0.50), which is why it is
  checked only after a cut is read (owner question 3 stays open).

**2026-09-26, TS-01..03 implemented** on `claude/keeper-time-skip-20260926` (`56603385e` .. `6ad5a7a6c`; line-2 @
`13ce6a7dd` merged in at `04e1e3400`, no conflicts).

- Kernel: `kernel-ts/apply/until.ts` (binds `until` before `stated`; days counted from the day the turn began, against
  the staged clock; an equal target lands 0 minutes); `kernel-ts/read/time-reading.ts` (the reading's shape, the gap,
  the refusal, the warning, the `unrecorded` row; pure, no prose read); one call site in `table.narrate` after
  `refuseRepeatedLine`; `DAY_PARTS`/`dayPartOf` exported from `read/capsule.ts` so the capsule's day part and §145's
  neighbour rule read one table (capsule bytes unchanged apart from the `head` sentence).
- Host: `runtime/jev/time-reading-domain.ts` (family `time-reading` v1), `timeReadingBudget` in
  `runtime/jev/host-budgets.ts` with `time_reading` in `content/rulesets/coc7/host-budgets.json`, `readTimeSkip` in
  `extensions/kernel/index.ts` on the explicit/embedded path and the implicit close, run concurrently with speech
  attribution (the same prose once tokens are stripped); a `time_unrecorded` refusal spends the turn's one steer in
  `runTool`'s catch; the opening is keyed on `openingPending`. `deliveryProse` factored out of `proseCharCount`.
  SL-00 inventory row `readTimeSkip`.
- Five admission test files counted every request to the Jev URL as an admission review; their stubs now answer the
  time-reading family 503 and leave it out of the count (`294267f9f`, `46eca710f`).
- Decisions made here: Score levels are plain strings (the adapter deep-compares Jev's echoed legend with the
  criteria); the opening is not read (same exemption as the floor, keyed on the opening itself); `PI_COC_TIME_READING=0`
  switches the reading off for an A/B arm.

**Suites (leehow-pc).** Baseline line-2 @ `13ce6a7dd`: ext 3401/0, py 1774 passed / 2 skipped, loop 201/0.
Branch: ext 3420/0 at `6ad5a7a6c` (+19, the new file); py at `6ad5a7a6c` 1798 passed / 2 skipped / 2 failed (+24 of the
26 new; the two failures, `test_narrate.py::test_ending_commits_campaign_status_and_remains_readable` and
`test_mod_director_text.py::test_narration_audit_joins_the_shared_audit_job`, are "kernel did not return a JSON line
within 30 seconds" under `-n 12` on a shared box, and pass on the Mac in 3.2 s; at `ed4d3da39` the full py was 1795/0);
loop 201/0 at `46eca710f`. The first ext run (before the stub fixes, and before
line-2's SL-93 re-scope was merged) had 123 failures, all SL-93's floor on explicit narrates, fixed upstream by
`bc05ff7ea`; after the merge, 9, all the stubs' counts.

**Mutations (restored by copy).** Kernel, on leehow-pc: floor ignored, day part ignored, neighbour not tolerated,
once-per-turn ignored, refusable ignored, unrecorded never raised, until ignores the staged clock, move minutes not
counted, until anchored on the staged clock, an equal target refused, a suggestion that ignores the turn start -- 11/11
killed. Host, locally: explicit always refusable, refusal does not spend the steer, implicit reading not attached, no
per-text cache, opening read, gate ignored, explicit reading not attached, a Keeper-sent reading passes through,
implicit always refusable -- 9/9 killed (one earlier survivor was an equivalent redundant `delete`, removed; one
survivor, "implicit always refusable", got the test that holds turn 8's position).

**TS-04, live tables** (Mac; Keeper `opencode-go/deepseek-v4.1-flash` thinking off, hybrid-v1; this session the only
player; outcomes pre-registered before the first turn). Evidence: `.coc/campaigns/time-skip-a`, `time-skip-b` and
their `.coc/playtests/` runs in this worktree.

- `time-skip-a` (5 turns, built before the two live fixes below). Turn 0: the automatic opening was read (it had
  settled a first-contact check and definitions, so the turn was `acting` and the implicit path's `opening` flag was
  false) -> fixed, the opening is keyed on `openingPending` (`705093dee`). Turn 5: the player went home for the night;
  the Keeper landed `minutes: 1050` (03:30 next day by its own count) and then `until {days: 1, time: "10:30"}`, which
  the staged-clock anchor put on day 3 against a day-2 prose -> fixed, days count from the day the turn began
  (`6ad5a7a6c`). This campaign's clock is left as it was (evidence).
- `time-skip-b` (7 turns, on `6ad5a7a6c`). Turn 0 not read. Turn 4 (the player waits in a cafe until dark): the Keeper
  landed 600 minutes, the prose ends at night, the reading was sent (`later_today` 0.68, `night` 0.97) and the kernel
  found no gap (20:04 evening is next to night): class A. Turn 5 (the player goes home, sanatorium in the morning): the
  Keeper landed two `until` effects in one batch, `{0, "21:30"}` then `{1, "07:20"}`; the clock reads day 2, 07:20
  (dawn), next to the prose's morning; sent (`next_day` 0.87), no gap: class A. Turns 6 and 7: the Keeper's own
  provider calls hit the 22.5 s call cap four times each and the host sent its outage notice; no delivery was
  attempted, so no reading ran (not this check's liveness).
- Not seen live: a Keeper that skips without landing time, so the refusal path ran only over the emitted kernel with a
  scripted Keeper (two real-kernel extension tests). Readings: 12 fresh, p50 560 ms, max 995 ms; no false refusal.
