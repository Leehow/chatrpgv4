Status: ready (filed 2026-09-26 from the Masks PDF table; batch 18; P0: a PDF book with two openings can never be played)
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
