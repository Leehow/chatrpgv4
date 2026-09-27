Status: ready-for-human (implemented 2026-09-26 on claude/sl99-20260926, head 7a5567414; the Masks re-run acceptance is the owner's)
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

**2026-09-26, implementation (worker, branch `claude/sl99-20260926`, base 6f1b2f5be).** One commit:
- `7a5567414` fix(reading): a reader child's idle allowance is data (180 s), and an identical resend is paid from its failed attempt's reservation (§140.1, SL-99)

Files: `docs/kernel-rpc.md` (§140.1), `content/rulesets/coc7/host-budgets.json` (`reading.idle_ms: 180000`),
`runtime/jev/host-budgets.ts` (`ReadingIdleBudget`/`readingIdleBudget`/`resetReadingIdleBudgetCache`), `runtime/tasks.ts`
(reader tasks take it), `runtime/jev/provider-budget.ts` (`payloadDigest`, `resentUsage`, the child's `digest` and `failed`),
`extensions/module/reader.ts` (the host keeps a failed call's reservation for its identical resend), tests below.

**Two corrections to the ticket's framing, from the evidence.**
1. *Three timeouts, not twelve.* `read-4` rounds 1 and 2 and `read-5` round 1, one each. Each is written on four lines of
   its event log (`message_end`, `turn_end`, `agent_end`, `auto_retry_start`); 3 x 4 = 12. `reading-telemetry.jsonl`
   has exactly three `provider_refused` rows with `after_provider_error` the stall.
2. *The silence is not the model reasoning over the images.* The first event after the stream starts is quick at every
   image count (grok-4.5 author steps holding 10-14 images: p99 4.9 s). All three cuts came right after the model
   announced its draft ("Writing the opening draft from the viewed pages.", "...from the viewed Chapter One pages.",
   "Writing the opening-batch draft from the viewed pages."): it was generating its draft tool call. grok-build and xai
   deliver a tool call's arguments as a single delta once all of it is generated (2,107 grok-build tool calls, 2,107
   `toolcall_delta`s; 1,779 and 1,779 on xai; deepseek sends about 150 per call), so a draft call is silent for as long
   as its generation takes. The healthy retry of this same draft (`read-5` round 2) was silent 55.8 s before a 19,373-byte
   `write` (5,392 output tokens); grok-4.6 went 114.4 s before an 8,025-token `submit_reading`. The fix is the same one the
   ticket asked for (a longer reader allowance from data); the measurement is what sizes it.

**Measurement.** Script: every `<log>.jsonl` with a `.requests.jsonl` sibling under the App's module store
(`~/Library/Application Support/Pipi/pipicoc/pi-coc/.coc/modules/*/work`, 820 logs) and `chatrpgv4-wt-*/.coc/modules/*/work`
(`pi-coc-v2` 193, `gate-13ce6a7dd-masks` 84, `pdf-a` 35, `pdf-b` 18, `mod-vocabulary` 3): 6,606 provider attempts in 1,153 event
logs, 2026-09-09 to 09-26, read only. One row per assistant `message_start`..`message_end`; the images are the
`images.jsonl` line of the request sent before it. *First event* = from the stream's start (`message_start`, when the
watchdog is armed) to its first content event. *Longest silence* = the longest gap between consecutive events of the
attempt, which is what the watchdog measures; for a cut attempt it is a lower bound (>= 60). The last column counts, among
healthy silences over 20 s, those that ended with the tool call arriving (`toolcall_start`). "author" = read, index and
index-audit children; "review" = verify children.

| model (effort low unless noted) | step | images in context | steps | image MB p50/max | first event after start, s: p50/p99/max | longest silence, s: p50/p99/max | cut at 60 s | silences >20 s ended by the tool call arriving |
|---|---|---|---|---|---|---|---|---|
| grok-4.5 | author | 0 | 23 | 0.0/0.0 | 1.2/3.3/3.3 | 1.2/3.3/3.3 | 0 | 0/0 |
| grok-4.5 | author | 1-4 | 8 | 1.7/3.5 | 1.3/6.0/6.0 | 1.3/6.0/6.0 | 0 | 0/0 |
| grok-4.5 | author | 5-9 | 12 | 5.9/7.6 | 2.2/5.9/5.9 | 2.3/42.3/42.3 | 0 | 2/2 |
| grok-4.5 | author | 10-14 | 19 | 8.7/12.3 | 1.8/4.9/4.9 | 2.1/60.0/60.0 (>=60) | 3 | 1/1 |
| grok-4.5 | author | 15+ | 22 | 21.4/22.6 | 7.1/10.5/10.5 | 8.0/41.0/41.0 | 0 | 2/2 |
| grok-4.5 | review | 0 | 173 | 0.0/0.0 | 1.2/2.8/3.6 | 1.3/2.8/3.6 | 0 | 0/0 |
| grok-4.5 | review | 1-4 | 118 | 2.6/3.9 | 1.9/5.0/5.1 | 2.6/10.8/11.0 | 0 | 0/0 |
| grok-4.5 | review | 5-9 | 13 | 6.5/8.2 | 2.6/26.0/26.0 | 4.6/26.0/26.0 | 0 | 0/1 |
| grok-4.6 | author | 0 | 136 | 0.0/0.0 | 0.5/6.9/16.2 | 0.8/12.0/16.2 | 0 | 0/0 |
| grok-4.6 | author | 1-4 | 63 | 2.2/8.3 | 1.0/12.1/12.1 | 2.7/114.4/114.4 | 0 | 4/5 |
| grok-4.6 | author | 5-9 | 47 | 5.8/13.9 | 1.3/19.5/19.5 | 1.5/38.2/38.2 | 0 | 2/7 |
| grok-4.6 | author | 10-14 | 38 | 9.1/25.3 | 1.5/55.9/55.9 | 2.1/55.9/55.9 | 0 | 4/8 |
| grok-4.6 | author | 15+ | 43 | 21.1/33.4 | 2.7/23.1/23.1 | 4.3/87.3/87.3 | 0 | 2/6 |
| grok-4.6 | review | 0 | 2306 | 0.0/0.0 | 0.5/10.6/122.3 | 0.7/11.7/122.3 | 0 | 0/15 |
| grok-4.6 | review | 1-4 | 1263 | 2.0/8.3 | 0.8/11.9/56.4 | 1.8/15.6/56.4 | 0 | 0/5 |
| grok-4.6 | review | 5-9 | 264 | 3.7/8.8 | 1.3/13.4/14.8 | 0.0/13.9/15.2 | 0 | 0/0 |
| grok-4.6 | review | 10-14 | 57 | 7.3/10.4 | 1.3/11.9/11.9 | 0.8/11.9/11.9 | 0 | 0/0 |
| grok-4.6 | review | 15+ | 12 | 12.1/12.1 | 1.2/6.7/6.7 | 2.7/20.9/20.9 | 0 | 0/1 |
| grok-4.7-build-fast | author | 0 | 20 | 0.0/0.0 | 0.3/1.5/1.5 | 0.3/3.8/3.8 | 0 | 0/0 |
| grok-4.7-build-fast | author | 1-4 | 23 | 3.3/4.6 | 0.6/2.1/2.1 | 1.0/22.8/22.8 | 0 | 0/1 |
| grok-4.7-build-fast | author | 5-9 | 20 | 5.6/8.7 | 0.8/3.9/3.9 | 0.8/60.0/60.0 (>=60) | 1 | 0/0 |
| grok-4.7-build-fast | author | 10-14 | 3 | 11.6/12.1 | 1.4/1.9/1.9 | 1.4/1.9/1.9 | 0 | 0/0 |
| grok-4.7-build-fast | author | 15+ | 9 | 15.9/15.9 | 0.9/4.8/4.8 | 2.2/18.1/18.1 | 0 | 0/0 |
| grok-4.7-build-fast | review | 0 | 41 | 0.0/0.0 | 0.1/0.5/0.5 | 0.8/2.6/2.6 | 0 | 0/0 |
| grok-4.7-build-fast | review | 1-4 | 57 | 2.2/4.6 | 0.7/7.1/7.1 | 4.1/18.8/18.8 | 0 | 0/0 |
| grok-4.7-build-fast | review | 5-9 | 9 | 5.6/8.4 | 0.9/1.8/1.8 | 4.9/9.0/9.0 | 0 | 0/0 |
| grok-4.7-build-fast | review | 10-14 | 2 | 9.3/9.3 | 0.7/0.7/0.7 | 0.7/3.0/3.0 | 0 | 0/0 |
| deepseek (3 models) | author | 0 | 94 | 0.0/0.0 | 0.5/1.1/1.1 | 0.5/1.1/1.1 | 0 | 0/0 |
| deepseek (3 models) | author | 1-4 | 120 | 3.0/4.5 | 0.6/1.6/1.8 | 0.6/1.8/2.8 | 0 | 0/0 |
| deepseek (3 models) | author | 5-9 | 27 | 4.4/5.9 | 0.6/1.4/1.4 | 0.6/2.6/2.6 | 0 | 0/0 |
| deepseek (3 models) | author | 10-14 | 42 | 7.0/13.8 | 0.7/1.7/1.7 | 0.7/1.7/1.7 | 0 | 0/0 |
| deepseek (3 models) | author | 15+ | 41 | 12.8/15.0 | 0.6/1.8/1.8 | 0.6/1.8/1.8 | 0 | 0/0 |
| deepseek (3 models) | review | 0 | 531 | 0.0/0.0 | 0.5/1.6/1.9 | 0.5/1.6/1.9 | 0 | 0/0 |
| deepseek (3 models) | review | 1-4 | 479 | 2.0/4.3 | 0.6/1.5/2.4 | 0.6/2.0/2.4 | 0 | 0/0 |
| deepseek (3 models) | review | 5-9 | 267 | 4.1/9.6 | 0.6/1.5/3.0 | 0.6/1.5/3.0 | 0 | 0/0 |
| deepseek (3 models) | review | 10-14 | 77 | 7.2/14.9 | 0.7/1.7/1.7 | 0.6/1.7/1.7 | 0 | 0/0 |
| deepseek (3 models) | review | 15+ | 127 | 9.7/15.3 | 0.8/1.6/1.9 | 0.8/1.6/1.9 | 0 | 0/0 |

Worst healthy silences on record: 122.3 s (grok-4.6 review, before its first event; App book-2, 2026-09-13, 14 review
units in flight), 114.4 s (grok-4.6 author, before an 8,025-token `submit_reading`), 87.3 s (grok-4.6, a 25 KB `write`), 55.8 s
(grok-4.5, the Masks retry). Slowest silent generation rate on a grok reader: 65.3 output tokens/s (grok-4.6); grok-4.5's
slowest 90.9. The fourth reader timeout on record (`chatrpgv4-wt-pdf-b` read-3, grok-4.7-build-fast, 2026-09-24) also came as
the model began its draft (its last thinking delta is the start of a `submit_reading` call written as text).

**The allowance: 180,000 ms.** It clears the worst healthy reader silence (122.3 s) by about half again, the margin
§37.12 took for the lanes (16.42 s -> 25 s), and covers the largest draft call on record (10,933 output tokens, §20
addendum 2) at the slowest measured rate (167 s). For grok-4.5 that is roughly a 16,000-token draft call at its slowest
rate. It applies to every `reader`-kind task (index, index-audit, read, verify, character guidance, adaptation); the
Keeper keeps the agent home's 60 s and `mod` children keep 25 s. The price: a truly dead reader stream is noticed after
3 min instead of 1; all four reader timeouts on record came as the model began its draft, none on a dead connection
that the event log shows.

**Budget charging, before and after** (the Masks `read-4` round 1; the per-child fixed lease: 1,000,000 input tokens, 16
actions; each image call reserves the reader's context window, 500,000):

| step | before | after |
|---|---|---|
| calls 1-2 | settled at their usage, 62,341 | same |
| call 3 cut at 60 s, no usage | charged its whole reservation: used 562,341 | not charged yet; its 500,000 reservation is kept |
| Pi's auto-retry resends the identical request | asks for another 500,000: 1,062,341 > 1,000,000, refused `budget_input_tokens`; child killed, round failed, 0 pages | same digest and bound: granted from the kept reservation, no second reservation |
| the resend reports usage U | - | the reservation is settled at 2 x U (input, output, USD), capped at the reservation, never below U; one action |
| anything else follows (different payload, child ends) | - | the kept reservation is charged whole, as before, and counted in `unknown_usage_calls` |

Rounds 2 of `read-4` (567,317) and `read-5` round 1 (562,428) died the same way. A real Pi reader child against a stalling
local provider resends a byte-identical request with an identical digest (live test below), so this is the product path.
The same rule holds for every budgeted child the reader host runs (`mod` lane children included); only their idle
allowance differs.

**Not fixed here (for the owner).**
- `read-5` round 2 died on the same fixed lease with **no** timeout: 11 image calls used 536,114 input tokens and the 12th
  could not reserve 500,000 more. An opening or guidance read outside a stage lease keeps the fixed 1,000,000 lease (§20
  addendum 5 left them out); with a 500,000 whole-context reservation per image call it can pay only about half its
  ceiling in real calls. Sizing those jobs (`readingJobStage` naming `opening`/`guidance`) is a separate decision.
- The index read (`read-2`) used 1,644,424 input tokens over its two phases (992,637 index + 651,787 index-audit, 30
  calls) inside its own 8,507,402-token stage lease.
- A chain of identical attempts that no resend ever measures is now charged one whole reservation, not one per attempt
  (before, the second was usually refused on this lease). Retries stay bounded by the child's Pi retry setting (3).

**Mutations** (a copy of each source set aside, one edit, the named test files run, the copy restored with `cp`;
file hashes checked identical after the run):

| # | mutation | file | result |
|---|---|---|---|
| M1 | reader task gets no idle allowance | runtime/tasks.ts | killed: reader-idle-allowance (3 tests), lane-idle-timeout (1) |
| M2 | allowance hard-coded 180000, not read from data | runtime/tasks.ts | killed: reader-idle-allowance (fixture root, live child) |
| M3 | loader ignores the file (always the fallback) | runtime/jev/host-budgets.ts | killed: reader-idle-allowance (3) |
| M4 | reading allowance given to `mod` children too | runtime/tasks.ts | killed: reader-idle-allowance (mod keeps LANE value) |
| M5 | Keeper launcher takes `reading.idle_ms` | runtime/launch.ts | killed: reader-idle-allowance (Keeper keeps 60 s) |
| M6 | no inheritance: an identical resend reserves anew | extensions/module/reader.ts | killed: provider-refusal (2), live child |
| M7 | resend not scaled: failed attempts free | extensions/module/reader.ts | killed: provider-refusal (2), live child |
| M8 | inference not capped at the reservation | runtime/jev/provider-budget.ts | killed: provider-refusal (overrun cancels the lease), resentUsage unit |
| M9 | digest ignored (same bound inherits) | extensions/module/reader.ts | killed: provider-refusal (different request after a failure) |
| M10 | child never sends `failed` | runtime/jev/provider-budget.ts | killed: provider-refusal (2) |
| M11 | kept reservation never charged when the child ends | extensions/module/reader.ts | killed: provider-refusal (unmeasured chain) |
| M12 | inference floor removed (a report can be lowered) | runtime/jev/provider-budget.ts | killed: resentUsage unit |
| M13 | an aborted call also kept as failed | runtime/jev/provider-budget.ts | first survived; pinned by a new test (an aborted call is charged whole), then killed |

**Tests run on this Mac, single files, at `7a5567414`** (all pass): reader-idle-allowance 7/7, provider-refusal 10/10,
reading-play-lease 3/3, lane-idle-timeout 4/4, jev-provider-budget 12/12, reader-context 13/13, runtime-reader 22/22,
reader-submit 12/12, reading-provider-failure 4/4, reading-stage-budget 12/12, launch 15/15, provider-stream-stall 3/3,
lane-reasoning-budget 15/15, lane-session-headers 4/4, fast-model-resolution 46/46, consequence-host-budgets 13/13,
first-step-thinking-host-budget 5/5, delivery-floor-every-path 11/11, jev-task-runtime 14/14, contract-section-numbers 3/3,
system-language 5/5. No full suite, no pytest.

**For the integrator.** The live-child test reads the emitted `build/extensions/module/reader-context.mjs` (the child side of
the channel): run `npm run build:runtime` at the integrated head before `test:ext`, or it reads as a regression (no digest
from a stale child). In this worktree only that one entry was re-emitted (esbuild, same options as `build-runtime.mjs`);
`build/` is untracked. Three existing tests changed expectations, by design: provider-refusal's Masks-shape test (the
resend is now dispatched; the typed refusal is kept for a *different* next request), reading-play-lease (each call now
reads a different page, its subject being distinct image calls), lane-idle-timeout (the reader child now carries
`reading.idle_ms`). Acceptance (the Masks table re-run: reader timeouts 0 or near 0, no opening read dying on budget) is
still owed; note the fixed-lease finding above can still end an opening round without any timeout.
