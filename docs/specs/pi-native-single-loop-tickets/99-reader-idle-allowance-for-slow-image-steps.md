Status: ready (filed 2026-09-26 from the Masks PDF table; batch 18; P1: with every lane on grok-4.5 low the book reader dies on its writing step)
Stage: SL-99 (reading: a reader step that is thinking over many page images is not idle)
Spec: docs/kernel-rpc.md §22 (reading), §140 (child output bound), the stream-progress watchdog (`vendor/pi/packages/coding-agent/src/core/stream-progress.ts`, `sdk.ts` ~415, `settingsManager.getHttpIdleTimeoutMs()`); the reader task (`runtime/tasks.ts`, `extensions/module/reader*.ts`, `extensions/lanes/subsession.ts`); `content/rulesets/coc7/host-budgets.json`

# SL-99: the reader's writing step is killed by the 60 s no-event watchdog

## Evidence
The Masks PDF table (`chatrpgv4-wt-gate-13ce6a7dd-masks/.coc/modules/book-1/work/`), where the reader runs on the lane model grok-build/grok-4.5 low (the owner's ruling):
- Opening reads read-4 and read-5 (`campaign-beginning-elias-message`) each follow the same pattern:
  1. view about 7 page images of about 900 KB each (`pdf {pages:[94..100]}`, crops);
  2. write "Writing the opening draft…";
  3. end with `Provider stream timed out: no response event for 60000 ms`.
- Across the job: 12 such timeouts. Each round resends every page image (62–67k input tokens per round). Both jobs died on `task_budget_exhausted` (`budget_input_tokens`) with `pages: 0` written.
- read-6 of the same focus landed on its second round. About 10 minutes of the player's setup went to this.
- grok-4.5 sends no event while it reasons over a large multimodal context, so the session-wide idle allowance (`httpIdleTimeoutMs`, 60 s) reads a working step as a dead stream.
- The book's index read (read-2) used 1.64M input tokens across 2 rounds. Report it; it is not in this ticket's fix.

## Ruling
- The idle allowance of a **reader** step comes from data (`host-budgets.json`, a reading entry). It is long enough for a reasoning model's silent phase over the page images it is holding; derive the number from measured time-to-first-event on the evidence.
- The Keeper's and other lanes' allowances are unchanged.
- A step that times out after doing no work must not burn the job's whole input budget on identical resends. Report how the budget is charged and fix the charging if the evidence shows the timeout round is billed in full with no progress.

## Scope and tests
- Where the reader child gets its settings; a data knob; mutation-killable tests that the reader child gets the long allowance and a Keeper session does not.
- Measure from the evidence: the time-to-first-event distribution of grok-4.5 reader steps by image count, from the `requests.jsonl` / session files under `work/read-*/`.
- Contract addendum under §22 or §140 (stable ids).

## Acceptance
Re-run the Masks table: reader timeouts 0 or near 0; no opening read dies on budget.

## Comments
