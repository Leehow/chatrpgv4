# Refusal recovery carries the turn forward

Status: ready-for-human (RR-01..RR-03 implemented on `claude/refusal-recovery-20261008`; contract §197; RR-04 is the lead's
table acceptance)

Lead's rulings, 2026-10-08, after TR-F2 run 2. Owner: 「KP发了些没有什么有意义的信息的回复…肯定是系统问题」,
「玩家意图没有正确执行也是系统问题」. Contract `docs/kernel-rpc.md` §197 (amends §32.2, §32.8, §32.12.3.1, §32.12.3.1.1).

## What went wrong (TR-F2 run 2, App `4ce2e4cab`, Cold Harvest, campaign `game-565055f1-…`)

Six of eighteen turns (T1, T3, T9, T15, T16, T18) ended with the player's intent not carried out and a reply with nothing
in it. This spec is the admission-refusal half:

| Turn | What the player said | What admission did | What the Keeper then did |
| --- | --- | --- | --- |
| T1 | 「…阿加宁上尉同志在吗？」没人应声的话，我就解开档案袋的麻绳… | The Keeper's `object` line put the folder in the investigator's hands, the captain's hand-over only in `why`; refused: 「档案袋由上尉递交给索科洛夫这一转移；玩家选择的是无人应答时自己动手解绳」 | 「屋里没有回应」; the folder was not opened either |
| T3 | …搭最早的车赶往…3号农场。到了先找生产监督员鲍里斯。 | Line 1 (the farm) `authorized`, line 2 (Gapon's remote house) `not_authorized`; `batch_admitted: false`, nothing landed | Asked 「是否特意去他单独的住处，还没有定下」 |
| T9 | …让他指路，我去她家看尸体。 | The move to the dead witness's home was mapped onto the Abramov house; refused with missing "which household … the dead witness's home, as the player said, or another place" | Asked 「要去看的，是嘉琳娜的家，还是你另有所指？」 |
| T16 | 我现在就去最北头的阿布拉莫夫家，敲门。 | Line 1 (a detour via the farm) refused at 9 911 ms; line 2 (the house the player named) **stopped unanswered** (`line_ms: [9911, null]`) | Asked 「先去3号农场，还是直接去阿布拉莫夫家」 |

Three system gaps, not three bad turns:

1. **All or nothing, and the fix forbids the recovery.** A batch refused on one line lands none of its lines (§32.12.3.1,
   kept), and the refusal's `fix` -- "do not resend the same action in other words" -- forbade landing the lines the player
   had chosen. T16's admitted line was not even known: a `not_authorized` line stopped the others.
2. **The refusal always asks the player.** `missing` could be the Keeper's own addition (T3) or its wrong mapping (T9); the
   fix told the Keeper to put it to the player either way.
3. **An NPC's act is read as the player's.** An `apply` line names no actor; the reviewer read the captain's hand-over
   against the player's conditional plan.

T15 (review timeout at the 26 s hard cap) is the timeout policy: not in this spec. T18 (`walk_on` for a person on the table)
is not admission.

## The rulings (lead) and how they were implemented

1. **A refused batch names its admitted lines** (§197.1). The other lines of a batch finish when one is refused (up to the
   cap); the refusal carries `details.admitted` (the effects verbatim) and a `fix` paragraph: resend exactly those once,
   unchanged, before the delivery, refused lines left out. The host recognises the resend by the lines' identifying
   signatures (exact multiset) and reuses their kept verdicts under the keys the resend looks up -- no lane call, no typed
   call -- while a changed, added or dropped line is reviewed as any call is. Kernel atomicity is unchanged: the Keeper
   sends the lines.
2. **The refusal says whose choice is open** (§197.2). The lane's answer gains `open_choice: keeper_added | player_open`;
   `keeper_added` gets a `fix` that carries out the player's choice instead of asking; `player_open` and a refusal that does
   not say keep §32.2's question.
3. **An NPC's act is not the player's** (§197.3). The line names `acting_party` when the effect's own closed fields say a
   non-investigator performs it (`object` `handover`/`offer`, `clue` `from`); the reviewer's instruction says that person's
   giving, taking or telling is their own initiative (`not_player_action`), and that a line naming no acting party may
   still be another's act; the Keeper's `object.from` description asks for the giver on a first placement.
4. **Not changed:** the review-timeout policy (T15), what §32.1 puts to review, the verdicts, the typed reviewer, kernel
   atomicity.

### Recorded decisions

- **Waiting for every line.** T16 shows that naming admitted lines needs them to finish. The early stop on `not_authorized`
  (§32.12.3.1) is removed; a refused batch now waits for its slowest line up to the cap, which is what an admitted batch
  already waits. The alternative -- stop at once and let the Keeper's resend be reviewed -- costs the same wall time and a
  review, and gives the Keeper nothing to resend exactly.
- **"Once" is the Keeper's instruction, not a host counter.** The recovery entry is kept for the turn like a verdict
  (§32.4), so a recovered call the kernel refuses for its own reasons can be resent with the staging fixed. It only ever
  reuses the same verdicts on the same lines.
- **The dependency boundary.** A recovery reuses a line's verdict without the refused lines it was judged beside, which
  §32.12.3.1.1 otherwise forbids. The host cannot judge whether an admitted line only made sense beside the refused one (no
  list could); the Keeper is told to leave such a line out (the call is then reviewed afresh). A Keeper that resends it
  anyway lands it on its verdict: pinned by its own test.
- **"Reviewed against the fiction and the book".** Admission judges agency; whether an NPC's act is true stays with the
  Keeper (who holds the book), the kernel and the verifier, as §32.2's 2026-09-21 clarification and §32.3 already say. The
  lane gets no book access here; giving it some would amend §32.3 and is the lead's or owner's call.
- **`item` is not read for an acting party.** Its `from` names who a thing came from whether they gave, sold or lost it.
- **Host verdicts carry no `open_choice`.** §143.18's compile act refusal and the cash authority bound keep §32.2's text.
- **`open_choice` is advisory.** An unknown value or a misplaced field is dropped, never `bad_output`.

## Tickets

### RR-01 A refused batch names its admitted lines; their exact resend lands without a second review
Status: ready-for-human (implemented; §197.1)

### RR-02 `open_choice` and the branched fix
Status: ready-for-human (implemented; §197.2)

### RR-03 The acting party and the NPC-act instruction
Status: ready-for-human (implemented; §197.3)

### RR-04 Acceptance (lead)
Status: ready-for-human (TR-F2 rerun, lead).
Pre-registered: on a fresh campaign of the same book, per refused multi-line batch, `details.admitted` names every line the
lane admitted and the next Keeper call resends exactly those (`recovered_from` on its row, no `lane-call` rows for it); per
refusal with `open_choice: keeper_added`, the delivery does not ask the player the choice named in `missing`; an NPC's
hand-over line carries `acting_party` and is not refused as the player's unchosen act. Count C2 (intent carried out) and C3
(the reply says something) as in TR-F2's log.

## Comments

### 2026-10-08 implementation (claude/refusal-recovery-20261008)

Tests: `tests/extension/refusal-recovery.test.mjs` (contract §197.6's list), with the TR-F2 replays in
`tests/extension/fixtures/refusal-recovery-trf2.json` (T1, T3, T9, T16: player words and `apply` arguments copied verbatim
from the session `2026-10-08T12-52-28-304Z_3fc2f27a…jsonl`, lane verdicts from the turns' `lane: "admission"` rows).

Existing tests changed, each read whole before the change:

- `tests/extension/admission.test.mjs`, "a refused batch draws no dice…": it asserted one row ("only the refused line
  answered; the others were stopped"). Under §197.1 every line answers: three rows, the two admitted ones with
  `batch_admitted: false`. Its subject (nothing reaches the kernel, the missing choice travels) is unchanged.
- `tests/extension/admission-lines-parallel.test.mjs`, "a line refused not_authorized decides the batch at once -- the other
  calls are stopped…": rewritten for §197.1 on the same manual clock: the refusal at 200 ms does not end the call; the other
  lines answer at 1 s and are named in `details.admitted`; the identical resend is refused at once on the kept line and names
  them too; nothing lands and nothing is left pending. The file's header says the same.
- `tests/extension/involuntary-admission.test.mjs`: a comment only (it said other lines "may be stopped").

Mutations: see the report below the box results.
