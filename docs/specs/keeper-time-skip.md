# A time skip the Keeper narrates reaches the clock

Status: **ready-for-human** (TS-01 to TS-03 implemented on the branch, suites green, two live tables; the integrator
merges it into line-2); **needs-info** on the owner questions at the end, which this spec does not implement. Written 2026-09-26 from task card `task_b66b90e1` (the B2 table's clock).
Branch: `claude/keeper-time-skip-20260926`, cut from line-2 (`claude/integ-single-loop-2-20260926` @ `855630ac5`).
Contract: §145 (new). Related: `docs/specs/band-then-roll.md` (BR-06, §138.10 on `0.9.5a` only: the clerk lands
the time of the player's *declared* action), §51.4 (the capsule's `unrecorded`), §12.5 (the verifier's advisory
findings), §135.11 / §135.11.4.1 (one steer per turn; SL-93's floor on every delivery path), §34.12 (the refusal budget).

## What happened (evidence, table `npc-acts-b2`, read-only)

Campaign `chatrpgv4-wt-npc-actor/.coc/campaigns/npc-acts-b2`, branch `claude/npc-as-actor-20260926`, Keeper
`opencode-go/deepseek-v4.1-flash`, driver run `.coc/playtests/npc-acts-b2-20260926T163148Z`.

- Every committed turn record `turns/0000.json`..`0010.json` has `world.clock = {"minutes": 0}`; no turn holds a
  `time` receipt; the one `move` (turn 1) landed 0 minutes. The capsule showed the Keeper the clock every turn:
  `{"minutes": 0, "elapsed": "0 h 0 min", "at": "1920-10-12T10:00", "day_part": "morning"}`.
- Turn 8's delivered prose leaves the building at night and cuts to the next morning
  ("夜里没有别的事。第二天早上你回到这条街口……"). It closed **implicitly** (`closed_how: "implicit"`), under the
  run budget (`lane: "run", reason: "run_budget"`).
- **The Keeper knew and tried.** The driver's `turn-8.json` holds seven Keeper calls. Four `apply` batches each
  carried `{"kind": "time", "minutes": 15, "why": "…再到次日早晨回到同一扇门前"}` beside `npc` intent outcomes;
  the kernel refused the `npc` effects (`table_act_unsettled`, "a table act that rolled nothing is not done by saying
  so") and, a batch being atomic, the time with them. The first three were refused for that reason, which closed
  `apply` for the turn (§34.12, telemetry `lane: "refusals", reason: "class_limit"`); the fourth batch, a later
  `npc`-only call, and a **lone** `apply {time, minutes: 15}` were all refused `refusal_budget` with the NPC reason's
  text. `narrate` was refused once (`intent_result_owed`), and the final prose went out implicitly, skip included.
- **The amount was wrong too.** Fifteen minutes "to the next morning" from 10:00 would have left the clock at 10:15.
  `apply time` takes only `minutes`; the nearest rules row, `time-costs.sleep_night`, is 360–600 minutes, while
  10:00 → next day 08:00 is 1,320. A skip's length is set by the time it reaches, not by an activity cost.
- **The existing reader missed it.** The post-delivery verifier ran on turn 8 (`route: "incumbent"`, the Keeper
  model) and returned 0 findings, although its `uncommitted_state` kind names "elapsed time … absent from
  committedFacts". Even a hit is one advisory warning for one turn (§12.5).
- **Turn 9 ("the morning")** still has Arthur at the light switch saying "楼要锁了". The phrase began on turn 6 as a
  *generated* NPC act (`intent.generated: true`) at a clock reading 10:00 morning. The npc-actor branch's
  situation packet (`kernel-ts/npc/situation.ts`) carries no clock at all, so the generator could not have read the
  time of day. That is a separate reader gap on a branch not yet in line-2 (owner question 2).
- **Rate on the current Keeper model.** Over the 209 retained campaigns with at least 8 turns (worktrees and App),
  2,094 of 4,597 turns (46%) hold a `time` receipt; the npc-actor tables run with deepseek-v4.1-flash
  (`npc-acts-c`, `-c3`, `-c4`, `-b2`) hold 0 in 41 turns, and two grok-4.3-off long gates (`longgate19`, `20`) 0 in
  42. Compliance with "time passing is `apply`" depends on the Keeper model; a check on the delivery does not.

### Does line-2 already cover it?

No. Line-2 has no band code (BR-01..06 are on `0.9.5a` only; line-2 carries an early copy of the band spec, not its
§138). BR-06 would not cover it either: its clerk candidate is the time of the **player's declared action** (a
"fact about the declaration", routed `costs`/`none`), never after the turn already holds a `time` receipt, and it
reads the declaration, never the Keeper's prose. On turn 8 the player declared nothing that costs a night
("好啊。那我明天就给你们总编写封信……" is talk about tomorrow); the skip was the Keeper's choice.

## Diagnosis: which system path failed

The invariant is "the world changes only through `apply` … what happens in narration without an `apply` did not
happen" (`prompts/keeper.md` rule 2; the `apply` tool description). For time, all three ends of the seam (§31) exist,
and none of them caught this:

1. **Writer.** `apply time {minutes}`. The Keeper wrote it seven times. It was lost to batch atomicity plus a
   refusal budget that closes the whole tool, and its amount was a guess the tool offers no way to avoid.
2. **Reader.** The capsule's `clock` (every turn) and `look focus time` (minutes only; owner question 5). The
   capsule's reading was present and the Keeper acted on it; not the gap.
3. **Reconciliation.** Nothing compares the delivered prose's time with the books. Markers that name nothing are
   dropped from a delivery (§40.4); a clue told without `apply clue` is recorded as `unrecorded` (§51.4); a person
   given lines off the board likewise. A time skip told without `apply time` has no counterpart. The verifier's
   `uncommitted_state` is the only reader, is advisory, lasts one turn, and missed this case.

So the gap is (3), with a usability defect in (1). The fix does not touch the prompt.

## Choosing the shape

| Shape | Evidence | Verdict |
| --- | --- | --- |
| Prompt and card make the clock visible and require `apply time` for a skip | The clock is already in every capsule and `look`; the prompt already requires `apply` for time passing (rules 2, 4, and the source-wait paragraph); the Keeper tried seven times | **Rejected.** It would not have changed turn 8. |
| Rely on the post-delivery verifier (`uncommitted_state`) | 0 findings on turn 8; advisory, one turn; one question over five kinds of change | **Rejected** as the fix; unchanged. |
| The host lands the time itself from a reading of the prose | A Jev reading alone would move the clock, and time ≥ 60 min regenerates magic points and ≥ 360 min heals (rest); consequences are the Keeper's (§135.3), and "an irreversible act is never Jev's alone" | **Rejected.** |
| **The delivery is reconciled with the books: a typed reading of the prose's cut, compared by the kernel with this turn's time, refused once, then delivered with a finding that stays until a time receipt lands** | Covers the implicit path (turn 8 was implicit); follows the house pattern for delivery checks (SL-93's floor, §139.10's markup gate on the npc-actor branch: refuse once, never cost the player the turn); the finding reuses §51.4's `unrecorded` | **Chosen**, with `apply time {until}` so the refusal's fix is one call with no arithmetic. |

## The fix

### F1 — `apply time {until}` (kernel, TS-01)

`time` accepts `until: {days, time}` in the slot `minutes` fills: `days` is a non-negative integer counted from the
day this turn began (0 = that day, 1 = the day after), `time` is a local `HH:MM`. The kernel binds it where `stated`
binds (§136.22): minutes = the target local minute − the staged clock's local minute (after this batch's earlier
effects), and a target equal to the clock lands 0 minutes, so the same `until` twice is one time. It works on a
dated clock (`at`) and an undated one (`day`, `hh`, `mm`) alike, so no calendar arithmetic reaches the Keeper.
Refusals (`invalid_params`, `details.field: "until"`): `until_none` on another kind; `until_conflict` beside
`minutes` or `stated`; `until_invalid` (not `{days: integer ≥ 0, time: "HH:MM"}`); `until_not_forward` when the
target is before the current clock (`details.clock` names the current reading; `fix` says a time already past is
`days` ≥ 1). The turn's day, not the staged clock's, came from the live table (TS-04 comments, `time-skip-a` turn 5). The receipt carries `until` and
the bound `minutes`; rest, magic-point recovery and admission treat it as any `time`. The tool schema offers it with a
one-line description; the fake kernel accepts it.

### F2 — the time reading (host, TS-02)

One Jev request per delivery attempt, two questions (fan-out), family `time-reading` version 1
(`runtime/jev/time-reading-domain.ts`), registered in the SL-00 call-site inventory:

- `cut` — a Score over situations, lowest first: `continuous` (played moment to moment, nothing skipped),
  `short` (a short stretch skipped within the same scene or errand: minutes up to about an hour), `later_today`
  (the text moves on to later the same day: hours), `next_day` (the text passes a night or moves to the next day),
  `days` (several days or longer). Instructions: count only stretches the text skips over without playing them
  through; not the length of actions it describes, and not memories, plans or talk about another time ("tomorrow"
  in a line of dialogue is not a cut).
- `ends_at` — a Choice: the part of the day the text's last moment is set in, as the text itself shows it (light,
  lamps, meals, opening or closing hours), over the capsule's own day parts (`small_hours`, `dawn`, `morning`,
  `midday`, `afternoon`, `evening`, `night`) and `not_shown`.

State is the delivery text with markers and say tokens removed (the spoken words stay). Nothing else: not the clock
(Jev does not compare times), not the Keeper's calls. The answer is the argmax level with its confidence. Taken on all
three delivery paths (explicit `narrate`, `apply`'s embedded narrate, the implicit close), at the same time as speech
attribution and before the Mod hooks, capped by `time_reading.timeout_ms`
(`content/rulesets/coc7/host-budgets.json`). No key, a timeout or an error sends the delivery without a reading
(fail open; a telemetry row with `reason`). The same text is read once per turn. The opening delivery is exempt,
as it is from the floor. When a cut is read (F3), it rides on `table.narrate` as host-only `time_reading: {cut,
confidence, floor, ends_at?, refusable}` and, like `keeper_reads` (§135.31), is not part of the call's digest.
`refusable` is false when the host could not hand a refusal back: the turn's one steer (§135.11) is already spent, or
the delivery closes the opening.

### F3 — the reconciliation (kernel, TS-03)

`table.narrate` compares the reading with the books. The host sends a reading only when a cut was read: `cut` at
`later_today` or beyond with its confidence ≥ the gate, with that cut's floor, and `ends_at` only when it is shown
with confidence ≥ the gate. A **gap** is: this turn's clock movement (the `time` receipts' minutes plus the `move`
receipts' minutes) is below the floor, or `ends_at` is neither the clock's `day_part` after this turn nor the day part
next to it (the capsule's cyclic order small_hours, dawn, morning, midday, afternoon, evening, night). Gate and
floors are data (`time_reading.min_confidence`, default 0.6; `time_reading.floors`: `later_today` 60, `next_day`
240, `days` 1440; the probe in the tickets' Comments is why 240 and why a neighbouring day part passes). The kernel
does arithmetic on the reading; it never reads the prose.

- **First delivery of the turn with a gap, `refusable`:** refused `needs`, `details = {reason: "time_unrecorded",
  cut, ends_at, clock: {…the capsule's clock reading…}, landed_minutes, floor, suggest?: {until: {days, time}}}`.
  `suggest` is present when `ends_at` is shown: the start of that day part (the kernel's own day-part table) on the
  day the cut implies (`later_today`: today if still ahead, else tomorrow; `next_day`: tomorrow; `days`: none).
  `fix`: land the skipped time with `apply time` (naming `suggest` when present), then deliver again; or keep the
  prose inside the time the books hold. `turn.json` keeps `time_gate: {call_id}`.
- **Any later delivery in the same turn, or not `refusable`:** delivered as written; the turn record carries one
  `warnings` row `{lane: "delivery", kind: "time_unrecorded", quote: null, why, fix, cut, ends_at, at}`.
- **Across turns:** the capsule's `unrecorded` gains a third kind: the most recent `time_unrecorded` warning on an
  earlier turn, `{time: cut, turn, ends_at, operation: "apply time", line}`, until a later turn holds a `time`
  receipt. Like the clue and person rows it says the two records disagree and names the call that closes it; it is
  not a debt and does not refuse anything.
- **Telemetry:** the host's `lane: "time-reading"` row per reading (`turn, call_id, path, ok, cut, cut_confidence,
  ends_at, ends_at_confidence, distribution, ms, reason?, skipped?`); the kernel's `lane: "delivery", reason:
  "time_unrecorded"` row with `outcome: "refused" | "delivered"`.

How turn 8 would have gone: the implicit draft is read (`next_day`, `morning`); the turn holds no time receipt;
the one steer is unspent (the floor did not fire), so the kernel refuses and the fix rides the host's existing
`audit-repair` steer. The Keeper either lands `apply time {until: {days: 1, time: "08:00"}}`, which admission reviews
like any time the investigator spends, or cuts the skip. With `apply` closed by the budget, only the second is open.
If the steered leg still carries the skip, it is delivered with the finding, and turn 9's capsule tells the Keeper the
books still read day 1, 10:00.

### Three ends (§31)

*Writer:* the Keeper's `apply time` (now also `until`); the kernel's comparison writing the refusal, the warning and
the `unrecorded` row. *Reader:* the Keeper, through the refusal's `fix`, the next capsule's warnings, and `unrecorded`.
*Actor:* the Keeper landing `apply time` or rewriting. Counted by the kernel's delivery rows (refused → a `time`
receipt on the same turn) and `tests/play/kpi.py`'s lanes section.

## Tests (per ticket)

- TS-01 `tests/kernel/test_time_until.py` over the emitted kernel: dated and undated clocks; days 0 and 1; a batch's
  earlier `time` moves the base; conflict, invalid and not-forward refusals write nothing; replay returns the
  journaled receipt; ≥ 360 minutes by `until` heals like minutes. `tests/extension` schema test: `until` offered on
  `time` only, passed through untouched; fake kernel accepts it.
- TS-02 `tests/extension/time-reading-domain.test.mjs` (the questions, state is the text only, the argmax and its
  confidence, every non-answer's reason) and `tests/extension/time-reading.test.mjs` over the fake kernel (the reading
  rides on all three paths, never in the digest; opening exempt; fail-open rows; read once per text).
- TS-03 `tests/kernel/test_time_reconciliation.py` over the emitted kernel: the gap on a missing time, on too little
  time, on a day-part mismatch; no gap below the gate, on `short`, or when the time landed; refused once then
  delivered with the warning; `refusable: false` delivers with the warning; `suggest`; the `unrecorded` row appears
  next turn and clears after a later `time` receipt. One end-to-end test over the real kernel: an implicit close with
  a stubbed reading is refused, the steered leg lands `until` and delivers.
- Every mutation of the comparison (floor ignored, day part ignored, gate ignored, once-per-turn ignored) is killed.

## Verification beyond tests

1. Jev on the real prose (Mac, live): read turns 0–10 of `npc-acts-b2` plus a sample of retained deliveries from
   other tables; turn 8 must read `next_day` with `ends_at: morning`, and turns without a cut must not read
   `later_today` or beyond above the gate. Record the distribution per turn in the ticket.
2. One real table (driver, the Keeper model of the day, this session as the only player) with a natural break where
   the Keeper is likely to skip (leaving a place at closing time). Evidence: the turn record's receipts and
   warnings, the capsule clock on the following turn.

## Owner questions (not implemented here)

1. **The refusal budget closes the whole tool** (§34.12, your ruling of 2026-09-11: "相同的问题 3 次不行就不能重试了").
   On turn 8 it refused a lone `apply time` because three *NPC-intent* refusals had closed `apply`. Should it close
   only calls that would repeat the refused reason (for example, the refused effect kinds), leaving unrelated
   writes open?
2. **The NPC act generator has no clock** (npc-actor branch, `kernel-ts/npc/situation.ts`, §139.1). "楼要锁了" at
   10:00 was generated there. Add the capsule's clock reading to the situation packet on that branch?
3. **Day-part drift without a cut.** Turn 6 described dusk and closing time while the clock read morning; F3 only
   checks the day part when a cut is read. Check it on every delivery? That makes the clock stricter than "the
   Keeper's pacing gauge" and would push Keepers that rarely write time into refusals.
4. **Line-2 lacks BR-05/BR-06.** The turn-1 move landed 0 minutes (no road minutes on line-2). Merging `0.9.5a`
   into line-2 brings both; no change here.
5. **The Keeper's clock readers show minutes only.** `look focus time` answers `{"clock": {"minutes": 75}}` and
   every `apply` result's `world.clock` is `{minutes}`; the local time is only in the capsule. On `time-skip-a` turn 5
   the Keeper looked at the time, got minutes, and double-counted a night. Giving both the capsule's reading
   (`at`/`day`, `day_part`) is small, but `look focus time` is pinned by existing tests and the frozen-oracle parity
   test, so it is not changed here.

## Comments
