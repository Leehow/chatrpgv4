Status: ready-for-human (filed 2026-09-27 from long gate #24; batch 19; P1 latency: each repeated lookup is a whole Keeper step, ~10 s; implemented 2026-09-27 on claude/sl102-20260927, b8b5fce38; the first-step wait is a decision for the owner, below; long gate #25 is the acceptance)
Stage: SL-102 (the source/module material the Keeper looked up stays in its hands while it is still relevant, so the next turn does not look it up again)
Spec: docs/kernel-rpc.md §135.20 (the read hands the Keeper the bodies of what it issued), §22 (reading answers), the capsule assembly (`extensions/kernel/assemble.ts` or wherever the capsule is built), the prescreen (`runtime/jev/…prescreen…`); `lookup`/`look` tool paths in `extensions/kernel/index.ts`

# SL-102: the Keeper re-looks up last turn's material

## Evidence (long gate #24, `longgate24-haunting-2238`, dc37c6b7e, grok-4.5 low)
- 15 lookups; 5 repeat the previous turn's lookup of the same material:
  - `source/answer upper-floor-bedroom` t11 and t12;
  - `source/answer corbitt-diaries` t14 and t15, plus `module "Corbitt Diaries"` t15;
  - `source/answer basement-rites` t17, t18 and a t18 retry.
- Each lookup is a blocking call: the Keeper needs another model step (median 10.6 s) to use the answer.
- The turns over the 60 s target are exactly the multi-lookup turns (t14 61 s, t15 74.5 s).
- The Jev prescreen reported `prepared` on 32 of 32 rounds, yet the Keeper still asked.

## Investigate first
For each repeated lookup, establish from the turn records, capsules and events:
- Did the previous turn's answer reach the next turn's capsule or context? Where was it dropped, or was it never carried?
- Was it carried but in a form the Keeper does not recognise as the answer (a pointer instead of the body, §135.20)?
- Was the source answer still being read, so that `retry` and the answer arrived late?

## Ruling (to confirm from the investigation)
Material the Keeper looked up in this scene stays in its hands while the scene lasts:
- the host carries the landed answer bodies forward, within the capsule's budget, deduplicated;
- they are dropped when the scene changes or the budget says so.

No new tool, no prompt pleading. The host carries it, or the prescreen supplies it before the Keeper asks.

## Scope and tests
- Mutation-killable tests through the real read/lookup path: a lookup's answer in turn N is present in turn N+1's context in the same scene and gone after a scene change; the carry respects the budget.
- Contract addendum near §135.20 (stable ids).

## Acceptance
Long gate #25: repeated lookups of the previous turn's material ≈ 0; Keeper calls per turn and first visible prose reported.

## Comments

**Investigation (2026-09-27, before the fix; gate #24 evidence read-only).** The ticket's premise -- the previous turn's
answer was not carried forward -- is not what happened on this gate. In all three source repeats the answer had not landed
when turn N+1's first model step was built; it landed during that step.

- *t11 then t12, `upper-floor-bedroom`.* t11's lookup went pending after its 8 s allowance (`telemetry.jsonl:1855`,
  `answer_pending`, job `read-2`; the tool result: "The book is still being read for this question: the answer is not here
  yet"). The turn closed at 02:48:25.6 without it. t12's first note (events `:3847`, step s6, 02:48:36.016) carried
  `carried.pending: [{focus: "upper-floor-bedroom", question: "What rooms are on the Corbitt House upper floor, …", since_turn:
  11}]` and the scene's passages (1,094 B), no answer. The review finished at 02:48:38.886 (`:1988`), 2.9 s into the step;
  `answer_landed` `:1989`. The Keeper's s6 response re-sent `lookup source upper-floor-bedroom` with a new question (events
  `:3916`, 02:48:42.606); the memo answered it in 24 ms (`:1997` `answer_memo`), `answers[0].question` being t11's question
  and `answer` the whole body ("The Corbitt House upper floor has four rooms: Room 1 Main Bedroom, …"). The next note (s8,
  events `:3942`, telemetry `:2006`) carried the same answer again as a landed `source_answer`, 2,213 B.
- *t14 then t15, `corbitt-diaries`.* t14's lookup pending (`:2282`, `read-3`). t15's first note (events `:4594`, s5,
  02:50:59.513) carried it pending (since_turn 14). The review finished at 02:50:59.760 (`:2379`), 0.25 s into the step.
  The Keeper's s5 response (30.2 s) re-sent the source lookup with a new question -- memo, 22 ms (`:2403`) -- beside
  `module "Corbitt Diaries"`, `rule "tome study book Cthulhu Mythos"` and `look object "Corbitt Diaries"`. s7 (`:2418`)
  carried the same answer again, 1,211 B. The module lookup is not a repeat of material in hand: t14's
  `module "corbitt-diaries Corbitt Diaries"` had answered `not_found` (two names in one query; §135.20's module lookup matches
  one name at a time).
- *t17 then t18, `basement-rites`, and the t18 retry.* t17's lookup pending (`:2654`, `read-4`). t18's first note (events
  `:5440`, s4, 02:53:36.456) carried it pending (since_turn 17). The review finished at 02:53:41.474 (`:2757`), 5.0 s into the
  step. The Keeper re-sent it with a new question -- memo, 23 ms (`:2764`) -- and s6 (`:2768`) carried it again, 1,554 B.
  The memo's answer said the boards hide hollow areas but not how they open; the Keeper then asked "Describe the wooden
  boards … Is there a bolted door, trapdoor, hatch or latch?" with `retry: true` (events `:5549`): a new read (`read-5`,
  `:2787`), not material in hand. It landed on t19 after the party had moved (`:2923`) and was carried once on t20 at
  `commission-briefing` (`:3031`).
- *Form.* Every copy was the body with its question (the pending row, the memo's `answers[]`, the carried view), never a
  pointer; §135.20's rule held.
- *A still-running read explains every source repeat.* A consultation here is a read round plus a review, 42-52 s after
  the ask; the turn spends 8 s of it and closes; the driver's player answers in 5-6 s; the next turn's run spends 2.6-4.4 s
  on its read, route and clerk steps; the answer lands in the first model step.
- *The carry gap the ruling names is also real, though it caused no repeat here.* A turn's request keeps nothing of an
  earlier turn's notes or tool results (`extensions/table/context-policy.ts:201-205`: `user`, `assistant`, `toolResult` and
  `coc-clerk` before the current boundary are closed noise; `history_bytes` 3,615 and 3,360 on t12 and t13, the quotation
  history only). An answer landed once or returned by a lookup is gone on the next turn at the same scene.

**Implementation (2026-09-27, `claude/sl102-20260927`, b8b5fce38 on base c4e937420).** Contract §135.20.1 (addendum under §135.20;
a pointer at the end of §135.31.2). No new tool, no prompt text beyond the head sentence that says what a held view is.

- *A, the ruling -- held answers.* `PendingAnswers` (`extensions/kernel/source-answers.ts`) keeps a per-campaign shelf:
  `hold` (:206) takes the answers the Keeper was handed at a scene -- a lookup inside its allowance and a memo hit
  (`extensions/kernel/index.ts:4068` and `:4074`, the memo held oldest first so the newest is last), and a landing, held at the scene
  it was asked (`register`'s new `scene`, :175; `index.ts:4062`). One entry per focus and question; a scene's shelf keeps its newest within
  `HELD_ANSWERS_BYTES` (8 KiB, `runtime/jev/carried-views.ts:49`), each counted at most one view, the rest dropped with
  `held_dropped` reason `budget`. `take({scene, run})` (:240; `handed` :252) drops every other scene's shelf (`held_dropped`, reason
  `scene_change`), returns `held` (this scene's answers not yet in this run's request, newest first) and marks them in hand
  for the run; a landing the Keeper's own lookup already returned in this run goes to `handed` instead of `landed`. The
  engine (`runtime/jev/hybrid-engine.ts:1161`, `:1166`, `:1184`) takes with its scene and run and hands `held` to `readCarriedViews`, which
  serves them last as `source_answer` views marked `held`, cut to 4 KiB with the question first (`HELD_ANSWER_FIELD_ORDER`, `carried-views.ts:101`, :236, :243),
  inside the message's 12 KiB (past it: `omitted` with `budget` and `held`, :250). `CARRIED_HELD_HEAD` (:281) explains the mark; the
  landed head appears only beside a landed answer.
- *B, the cause on this gate -- the first step waits out this scene's consultation.* At a run's first model step the engine
  calls the port's `settle({scene, turn, elapsed_ms})` (`hybrid-engine.ts:1151`); the port (`index.ts:4803`) waits in
  `PendingAnswers.settle` (`source-answers.ts:274`) for the `answer` consultations asked at that scene on an earlier turn, for
  `SOURCE_ANSWER_ALLOWANCE_MS` less the run's elapsed time. What lands rides the first note as landed; past the bound it rides
  pending, as before. Another scene's, this turn's and a `prepare` are not waited on. `held_wait` row per run.
- *Budget behaviour.* Per view 4 KiB (cut, question kept, `truncated`/`omitted_fields`); per message 12 KiB shared with the
  session, landed answers, people, scene and passages, held served last so nothing that rode before is displaced; per scene
  8 KiB on the shelf (the newest kept). The wait is bounded by one allowance counted from the run's start: on the gate's
  three cases 2.9, 0.25 and 5.0 s against bounds of about 3.6, 4.5 and 5.4 s.

**The decision the owner should see.** B gives a consultation this scene is already reading a second stretch of §22.4.3's
allowance, at the next turn's first step (at most 8 s from the run's start, overlapping the run's own 2.6-4.4 s of reads,
route and clerk steps). I read "Reading never holds a turn" (b) as allowing it: the allowance is what a turn may spend on
one consultation, the read is never cancelled or started, and past the bound the turn goes on exactly as before. Without
B, A alone changes none of the gate's repeats: the three source repeats were answers still reading at the step that
re-asked, and the other two (t15's module lookup, t18's retry) were never material in hand. With B, what the gate would
have saved is the three re-asking steps; t18's retry would still be asked (one step earlier), and t15's first step also
sent a module, a rule and a look lookup that B does not touch. If the owner rules B out,
`PI_COC_SOURCE_ANSWER_ALLOWANCE_MS` does not separate the two; removing the one `settle` call in `carriedFor` does
(mutation M10 below).

**Tests** (single files on the Mac, one at a time; leehow-pc not used): 
- `node --test tests/extension/single-loop-held-answers.test.mjs` -- 9/9 pass: the ledger (once per run, the newer answer replaces the older, a scene change drops it with a row; the 8 KiB shelf keeps the newest; a landing the Keeper's lookup already returned is `handed`, a landing is held at its own scene; `settle` bounded, this scene and earlier turns only); the carried section (held last, question first, cut to 4 KiB, omitted as `budget` and `held` past 12 KiB, the heads); on the emitted kernel through the vendored driver with a stub reading bridge -- an answer from turn N rides turn N+1's first step once (the only copy in that request) and is absent from every request after the move; a memo hit's five answers: the newest three ride, the oldest two never; the gate's t12 shape (pending note, landing mid-step, the Keeper re-asks) carries nothing twice and the next turn carries it held once; the first step waits for this scene's consultation (landed 60 ms into the step, carried landed, `held_wait` landed 1) and does not wait for the scene the party left.
- Every related file, one at a time, all exit 0 (52 files, 420 tests): `single-loop-looks-first-visit.test.mjs` 9, `single-loop-carried-views.test.mjs` 9, `single-loop-model-call-diet.test.mjs` 11, `scene-obligation-candidates.test.mjs` 15, `single-loop-note-head.test.mjs` 2, `single-loop-destination-rows.test.mjs` 6, `single-loop-prescreen-budget.test.mjs` 9, `single-loop-domain-policy.test.mjs` 12, `scene-text-landing.test.mjs` 6, `person-text-landing.test.mjs` 3, `review-refused-retry.test.mjs` 4, `review-contested-field.test.mjs` 3, `displaced-read-resumes.test.mjs` 5, `running-answer-generation-move.test.mjs` 5, `reading-priority.test.mjs` 6, `source-answer.test.mjs` 4, `source-answer-allowance.test.mjs` 9, `source-answer-service.test.mjs` 3, `starter-lookup.test.mjs` 2, `preparation-wait-never-strands.test.mjs` 9, `map-arrival-late.test.mjs` 2, `destination-identity.test.mjs` 6, `stranded-turn-closes-itself.test.mjs` 2, `stale-adaptation.test.mjs` 5, `host-state-not-fiction.test.mjs` 12, `dead-proposal-retires.test.mjs` 5, `canonical-operation-dispatcher.test.mjs` 12, `campaign-module-isolation.test.mjs` 1, `refused-effect-is-told.test.mjs` 9, `capsule.test.mjs` 4, `context-policy.test.mjs` 22, `fold.test.mjs` 10, `long-campaign-context.test.mjs` 5, `pi-context-edits.test.mjs` 11, `prescreen.test.mjs` 12, `prescreen-loop-request.test.mjs` 1, `prescreen-material-families.test.mjs` 6, `prescreen-semantic-locate.test.mjs` 6, `prescreen-source-request.test.mjs` 3, `prescreen-request-supply.test.mjs` 38, `workspace-projection.test.mjs` 22, `workspace-lifecycle.test.mjs` 3, `workpad.test.mjs` 18, `check-preflight.test.mjs` 1, `npc-preparation-integration.test.mjs` 8, `real-kernel.test.mjs` 5, `turn.test.mjs` 35, `system-language.test.mjs` 5, `contract-section-numbers.test.mjs` 3, `control-flow-inventory.test.mjs` 4, `world-state-seams.test.mjs` 3.

**Mutations** (each applied by `cp` of a mutated copy, the file run, restored by `cp`; `node --test
tests/extension/single-loop-held-answers.test.mjs`): 19/19 killed; every source compared byte-equal to its saved original afterwards.

| # | mutation | result | killed by |
| --- | --- | --- | --- |
| M1 | engine does not pass held answers to the carried views | killed | seam no-duplicate, seam carry+move, seam memo budget |
| M2 | held answers are not scoped to the run scene | killed | seam carry+move, seam wait, ledger per run/scene |
| M3 | no scene-change drop (other scenes kept on the shelf) | killed | seam carry+move, ledger per run/scene |
| M4 | no shelf budget | killed | seam memo budget, ledger budget |
| M5 | held view cut in the landed order (question last) | killed | carried section, seam memo budget |
| M6 | message budget ignored for held views | killed | carried section |
| M7 | a landing the Keeper already fetched in this run is carried again | killed | seam no-duplicate, ledger handed |
| M8 | held answers are not marked in hand for the run (repeat every step) | killed | seam no-duplicate, seam carry+move, seam memo budget, ledger per run/scene |
| M9 | a landing is held without the run that carries it (landed and held twice) | killed | seam wait, ledger handed |
| M10 | the engine never asks the port to settle | killed | seam wait |
| M11 | settle waits for any scene | killed | seam wait, ledger settle |
| M12 | settle waits for this turn too | killed | ledger settle |
| M13 | the port gives no allowance | killed | seam wait |
| M14 | a pending consultation is registered without its scene | killed | seam no-duplicate, seam wait |
| M15 | an answer inside the allowance is not held | killed | seam carry+move |
| M16 | a memo hit is not held | killed | seam no-duplicate, seam memo budget |
| M17 | the memo is held newest first (newest dropped by the budget) | killed | seam memo budget |
| M18 | the held head is not told | killed | carried section, seam carry+move |
| M19 | held views are served first (before the passages and people) | killed | carried section |
