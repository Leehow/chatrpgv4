# Refusal recovery carries the turn forward

Status: ready-for-human (RR-01..RR-03, RR-05, RR-06 implemented on `claude/refusal-recovery-20261008`; contract §197; RR-04
is the lead's table acceptance)

Lead's rulings, 2026-10-08, after TR-F2 run 2. Owner: 「KP发了些没有什么有意义的信息的回复…肯定是系统问题」,
「玩家意图没有正确执行也是系统问题」. Contract `docs/kernel-rpc.md` §197 (amends §32.2 and its 2026-10-08 speech paragraph, §32.8, §32.12.3.1, §32.12.3.1.1 and
the role-first revision of §32.12.3.2). Two coordinator messages during the slice added real table run 3's cases
(§197.5) and the root cause of the refusal surge, `ab81805b2` (§197.4).

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

## Added during the slice (coordinator, 2026-10-08)

5. **Speech is not execution, and the player's own narration is** (§197.4). `ab81805b2` (written for TR-F turn 3: 「我今天就动身去农场」
   said to the captain while asking names moved the table) read one direction only; refusals went from 0 in 16 campaigns to
   4 per table, the player's own narrated trips read as "plans" (run 2 T3, T16; run 3 T9). The note
   (`PLAYER_EXECUTION_CHOICE_NOTE`) now says both directions with the paired real-table lines as examples; the role-first
   `chosen.what`/`not_for` too; v1 family 3, role-first 2a.6; the Keeper prompt's paragraph too. The lane fills a closed
   `player_words` (`narrate|ask|say|quote|hold|none`) first; the host records it and decides nothing from it.
6. **Meaning, finds and holding back** (§197.5; run 3, lane luna): T1 alias across languages refused, T9 a request refused
   against an earlier plan's wording, T12 a find of a chosen search refused (and the journal with it), T16 a held-back move
   into the cellar authorized and landed. Four instruction paragraphs and the verdict definitions; no lists.

Verification of 5 and 6 is the model's behaviour, so it was measured live (§197.9): three pre-registered rounds on luna,
fourteen real lines; round 3 met all fourteen expectations.

## Tickets

### RR-01 A refused batch names its admitted lines; their exact resend lands without a second review
Status: ready-for-human (implemented; §197.1)

### RR-02 `open_choice` and the branched fix
Status: ready-for-human (implemented; §197.2)

### RR-03 The acting party and the NPC-act instruction
Status: ready-for-human (implemented; §197.3)

### RR-05 Two-way speech/execution boundary and `player_words`
Status: ready-for-human (implemented; §197.4; live probe §197.9)

### RR-06 Meaning across languages, finds of a chosen search, holding back
Status: ready-for-human (implemented; §197.5; live probe §197.9)

### RR-04 Acceptance (lead)
Status: ready-for-human (TR-F2 rerun, lead).
Pre-registered: on a fresh campaign of the same book, per refused multi-line batch, `details.admitted` names every line the
lane admitted and the next Keeper call resends exactly those (`recovered_from` on its row, no `lane-call` rows for it); per
refusal with `open_choice: keeper_added`, the delivery does not ask the player the choice named in `missing`; an NPC's
hand-over line carries `acting_party` and is not refused as the player's unchosen act. Count C2 (intent carried out) and C3
(the reply says something) as in TR-F2's log.
Also: admission refusals per table back near the pre-`ab81805b2` rate; the player's narrated trips and requests
admitted; a line said to an NPC about a future act refused (`player_words: say`); a held-back move refused (`hold`).

## Comments

### 2026-10-08 implementation (claude/refusal-recovery-20261008)

Tests: `tests/extension/refusal-recovery.test.mjs` (contract §197.8's list), with the TR-F2 replays in
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

Mutations (each applied to a copy, the file restored by copying the saved original back, `git status` clean after; run on
single files with the box's `build/`), every one turned a test red:

| | Mutation | Red |
| --- | --- | --- |
| M1 | the per-line review returns at the first `not_authorized` again | 6 in `refusal-recovery` (T3, T16, emitted kernel, prefetch, …), 1 in `admission-lines-parallel` |
| M2 | `batchRefusal` never names admitted lines | 7 |
| M3 | no recovery seeding (the resend is reviewed) | 6 |
| M4 | `recoveryMatches` accepts a superset | 2 (pure; the line-added resend) |
| M5 | the prefetch reviews a recovery | 1 (the §32.12.4 test: 4 lane calls) |
| M6 | `shapeVerdict` drops `open_choice` | 5 |
| M7 | `admissionRefusal` ignores `open_choice` | 6 |
| M8 | `acting_party` not printed | 3 (pure, §197.3 seam, T1) |
| M9 | an accepted offer read as the giver | 1 (pure) |
| M10 | the instruction does not name `acting_party` | 1 (the pairing guard) |
| M11 | admitted lines read only from this call's statuses | 6, and 2 in `admission-lines-parallel` |
| M12 | host-only `_` fields resent | 1 |
| M13 | `admitted` named on `review_pending` | 1 |
| M14 | the recovery entry never recorded | 6 |
| M15 | the paragraph appended twice on a nested refusal | 1 |

### 2026-10-08, §197.4-§197.5 (coordinator's two messages)

Existing tests changed: `tests/extension/admission-roles-domain.test.mjs` (read whole first) pinned 2a.5 and the
one-direction `chosen.what`/`not_for` phrases; it now pins 2a.6 and the two directions; its subject (only the choice
question differs from the measured requests) is unchanged.

Live probe (`experiments/refusal-recovery/probe.mjs`, `build_cases.py`; cases and grounds kept outside the repository):
pre-registration written before the first full round and amended, with the previous round's result, before each later
round. Round 1 (old 4ce2e4cab prompt against the first rewrite): old met 7 of 14 (4 counting `keeper_added`), new 10;
round 2 (`player_words`, verdict definitions): 13; round 3 (a request's result may be a record other than the one asked
for): 14 of 14. One smoke call preceded the pre-registration of the speech case and is not counted. 182 calls in all,
`openai-codex/gpt-6-luna`, thinking off; the App's `auth.json` was read by the product's runtime and not written (its
mtime is unchanged).

Mutations for §197.4 (same method): M16 `shapeVerdict` drops `player_words` -> 3 red; M17 the row omits it -> 2 red; M18
role-first revision not bumped -> red in both files; M19 the role-first criteria restored to the one-direction text -> red in
`admission-roles-domain`; M20 the lane prompt without the note -> red. **Not covered by a deterministic test:** the
wording of the note, the four §197.5 paragraphs and the verdict definitions -- what they do is the model's, and §197.9's
probe is their evidence.


### 2026-10-08, resumed slice (the previous worker's process exited after `28e5290e1`)

Checked against the lead's six points; all six were in the three commits. What was missing or unmeasured:

- **Run 3 T1 had a fixture and no test.** New: `run 3 T1 replay on the emitted kernel` -- the table's move verbatim, the
  starter's `newspaper-morgue` (the table's place, same `destination_identity`), turn 1 closed at the opening. The line the
  lane reads carries the same `canonical_name` and `also_called` the table's reviewer was shown ("Globe clipping archive"
  included), and on the probe's answer (`narrate`, `authorized`) the move lands with its receipt.
- **Every §197.1 test ran on the legacy loop; the App plays on `hybrid-v1`** (`runtime/loop-engine.ts`: play's default).
  New: `§197.1 on the App's run engine (hybrid-v1)` -- the refused batch step falls (§135.5), the run returns to the Keeper,
  its next step holds `details.admitted` in the tool result and in the run's `model_refused` note
  (`coc_error.details.admitted`, carried whole by `hybrid-engine.ts`), and the resend lands with no lane call. The note's
  own text ("this note grants no retry or correction allowance") is about the note, and it tells the Keeper to read each
  `coc_error`'s fix; it was left as it is.
- **The probe's round 3 predates the commit's last edit of `admission.ts`** (11:36:54 against 11:41:59), so the committed
  prompt was measured on its own, then amended once (contract §197.5's note, §197.9's last two rounds). Pre-registration,
  cases and outputs are in the scratchpad (`rr/probe/`), the cases outside the repository as before. 42 + 140 calls,
  `openai-codex/gpt-6-luna` thinking off; the App's `auth.json` was read by the product's runtime and not written (mtime
  05:22:13 before and after both rounds).

Existing tests changed: none (the test file gained two tests and a `kernelSteps` helper shared by the two emitted-kernel
fixtures; `turnOneClosed` is unchanged in what it does).

Mutations (same method: the file copied aside, one exact replacement, the saved copy copied back and its digest checked;
single file on the Mac, `node --test tests/extension/refusal-recovery.test.mjs`), each run on the whole file so the run-3
tests added in `28e5290e1` are covered too. MA, MB, M1, M2, M7 and M17 ran before the hybrid-v1 test existed (21 tests);
M1 and M2 were then rerun on that test alone, M3 ran on all 22, MH on the hybrid-v1 test:

| | Mutation | Red |
| --- | --- | --- |
| MA | the move line without `also_called` | 1 (run 3 T1) |
| MB | `shapeVerdict` drops `player_words` | 4 (run 3 T1, run 3 T16, the §197.4 replays, the §197.4 pairing) |
| M1 | the per-line review returns at the first `not_authorized` | 7, run 3 T12 among them; and the hybrid-v1 test |
| M2 | `batchRefusal` never names admitted lines | 8, run 3 T12 among them; and the hybrid-v1 test |
| M3 | no recovery seeding | 8, the hybrid-v1 test among them |
| M7 | `admissionRefusal` ignores `open_choice` | 7, run 3 T16 among them |
| M17 | the row omits `player_words` | 3 (run 3 T1, run 3 T16, the §197.4 replays) |
| MH | `hybrid-engine.ts`'s model refusal drops `coc_error` | 1 (the hybrid-v1 test) |

The two instruction amendments are model behaviour, not host behaviour; their evidence is §197.9's round 4, and no
deterministic test pins their wording.
