Status: needs-triage (filed 2026-09-29 from the installed-App Dust to Dust table; owner asked "时间行缓存那条…查一下吧"; follow-up of SL-101; owner decision on the design below still open)
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

## Design options (owner decision; nothing implemented)

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
