Status: ready-for-human (filed 2026-09-26 from the Masks PDF table; batch 18; P0: a PDF book with two openings can never be played; implemented 2026-09-26 on claude/sl98-20260926)
Stage: SL-98 (setup: the opening choice survives a long read; a missing choice is asked for, never a dead end; the block never blocks its own remedy)
Spec: docs/kernel-rpc.md §14.17/§14.18 (setup opening), §22 (reading waits), §98 addendum 4 (a blocked setup turn carries its cause); `extensions/module/reading-service.ts` (`prepare`: `needs_choice`, `start_scene`, `targeted`), `extensions/module/character-guidance.ts` (`openingNode`, `preparation_failed` at ~157), `extensions/onboarding/index.ts` (guidance at turn start / at create-campaign, `context.start_scene`), `kernel-ts/modules/reading.ts` (`chooseOpening`, `meta.opening_choice`); prompts/setup.md

# SL-98: the opening choice deadlock on a PDF with two openings

## Evidence
The Masks PDF table (`masks-1350-20260926T175048Z`, gate worktree `chatrpgv4-wt-gate-13ce6a7dd-masks`, 13ce6a7dd, grok-4.5 low), a fresh import of *Masks of Nyarlathotep* (669 pages):
1. 18:07:49: `prepare-module` returned `needs_choice` with two candidates, the 1925 Elias radiogram and the 1921 Lima prologue. The player chose New York.
2. 18:10–18:18: `prepare-module {start_scene}` returned `needs reading_timeout` three times while the opening was read (read-4 and read-5 failed, see SL-99; read-6 landed).
3. **18:20:17: the guide called `create-campaign` with no opening.** `module.json` has `opening_choice: null` and `opening.start_scene: null`: the choice was never persisted (no `module.opening.choose`). `prepareCharacterGuidance` then threw `preparation_failed: The selected opening scene is unavailable for character guidance` (`openingNode` found nothing for `''`).
4. **Every later call was refused before it could act**: `setup_blocked`, `blocked_by: guidance_at_turn_start`, `cause: preparation_failed`. That covered `prepare-module {start_scene, retry}` for both openings and `create-campaign`. The step that would record the choice sits behind the block the missing choice causes. The five guidance attempt folders are empty (it failed before any model call). The player retried five times and the table ended in setup.

## Ruling
1. **A choice the player made is recorded when it is made.** `prepare-module {start_scene}` persists the choice (`module.opening.choose`, or equivalent) before or independently of the opening read, so a read that times out does not lose it. Rejoining the wait keeps it.
2. **No opening selected on a multi-opening book is a question, not a failure.** Guidance preparation, and anything else that needs the opening, answers `needs_choice` with the candidates (§22's actionable error; it must survive every projection up to the guide). `preparation_failed` is only for a real preparation failure.
3. **A block never blocks its own remedy.** While setup is blocked on guidance, the steps that can clear the cause stay open: recording the opening choice, and retrying the preparation. Only card and campaign steps wait.
4. Prompt: the guide asks the player which opening; it does not call `create-campaign` before the opening is recorded. The host enforces this, not only the prompt.

## Scope and tests
- The steps above in onboarding, reading-service and guidance; a kernel change only if `chooseOpening` needs it.
- Tests (mutation-killable, real entry points, fake reader):
  - a two-opening PDF module whose opening read times out → the choice is still recorded;
  - `create-campaign` with no choice → `needs_choice` with the candidates, not `preparation_failed`;
  - with setup blocked on guidance, `prepare-module {start_scene}` still records the choice and the next turn prepares guidance;
  - a single-opening book is unchanged;
  - the Haunting starter is unchanged.
- Contract: an addendum where §14.17/§14.18 and §98's blocked-turn rule live (stable ids, never renumber).

## Acceptance
Re-run the Masks table: character creation completes on the opening the player chose.

## Comments

- 2026-09-26, implementation (claude/sl98-20260926, from 6f1b2f5be): contract `978961a74` (§14.19, §98 addendum 9),
  code and tests `f87f79b0b`. No kernel change (no `build:runtime`, no pytest).
  - **Reconstructed sequence** (`events.jsonl`): `prepare-module {pdf}` waited out the skeleton six times (`read-1`,
    then `read-3` x5) and failed once (review refusal at `/nodes/9`); 18:07:49 `needs_choice` with the two openings;
    `prepare-module {start_scene: campaign-beginning-elias-message}` 18:08:26 `read-4` timeout, 18:10:49
    `reading_failed` (the reader's input-token lease after a 60 s provider stall), 18:11:37 / 18:13:51 `read-5`,
    18:16:06 `read-6`, 18:20:15 `ok`. The host never kept `start_scene` and `create-campaign`'s params carry none, so
    18:20:17 `campaign.create` made `masks-nyarlathotep` with `opening_scene: null`, guidance threw
    `preparation_failed` (`openingNode('')`) after creating its attempt folder, and every later call -- `create-campaign`,
    `prepare-module {start_scene, retry}` for both openings with and without `pdf` -- was `setup_blocked`.
  - **Recorded when made.** `extensions/onboarding/index.ts:929` records `start_scene` before the op runs; a rejoin
    without it is filled by `fillParams`' same-named fallback; `:430` carries it into `campaign.create` (kernel pins
    `opening_scene`, §22.9). A campaign that exists with no opening gets it from `afterPreparation` (`:777`,
    `module.opening.choose {module_id, scene, campaign}`, campaign-scoped). The library is never written: the reading
    service's "the player's opening must not be stored in the library" rule stands, which is why this is the
    "equivalent" record and not an unscoped `module.opening.choose`.
  - **A question, not a failure.** `extensions/module/character-guidance.ts:57` `selectedOpeningScene`: no opening, or
    one the book does not offer, on a book whose `module.json` carries `opening.choice.candidates` is `needs_choice`
    with them, decided before the attempt folder (`:179`); `preparation_failed` stays for a single-opening book whose
    opening is missing. The create-campaign result (`guidanceFailure`, `index.ts:748`), the block and its refusal
    (`setupBlockRefusal`, `:104`) carry `fix` and `details`; a `needs_choice` block keeps the guide's text
    (`setupBlockHidesText`, `:84`) and raises no failure notice (`:1092`, `:1231`).
  - **Host enforcement.** `unchosenOpenings` (`:763`) asks `module.status` before `campaign.create` on a book that came
    through the preparation step with nothing recorded; >1 `opening_candidates` answers `needs_choice`, creates
    nothing, and reopens the preparation step (`remedyOpen`, `:713`). Prompt rule in `prompts/setup.md`.
  - **The block never blocks its remedy.** `index.ts:840`/`:903`: under a guidance block the preparation step runs
    (only "already done" waived), records and pins the choice, and retries guidance in the same call; success clears
    the block and shows the opening; card and campaign steps wait.
  - Tests: `tests/extension/setup-opening-choice.test.mjs` (5: opening read times out, rejoin keeps the choice while
    still reading, `campaign.create` pins it; create-campaign with no choice asks and creates nothing; a campaign
    created without its opening -- the Masks state, via the fake kernel's `setup.steps` resume -- asks, keeps the
    question on screen, refuses a scene the book does not offer, then records/pins/prepares on `prepare-module`;
    single-opening book unchanged; the Haunting unchanged on the real kernel), `character-guidance.test.mjs` (+2).
    19 mutations, all killed (table in the worker report). Existing files re-run green: setup, reading-service,
    steps-table, runtime-onboarding, npc-journal-lane, npc-voice-lane, thinking-schedule, onboarding-worker-model,
    onboarding-worker-unread-pdf, extension-words, host-state-not-fiction, reading-intent, review-refused-retry,
    reading-provider-failure, preparation-failure-words, launch, ui-words, system-language, contract-section-numbers.
  - **Open.** (1) Acceptance: the Masks re-run on a live table (integrator, after packaging). (2) A campaign that
    already pins an opening and then receives a different `start_scene` is not refused: the kernel keeps its pinned
    one, and the mismatch would surface as a `setup.prologue` refusal (the remedy stays open). (3) The kernel's
    `campaign.create` refusal "start_scene must name an authored opening" carries no candidates (a §14.15 gap); the host
    does not pre-validate the recorded scene. (4) The record is in-process before `create-campaign`: a setup process
    restarted before then starts over from choose-source, as it always has, and the book, already read, asks again at
    once. `manifest.json` untouched.
