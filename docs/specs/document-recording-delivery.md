# A recording the host could not bind never blocks the turn's delivery

Status: ready-for-human (implemented on `claude/document-recording-20261008`; contract §200; awaiting lead integration and
the owner's two open decisions below)

## What the player lost

TR-F2 run 3, turn 8 (2026-10-08, App `4ce2e4cab`, The Haunting, campaign `game-af36b938-4ca6-421e-bdec-759080123f69`,
Keeper `openai-codex/gpt-6-luna` low, hybrid-v1). The player said 「我把马卡里奥一家和罗克斯伯里记在本子上。然后去市政档案馆，查这栋房子的产权记录，
看看沃尔特·科比特后来怎么样了。」 Nothing was delivered: the notebook append was refused twice by the host's binding, every
narrate after it was refused by the outcome guard, the unfinished notice appeared at 15:05:34 in the middle of the run, and
the run went on for nine more calls until its 48-step limit. The move, a roll and 222 minutes had landed and were never told.

What the player wanted: the note taken (or at least not lied about) and the trip to the archive told. Success is a turn that
always delivers, never tells the player their notebook holds words it does not hold, and keeps the failed note visible to
the next turn. A hollow fix would be a test that stubs the guard, a gate quietly lowered, or a field nobody reads.

## Decision (lead, 2026-10-08)

- A recording that fails on the host's side (binding unresolved or unavailable, not a refusal of the act in the fiction)
  never costs the turn its delivery.
- The recording stays unconfirmed with its reason, and is not claimed in prose.
- The guard refuses only a draft that claims a completed recording, once.
- Fix why the binding failed and why the guard took every draft, at the system level.
- Addition after the owner flagged the screen: once the host ends an input (any cause), the Keeper's run for it ends and no
  further call runs.

## Causes found

1. **The binding refused a faithful note** (`runtime/jev/document-binding-domain.ts`, family version 3). Nothing was ambiguous
   (笔记本 .91 against 钢笔 .15). The `content` Choice counted "unselected words or interpretation" as outside, so a player who
   names what to write down and leaves the wording to the Keeper can never pass. The message said "could not be bound
   unambiguously" for a cause that was not ambiguity.
2. **The guard took the turn** (`runtime/jev/refused-document-outcome.ts`, `guardRefusedDocumentDelivery`). The first draft (「记在心里」)
   scored .12; every answer between .10 and .90 was `terminal`, `terminal` latched, the next drafts were refused without a
   question, and the guard scheduled the unfinished notice itself.
3. **The run did not end with the notice.** The end was said only as `terminate` on one tool result. The legacy loop stops a
   batch whose results all terminate; the single-loop driver composes again after a fallen batch, and the forced turn close
   answered `none`, which finishes a run only when nothing is pending.

The 09:45 Blood Road notice (campaign `game-d78dd9ec`, turn 12, 13:45:04Z) is **not** this defect: the player said 「可以」,
the Keeper's request to `opencode-go/deepseek-v4.1-flash` was aborted after 1.06 s with no output (`stop_reason: aborted`,
run `aborted_during_infer`, `abandoned_not_steered`), receipts 0. No binding, no outcome check, document recording .10.

## What changed

- **§200.3** The guard refuses one case only: Jev ≥ .90 that the draft claims the recording, first attempt, correction
  available, not the refusal-budget fallback. Everything else (clean, gray, unavailable, exhausted, claimed after the
  correction) delivers. No terminal state, no unfinished notice for this cause. An unreadable selected-recording premise is
  recorded `unverified` and delivers.
- **§200.4** Writer: every closing delivery carries host-only `unconfirmed_recordings` `{document?, reason, cause?}` to the
  turn record (validated by the kernel, outside the digest). Reader: the capsule's `unconfirmed_recordings` section on the
  turns `recent` shows. Actor: the Keeper does not tell it as written and appends when the player asks again.
- **§200.5** Binding family version 4: `content` and `execution` judge the claims, not the wording; every gate stays .90. The
  refusal message names what happened; its fix sends the call's other effects back without the addition.
- **§200.6** `endInput`: the host's end of an input marks the turn, cuts the run (runCut + abort), refuses every later call
  before it runs, and the turn close answers `input_ended`. Callers: the unfinished notice declared mid-run, and §38.11's
  history-store escalation (which had the same shape on the single-loop engine).

## Measurements (Jev 1.13.0, live, three runs a case, predictions registered before each request)

Inputs: turn 8's player text and `justTold` (turn 7's prose), catalog 笔记本 (notebook) and 钢笔 (paper), suffix = the
Keeper's proposal unless stated. Values are the content Choice (selected category @ probability) and the outcome.

| case | v3 | v4 |
| --- | --- | --- |
| T8 turn 8 as played | outside .80/.80/.85, unresolved 3/3 | within .81/.86/.86, unresolved 3/3 (gate .90) |
| C1 note + a guess | outside .98/.97/.98, unresolved 3/3 | outside .98/.99/.99, unresolved 3/3 |
| C2 note + an unselected topic | outside .95/.96/.96, unresolved 3/3 | outside .98/.98/.98, unresolved 3/3 |
| C3 read-only (本子) | no_target (target .79/.82/.75) | no_target (target .80/.75/.81) |
| C3b read-only (笔记本) | no_target (target .62/.57/.60) | no_target (target .63/.57/.59) |
| C4 dictated quote, suffix = longer summary | outside .97/.96/.96, unresolved 3/3 | .51/.53/.52, split, unresolved 3/3 |
| C5 dictated quote, suffix = quote | literal .87–.89, content within .84–.85, unresolved 3/3 | bound 2/3 (content .97, execution .93/.96; third: target .89) |
| C10 deferred writing | outside .58/.67/.56, unresolved 3/3 | content within .92/.89/.92; execution `selected_operation` .62/.65 (the .89 run failed content) → unresolved 3/3 |
| C10 with v3's execution wording (v4e) | — | execution `selected_operation` .58/.67/.62 → unresolved 3/3 |

Raw output and the registration: the slice's scratch record (`docrec/probe/out-v3.txt`, `out-v4.txt`, `out-v4e.txt`,
`PREREGISTERED.md`). The previous worker's first registration predicted T8 would bind under v4; it did not.

## Open owner decisions

1. **The .90 gate on zh-Hans tables.** Turn 8's note is judged within at .81–.86 and stays unbound. Calibrating the content
   gate (or the guard's correction gate, which V25's .74 false completion sits under) is the owner's call; §200.3/§200.4 make
   the turn deliver either way.
2. **Deferral rests on a wrong-leaning answer.** Under v4 a deferred note passes `content` and is held only by `execution`'s
   .90 gate while its top answer is `selected_operation` at ~.6. The same weakness exists in v3's execution wording. A
   dedicated "now or later" question would fix it; adding a question to the consent family needs the owner.

## Tests and mutations

`tests/extension/document-recording-delivery.test.mjs` (single-loop engine on the emitted kernel, turn 8's calls verbatim
from `tests/extension/fixtures/tr-f2-run3-turn8.json`, the Jev endpoint scripted with the turn's own answers):

- turn 8 replayed: 3 Keeper calls of 13, the narrate delivered, no unfinished notice, the record and the next capsule carry
  the recording;
- a claiming draft corrected once and the correction delivered; a claim surviving the correction delivered as `claimed`;
- a gray answer and an unavailable check deliver; a chosen recording never attempted is recorded `not_written`;
- §200.6: the history store failing twice ends the single-loop run at 2 Keeper calls, nothing more reaches the kernel;
- the kernel's validation, record and capsule window, in process; the binding's gates on the measured answers.

Mutations (each copied aside and restored by copy): listed with results in the slice's handoff.
