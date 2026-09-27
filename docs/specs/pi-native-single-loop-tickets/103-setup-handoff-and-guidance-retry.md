Status: ready-for-human (filed 2026-09-27 from the Masks PDF re-run; batch 19; P2; implemented 2026-09-27 on claude/sl103-20260927)
Stage: SL-103 (setup: the handoff command is the host's, never the guide's words; a refused guidance draft is retried without waiting for the player)
Spec: docs/kernel-rpc.md §14.4 (step seven, the handoff), §14.19 / §98 addendum 9 (SL-98), SL-100's `player_reason`; `extensions/onboarding/index.ts` (`finish`, `handoff_command` in the step result ~973, guidance failure and retry)

# SL-103: the guide reads out the handoff command; a guidance refusal waits for the player's next line

## Evidence (Masks re-run, `masks2-2238-20260927T023845Z`)
1. **Handoff command.** The confirm step's result carries `handoff_command: "bin/pi-coc --campaign masks2-2238"`, and the guide appended it verbatim to the player-facing reply.
   - The host already shows the handoff itself: `ctx.ui.notify` in the CLI, and the App switches to play on `coc-session mode:'play'`.
   - A CLI command in the guide's prose is noise in the App and duplicates the host's line in the terminal.
2. **Guidance retry.** `create-campaign` returned `guidance_failed / preparation_failed` ("Character guidance needs revision"): the guidance reviewer refused the first draft. The `player_reason` said it would be tried again "with your next message". The player had to send a line ("好的，再试一次吧") before setup continued, which is dead time for a retry the host could start at once.

## Ruling
1. The handoff command stays machine-facing. The step result tells the guide the host has shown the handoff (like SL-98's `opening_shown`), and does not hand it a command to repeat.
2. A guidance draft refused by its reviewer is retried by the host right away, bounded (e.g. once), before the step answers. The player is asked to wait only if that retry also fails.

## Tests
- The confirm result carries no bare command for the guide.
- A reviewer-refused guidance is retried once in the same step and succeeds.
- A second refusal falls back to the SL-100 reason.

Mutation-killable.

## Comments

- 2026-09-27, implementation (claude/sl103-20260927, from 8650cb718): contract `5cd8f4c89` (§98 addendum 10, plus a
  pointer under §14.4), code, prompt, tests and inventory note `e4d8c74cd`. No kernel change (no `build:runtime`, no
  pytest); `tests/play/driver.py` unchanged.
  - **Who read `handoff_command`.** The guide, which pasted it, and `tests/extension/setup.test.mjs`'s starter walk
    (`:679`, `:687`). Nothing else did: the driver records `final_text` and §14.18's `setup_opening`, and the
    launcher, `pipicoc/` and the App backend act on `coc-setup-exit`, `coc-session` and the `setup-handoff` invoke. The
    guide also got the same string a second way, `setup.complete`'s `launch` inside the step result, and the setup
    prompt said "in a terminal, read the provided launch command verbatim".
  - **Handoff.** `complete` answers `handoff_shown` (`extensions/onboarding/index.ts:1029`, sentence in `handoffShown`
    `:137`): the host has shown the player how the table opens (this call's `ctx.ui.notify`), or opens it itself (App,
    or no UI). `finish()` (`:1038`) returns which. `guideView` (`:684`) drops `launch` from the guide's copy of
    `setup.complete`; the kernel's answer and `campaign.json` `setup.handoff.launch` are unchanged. The host's own
    notify, `coc-setup-handoff`, `coc-session {mode: play}` and `coc-setup-exit` are unchanged. `prompts/setup.md`:
    the handoff is the host's, `handoff_shown` says so, never write a command.
  - **Retry.** `extensions/module/character-guidance.ts:237` marks the reviewer's refusal (still `preparation_failed`,
    `details.reason: "review_refused"`, predicate `guidanceReviewRefused` `:33`; the issues stay in the attempt folder
    because they can name secrets). `ensureGuidance` (`index.ts:266`) runs the preparer again inside the same
    single-flight promise (`:289`-`:294`), at most once (`GUIDANCE_ATTEMPTS = 2`, `:46`), only for that failure and not
    after a stop. It runs under `AbortSignal.any([session end, the tool call's signal])` (`:274`), and the signal is
    threaded from the tool's `execute` (`:1114`) to `create-campaign` (`:1010`) and the remedy's `afterPreparation`
    (`:850`). No caller retries around it, so a step runs at most two preparations, and accepted guidance is kept (the
    next turn prepares nothing). Turn start and the App's session start go through the same preparation and get the
    same one retry.
  - **Tests.** `tests/extension/setup-handoff-and-guidance-retry.test.mjs`, 9 cases on the real setup tool, the handoff
    ones on the real kernel: no command anywhere in the `complete` result while the host's line, entry and record still
    carry it; the App is told the other handoff; the prompt names `handoff_shown`; a refusal is retried once in
    `create-campaign` and succeeds (no two children at once, nothing on the next turn); a second refusal gives SL-100's
    reason, one notice, two preparations; any other failure gets one preparation; a stop during the retry reaches its
    child and nothing runs after it; a stop between the refusal and the retry skips it; turn start retries the same way.
    `setup.test.mjs`'s starter walk now reads the command from `coc-setup-handoff`. 14 mutations: 13 killed, and M13
    ("the retried guidance is not kept in memory") is equivalent, because the preparer's own `accepted.json` cache
    answers the next turn without a model run. Green on this Mac, single files: the new file, setup,
    setup-opening-choice, setup-player-reasons, character-guidance, runtime-onboarding, launch,
    preparation-failure-words, extension-words, reader-submit, control-flow-inventory, system-language,
    contract-section-numbers.
  - **Open.** (1) Live check: the Masks re-run's transcript (the guide's last reply has no command; a refused draft does
    not cost the player a line). (2) The App's onboarding worker (`pipicoc/onboarding-worker.ts`) prepares guidance
    before setup through its own call to the preparer and does not retry; it is a separate producer and was left
    alone. (3) The retried preparation starts a fresh draft: it does not see the refused draft's review.
    `manifest.json` untouched.

- 2026-09-27 (integrator): merged.
  - The one retry living in `ensureGuidance` (so turn start and the App's session start get it too, not only the two steps) is accepted: one behaviour everywhere, still bounded to one retry.
  - Open: `pipicoc/onboarding-worker.ts`, the App's pre-setup guidance producer, does not retry. It is a separate producer, left for a follow-up if the App shows the same refusal.
