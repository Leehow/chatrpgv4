Status: ready-for-human (filed 2026-09-29 from the installed-App Dust to Dust table; owner asked "时间行缓存那条…查一下吧"; follow-up of SL-101; owner chose A + B 2026-09-29; implemented 2026-09-29 on claude/sl104-admission-batch-context-20260929; merged into 0.9.6a at bf65b781a on the owner's word ("直接合"); the live latency check was not run)
Stage: SL-104 (admission: a line reviewed on its own is judged on its siblings and its rationale, then its refusal is reused for a batch whose siblings changed)
Spec: docs/kernel-rpc.md §32.4 (reuse key; `why`, `how`, `label`, `decision` outside it), §32.12.3.1 (SL-101: one lane call per line, "each call gets the same §32.3 context and exactly one proposed line", "verdict reuse keys by line"); `extensions/kernel/admission.ts` (`effectSignature` ~295, `admissionRequest` ~309, `lineProposal` ~720), `extensions/kernel/index.ts` (`admissionLines` ~2470, `admitOne` / `settle` ~2620, `state.admission.get(proposal.key)` ~2654)

# SL-104: a line is refused for its sibling's destination, and the refusal outlives the sibling

## Evidence (installed App at ce1fa4138; campaign `game-5d82fd23-6c33-4efc-b8ef-bb65ccadf046`; turn 25; admission lane `opencode-go/deepseek-v4.1-flash`, thinking off)

Player: 「我把报纸折好收进大衣内袋，向摊主打听去马丁滩怎么走，然后动身前往马丁滩，想亲眼看看波街公墓。」

The Keeper's second `apply` carried two reviewed lines, split per line by SL-101 (`batch_key` `ffbc2a3b0982`):

| line | proposed | verdict | grounds (the lane's own words) |
|---|---|---|---|
| 1 | `apply time: minutes=55; why="…驾车沿近郊公路抵达渔村"` | `not_authorized` (key `d991808df843`) | 玩家选择问路并前往马丁滩公墓，但Keeper只将时间推进55分钟到达渔村，未到达所说目的地。 |
| 2 | `apply move: to="martins-beach-field"; travel_minutes=0; …` (the fishing village) | `authorized` (key `1f7203419e74`) | 玩家…明确选择马丁滩为目的地并动身。 |

The same batch got two contradictory readings of one destination: the move to the village is what the player chose, and the 55 minutes are refused for "only reaching the village". The refused line decides the batch (§32.10), so nothing lands.

The Keeper then re-sent with the destination changed to the cemetery (`move to="poe-cemetery-visit"`) and the time's `why` rewritten ("…抵达渔村并直至波街公墓"). The time line's key was identical (`d991808df843`, new `batch_key` `aa8d74809f63`), so it came back `reused: true`, `ms: 0`, with the first grounds, which talk about a destination this batch no longer proposes. The refusal also told the Keeper `next: change_input` and "do not resend the same action in other words", so there was no lawful way left in the turn: the Keeper delivered the directions and the trip never landed.

Downstream (not this ticket, recorded so the cost is visible): the arrival at Martin's Beach — where §39.2 places the village map on first arrival — slipped three turns; turn 26 closed with prose describing an arrival that was never landed, and turn 27's clerk moved the investigator to the wrong cemetery. See `docs/specs/forward-only-reconciliation.md`.

## What is by design, and what is not

- By design (§32.4): the key is the effect's identifying fields; `why` and `label` are outside it, so a rationale bolted on or a rewording reuses the verdict. For a time line that is `{kind: time, minutes: 55}`.
- By design (SL-101): each line has its own lane call, which reads exactly that one line, and its verdict is kept under the key a call of only that line would have.
- **Not by design:** §32.4's reuse is only sound when the verdict depends on nothing outside the key. SL-101 made that false for lines. A line judged alone still gets judged *about* its batch — here the lane read the destination out of the time line's own `why` and out of what the player said, then refused the time for the move's destination. The grounds rest on two things the key does not carry: the rationale (`why`) and the sibling line. When exactly those change, the stale verdict is reused.
- Contributing, not the cause: the Keeper put the travel into a separate `time` with `move.travel_minutes: 0` (the common pattern: §138.9 records 912 of 1,376 retained moves landing with 0 minutes). Had the minutes been on the move, they would have been judged with it.

## Design options (owner decision 2026-09-29: A + B; implemented, see Comments)

- **A. The line's call sees its batch.** Each per-line call keeps judging exactly one line, but its input also lists the batch's other reviewed lines as read-only context ("the same call also proposes: …; judge only line k"). Parallelism is kept; the prompt grows by the siblings' lines. The time line above would have been read next to the move it pays for.
- **B. The line's key carries its batch.** The per-line reuse key becomes the line's signature plus the order-free signatures of the batch's other reviewed lines. An unchanged resend still reuses (the §32.4 rewording rule holds, `why` still outside); a resend whose siblings changed is judged again.
- A and B together are consistent: if the verdict may depend on siblings (A), the key must include them (B). B alone stops the stickiness but leaves the misjudgment; A alone fixes the misjudgment but leaves an equally sticky wrong verdict whenever it still occurs.
- Rejected: the host folding a `time` into the batch's `move.travel_minutes`. Whether minutes are travel or time spent on arrival is a semantic question, and code must not guess it.

Recommendation: A + B. Cost to measure before landing: SL-101's per-line latency (the call reads more text) on the #23 bank and on this turn's batch.

## Tests (mutation-killable)

- Reconstruct turn 25's batch: the time line's lane input contains the sibling move line (A).
- Resend with the move's target changed: the time line is reviewed again, `reused: false` (B). Revert B and the test must fail.
- Resend unchanged, or with only `why` / `label` changed: every line is `reused: true` (§32.4 kept).
- One-line batches, compile / consequence / typed-settled lines: unchanged.
- Offline re-run of the lane on this turn's batch and on the long gate #23 batches (admission-jev-bank): report verdict changes and per-call wall time.

## Comments

**2026-09-29 -- new context since filing: §156 does not close this.** §156 landed on 0.9.6a the same day: a move counts its
own journey, and a `time` beside a travelling move must declare `beyond_travel` (a kernel guard), and the tool
descriptions steer travel into `move.travel_minutes`. That makes turn 25's exact shape rarer. It does not close this
ticket: admission runs before the kernel's guard (a line is judged, and its verdict kept, before the kernel ever sees the
batch), a move of 0 minutes (turn 25's own `travel_minutes=0`) is outside the guard, and the defect is the class, not the
pair -- any reviewed line judged on a sibling or on its own `why`, then reused under a key that carries neither: cash
beside the item it pays for, a clue beside the move that makes it reachable, an object beside its usage. The tests below
therefore reconstruct turn 25 once and pin the rule on other kinds (cash beside an item, a clue beside a move).

**2026-09-29 -- owner decision: A + B.** The owner asked for the recommendation to be implemented, contract first, with
the latency measured before landing and a stop-and-report if A costs a lot.

**Implementation (2026-09-29, `claude/sl104-admission-batch-context-20260929`, 158e4b076 on base abde51d98; not merged).**
Contract §32.12.3.1.1 (an addendum under §32.12.3.1; pointers added to §32.4 and to §32.12.3.1's reuse paragraph).

- *A.* `AdmissionProposal` gains `signatures` (each reviewed line's `effectSignature`, set by `admissionRequest`) and
  `beside` (the call's other reviewed lines and their signatures). `lineProposal` sets a line's `beside` to every other
  reviewed line of the call; `buildAdmissionInput` lists them under `BESIDE_HEADING` ("[Also proposed in the same call,
  beside the line you judge -- read only; each is judged in its own review, not in yours]"), after `[Already refused
  this turn]` and before `[The Keeper now proposes]`, which still holds the one line. The system prompt is unchanged, and
  a proposal with no `beside` (a one-line batch, a `resolve`) renders byte for byte as before. Unreviewed effects
  (`person`, `threat`, ...) are nobody's batch-mate.
- *B.* `besideBatch(proposal, beside)` extends a one-line key by the batch-mates' signatures, sorted; with no batch-mates it
  returns the proposal unchanged. `admissionLines` (`extensions/kernel/index.ts`) keys every line through it, so the kept
  verdicts, the parked pending rounds and §32.12.4's prefetch check all read the batch-scoped key. `why`, `how` and every
  other field `effectSignature` does not read stay outside, the line's own and its batch-mates'.
- *Lines known and lines not.* When a later call's lines are known only in part (a line whose review failed keeps no
  verdict), the unknown lines are proposed beside the known ones (`besideBatch` over the fresh proposal), so each call reads
  every other line of the call and keeps its verdict under the key a whole review would have given it.
- *Decisions of mine, all in the addendum -- the owner should confirm:*
  1. **A refused line is remembered with its batch-mates** (`<line> [beside: ...] -> <verdict>: <missing>` in
     `[Already refused this turn]`). Without it, B's re-review would read the old refusal of a word-for-word identical
     time line and the system prompt's "an action already refused this turn and proposed again in other words is the same
     action", and could refuse again for the wrong reason. It is one line in `admitOne`'s `settle`.
  2. **The retry without a refused line is reviewed again.** SL-101 kept "the Keeper's retry without a refused line lands on
     the kept verdicts of the lines that were admitted, with no new review". Under B that retry has different batch-mates,
     so it is reviewed again (the time of a trip admitted beside the trip is not a verdict on the time alone). The SL-101
     sentence carries a dated note; its test is restated.
  3. The heading lives in the input, not the system prompt, so a lone line's request is unchanged and the typed reviewer's
     measured request is untouched.
- *Unchanged:* what §32.1 reviews; the typed reviewer (it already reads the whole proposal; a line it settles is kept under
  the batch-scoped key); the compile and consequence exemptions (policy-origin single effects); §32.12.2's cap, late
  admission, pending and resend; the batch verdict and landing; telemetry columns (a line row's `key` is the new key's
  digest); the retired split's remainder (not reached).

**Cost, measured offline (no model call).** Script: the SL-97c bank (`build.mjs` over the ten homes in
`results/sl97c/README.md`, 5 362 cases) re-projected through this branch's own `lineProposal`/`buildAdmissionInput`, and
the lane times already measured on those cases.

| | line calls | added by A (chars) p50 / p90 / max | share of the whole request (system 9 653 + input) p50 / p90 / max |
| --- | --- | --- | --- |
| bank, every multi-line `apply` (1 607 batches) | 4 911 | 307 / 587 / 1 433 | 2.7% / 5.3% / 11.4% |
| long gate #23 (11 batches) | 29 | 350 / 417 / 450 | 3.1% / 3.7% / 4.1% |
| turn 25: the time line / the move line (from the App's own rows) | 2 | 675 / 180 | its context was not reconstructed |

What that input costs in time, from lane calls already made:
- *Input size among one-line calls* (sl97c relabel, `grok-build/grok-4.5` low, 1 365 line calls, inputs 816-2 346 chars
  p10-p90): +210 ms per 1 000 chars (95% CI -49 to +470). At the bank's added chars: **+65 ms p50, +124 ms p90, +302 ms max
  per line call**. A batch waits for its slowest line (§32.12.3.1), so its wall time moves by about the same.
- *Upper bound: a line call that reads its batch-mates as much as a whole-batch call does.* The same relabel ran each
  multi-line case both ways (236 cases): the whole-batch call p50 11.4 s against a line call 6.2 s, per case +4.5 s p50
  (p25 +2.2 s, p75 +6.9 s), ratio 1.7. On `opencode-go/deepseek-v4.1-flash` (sl30, 26 cases, thinking not recorded):
  3.6 s against 3.3 s, +0.47 s p50, ratio 1.1. A's call reads nearly the whole batch's input but is told to judge one
  line, so it sits between the two; offline data cannot say where.
- *Reading.* The input alone costs about 0.1 s per line call. Whether a thinking lane (grok-4.5 `low`) reasons over the
  batch-mates it is shown -- which would take back much of SL-101's gain on that model -- cannot be measured without live
  calls; on the no-thinking flash lane the table ran at turn 25 the bound is about half a second. **Live measurement not run
  (needs the owner's approval):** the ticket's own plan -- turn 25's batch and gate #23's 11 multi-line batches (29 lines),
  each line with and without A, two runs, on the table's lane model -- is about 120 lane calls.

**Tests.** New `tests/extension/admission-line-batch-context.test.mjs` (6): the pure rules (`lineProposal`'s `beside` and
`signatures`, `besideBatch` order-free / a no-op without batch-mates / `why` outside / a batch-mate's destination inside,
the heading's place and a lone proposal's input unchanged byte for byte); turn 25 reconstructed from the installed App's
rows (the time line read beside the move and the move beside the time; the destination changed on the resend and the
time line reviewed again, `reused: false`, under a new key, its input carrying the new move and the old refusal with the
move it was refused beside; the batch lands); cash beside an item (the why-only resend refused at once on the kept cash
line, no call, same key; the item changed and the cash line reviewed again); a clue beside a move (the target changed, the
clue reviewed again); a line whose review failed (bad output twice) reviewed on the resend beside its known batch-mate and
kept under the whole review's key. Restated for batch-scoped keys: `admission-lines-parallel.test.mjs`'s `lineProposal`
pure test, the three-line context test (shared context, and each call beside the other two), the prefetch-with-a-known-line
test (the known line now comes from an identical batch whose other line failed), the reuse test (the same batch reworded
reuses; without the refused line, and alone, the time line is reviewed again: three keys), the one-line/resolve test (no
heading); `admission.test.mjs`'s context test. Mac, single files: the new file 6/6 (three runs), parallel 18/18,
`admission.test.mjs` 18/18. Type check: an ad-hoc `tsc` over `admission.ts`/`index.ts` gives the base's error set, none new.

**Mutations** (copy-backed, md5-checked restore; against the new file and `admission-lines-parallel.test.mjs`): every one red.

| id | mutation | red |
| --- | --- | --- |
| B1 | `besideBatch` keeps the lone key (B reverted) | 5 |
| A1 | the input does not render the batch-mates (A reverted) | 6 |
| AB | `lineProposal` carries no `beside` | 9 |
| R1 | a refused line remembered without its batch-mates | 1 |
| K1 | the known-lines path reviews unknown lines without the known ones | 1 |
| O1 | the batch-mates' order is part of the key | 1 |
| S1 | a line's signature is its rendered text (`why` inside the key) | 4 |
| H1 | the batch-mates listed after the proposed line | 16 |

**Suites (leehow-pc).**
- `ext`: `ℹ tests 4011` / `ℹ pass 4011` / `ℹ fail 0`; `== ext on leehow-pc @ 158e4b0769308686922718bdf1f90713e4ecc222: exit=0 wall=388s`.
  (The first box run, before `admission.test.mjs`'s context test was restated, was 4010/4011 with that test red: its
  premise was one shared context up to `[The Keeper now proposes]`.)
- `py`: `2068 passed, 2 skipped in 427.99s (0:07:07)`; `== py on leehow-pc @ 158e4b0769308686922718bdf1f90713e4ecc222: exit=0 wall=443s`.
- `loop`: `# tests 296` / `# pass 296` / `# fail 0`; `== loop on leehow-pc @ 158e4b0769308686922718bdf1f90713e4ecc222: exit=0 wall=174s`.

**Found in passing, not this ticket.** `effectSignature` does not read `time`'s `band`, `until`, `stated` or
`beyond_travel`, nor `cash`'s `stated`: `{kind: "time", band: "speak_briefly"}` and `{kind: "time", band:
"library_research"}` have one signature, so within a turn a verdict on one time cost is reused for another. A §32.4 key
gap older than SL-101; filed as a separate task.

**2026-09-29 -- merged.** The owner said to merge without the live latency check ("直接合"). 0.9.6a had moved 16 commits
(maps92, §39.4 / §152.4) past the branch's base; merged into the branch without conflict (bf65b781a) and 0.9.6a
fast-forwarded to it. The box suites above ran on 158e4b076, before that merge. On the merged head leehow-pc was
unreachable (mDNS unresolved, no matching host key on the /24, WireGuard banner timeout) and amax is off the LAN, and the
owner's 2026-09-26 ruling keeps the full suites off the Mac, so only single files ran on the Mac: the three admission
files and every extension test the merge added or changed (`map-living` 8, `map-session-viewer` 9, `map-view` 9,
`map-words` 23, `visual-identity` 10, `campaign-module-isolation` 1, `contract-section-numbers` 3; the admission files 6,
18, 18), all green. **Owed:** `ext`, `py` and `loop` on the box at the merged head once leehow-pc is back. The installed
App does not carry this until it is repackaged.
