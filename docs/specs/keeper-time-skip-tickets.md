# Keeper time skip — tickets

Spec: `docs/specs/keeper-time-skip.md`. Contract: §142. Branch `claude/keeper-time-skip-20260926` (from line-2 @ `855630ac5`).
Order: TS-01, then TS-03 (kernel), then TS-02 (host); TS-04 last.

## TS-01 — `apply time {until}`

Status: ready-for-agent

`time` takes `until: {days, time}` in the slot `minutes` fills; the kernel binds it against the staged clock, beside
`stated` (§136.22). Refusals `until_conflict`, `until_invalid`, `until_not_forward`. Receipt carries `until` and the
bound `minutes`. Tool schema and fake kernel offer it. Tests: `tests/kernel/test_time_until.py`, the extension schema
test. See spec F1.

## TS-02 — the host's time reading

Status: ready-for-agent

`runtime/jev/time-reading-domain.ts` (family `time-reading` v1: Score `cut`, Choice `ends_at`, state = delivery text
only), inventoried in SL-00; `time_reading` budget block in `content/rulesets/coc7/host-budgets.json`; taken on the
explicit, embedded and implicit delivery paths beside speech attribution; fail open; once per text per turn; opening
exempt; rides on `table.narrate` outside the digest with `refusable`; `lane: "time-reading"` telemetry. A kernel
refusal for `time_unrecorded` spends the turn's one steer, as SL-93's floor does. See spec F2.

## TS-03 — the kernel's reconciliation

Status: ready-for-agent

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
