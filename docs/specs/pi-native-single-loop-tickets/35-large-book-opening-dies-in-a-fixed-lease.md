Status: ready-for-human (filed 2026-09-24 from SL-29B; batch 4; implemented 2026-09-24 on `claude/sl35-20260924`)
Stage: SL-35 (P0, PDF import; blocks SL-29 book B)
Spec: docs/kernel-rpc.md §20, §98 (import addenda), provider budget (`runtime/jev/provider-budget.ts`)

# SL-35 — The opening reading of a 669-page book dies inside a fixed provider lease, and the refusal hides which ceiling fired

## Evidence (SL-29B Masks of Nyarlathotep, 2026-09-24, `claude/pdf-b-20260924`@a09af182; ticket 29's book B phase-2 entry; `.coc/playtests/sl29-b-run1/{guidance,opening}.events.jsonl`, module home `.coc/playtests/sl29-b-run1/home/.coc/modules/book-1/`)
- inspect 1 s (669 pages); guidance 77 s, 6+2 calls, ready ("Start: Lima", Bar Cordano). opening #1: 241 s, 12 reader calls, 0 reviews, 332K/12K tokens: two 120 s reading rounds `ok: false`, then `ContractError: provider_budget_refused`. opening #2 (`retry: true`): 239 s, 13+0 calls, 290K/3K, identical shape. No campaign was created. Phase 1 (before SL-32/33) saw the same shape with explicit stream-timeout / connection-error text, so SL-32/33 did not touch it.
- `pipicoc/onboarding-worker.ts` gives `reader.prepare()` no provider budget, so `runtime/tasks.ts:286` wraps every reading task in `independentProviderBudget("standalone-<kind>", signal, timeoutMs ?? 3600000)`: a fixed lease (input tokens, output tokens, USD, action count) sized without regard to the book's length, the stage, or the reader model's context window.
- `extensions/module/reader.ts:306`: any exception in the provider grant/settle path (`unknown_provider_reservation`, a genuine transport failure, a lease ceiling) is answered to the child as the one string `provider_budget_refused` and the reader is killed; the evidence cannot say which ceiling fired.
- Not scored, to rule in or out: two other live sessions shared the same grok-build login during the run.

## Scope
1. Find the actual ceiling from the evidence (the lease's action count against 12–13 calls, the 120 s reading rounds, the transport errors of phase 1) and say so in the ticket before changing anything.
2. The refusal carries its cause: `provider_budget_refused` becomes a typed failure with `details.reason` (`budget_input_tokens` / `budget_actions` / `budget_usd` / `transport` / `unknown_reservation`), the ceiling and the usage at refusal; the worker's event log and the App's import panel show it.
3. The lease is sized by the stage and the book: the onboarding worker passes an explicit `providerBudget` per stage (inspect/guidance/opening) derived from page count and the reader's per-page cost from the index, with a stated floor and ceiling; a reading round that hits 120 s `ok: false` twice is a failure with a reason, not a silent retry into the lease.
4. Same files, two P4s from book A: the campaign title strips the upload's extension (`coc-onboarding.ts` `converse`: `title: job.name`); the worker's own background index/detail jobs are not cancelled at exit (finish or hand them to the library owner), so the first table does not re-read them.
5. Tests, mutation-killable: the typed refusal (each reason); the per-stage budget derivation on a fixture with a page count; the title; the exit hand-off. Then the manual check on the Mac, one import at a time: Masks through `opening` with the App's worker order (`29-book-b/worker.sh`), reporting stage walls and calls; stop before `converse` unless it succeeds, in which case create the campaign and report its `campaign.json` title.

## Comments

- **2026-09-24, Scope 1 -- which ceiling fired (written before any code change; worker `claude/sl35-20260924` on `1660ec0fd`).**
  Read from the SL-29B evidence (`chatrpgv4-wt-pdf-b/.coc/playtests/sl29-b-run1/home/.coc/modules/book-1/work/read-{3,4}/attempt-1/read-{1,2}.jsonl`,
  phase 1's `chatrpgv4-wt-pdf-b/.coc/modules/book-1/work/read-3/attempt-1/read-{1,2}.jsonl`), `grok-build-models.json`
  (`grok-4.7-build-fast`: `context_window` 500,000, `max_completion_tokens` 16,384) and the lease code.
  - **The lease is per reader child, not per reading.** `runtime/tasks.ts:286` makes a fresh `independentProviderBudget`
    for every `runTask`, so every author round and every review unit gets its own `{1,000,000 input, 65,536 output,
    $10, 16 actions}`. The "12–13 calls" of an opening attempt are two rounds of 5–6 calls each, two leases. **Actions
    never came near 16** (max 6 calls in a round). **USD never counted** (grok-build usage reports `cost.total` 0).
    **The deadline never fired**: it is `timeoutMs ?? 3,600,000`, and nothing on this path passes a `timeoutMs`.
  - **The ~120 s is not a timer.** No 120 s bound exists on a reading round (the reader's default is 1 h;
    `PI_COC_READ_WAIT_MS`'s 120 s is the worker's foreground *wait*, whose expiry is the `unwaited` row and a rejoin). The
    rounds end at 112–125 s because they share one shape: 4–5 fast calls (~20 s), one call that stalls or writes for
    60–90 s, then pi's auto-retry 2 s later.
  - **Three of the four phase-2 rounds, and both phase-1 rounds, died on the input-token ceiling, triggered by a
    transport error.** A multimodal call reserves the model's whole context window (`boundProviderRequest`: 500,000),
    and a call that ends in `error` is settled with no usage, so the lease charges it that whole reservation. The
    retry pi then sends reserves another 500,000 against what is left:
    | round | actual input before the error | charged for the errored call | left | retry asks | outcome |
    | --- | --- | --- | --- | --- | --- |
    | ph2 read-3 r2 (4 calls, then "Provider stream timed out: no response event for 60000 ms") | 118,706 | 500,000 | 381,294 | 500,000 | refused |
    | ph2 read-4 r1 (5 calls, then the same timeout) | 149,375 | 500,000 | 350,625 | 500,000 | refused |
    | ph2 read-4 r2 (4 calls, then the same timeout) | 140,514 | 500,000 | 359,486 | 500,000 | refused |
    | ph1 read-3 r1 (4 calls, then the same timeout) | 88,748 | 500,000 | 411,252 | 500,000 | refused |
    | ph1 read-3 r2 (two text-only `Connection error.`, 2 calls, then `Connection error.` on an image call) | 47,739 + the two text reservations | 500,000 | < 452,261 | 500,000 | refused |
    `reserveQueued` throws `task_budget_exhausted` (requested > remaining + held), the host answers the child
    `provider_budget_refused`, the child echoes it back as `coc-provider-failure`, and that echo **overwrites** the
    host's own error string (`reader.ts:303`, `providerError` is reassigned on the echo), so the round's error reads
    `Error: ContractError: provider_budget_refused` and the real `task_budget_exhausted` is lost.
  - **The fourth phase-2 round (read-3 r1) died on the output bound, not on a refusal.** Its 6th call wrote the draft:
    10,933 output tokens reported against the 8,192 the host bound (`boundProviderRequest`'s default `outputLimit`,
    written into `max_output_tokens`; grok reports reasoning in `output`). The settle is an overrun
    (`task_budget_overrun`), which cancels the lease and kills the child at that message end (15:14:33.748). Its
    `findings.json` was overwritten by round 2, so no file on disk said so.
  - **Not the shared login.** Every failure is explained by the accounting above without any contention; the
    transport errors themselves may have been contention, but they would have been survivable retries under a lease
    that could pay for them.
  - So: the ceiling that fired is the lease's **input tokens** (1,000,000 fixed, against a 500,000-token reservation
    per image call and a full charge for every errored call), with **output per call** (8,192) as the second; the
    trigger is a provider stream timeout / connection error, which pi retries into a lease that can no longer pay.

- **2026-09-24, implementation (`claude/sl35-20260924`: eaa3d5d05, 8a8a9ff39; base 1660ec0fd).**
  - **Contract first:** `docs/kernel-rpc.md` §20 addendum 2 (the stage lease, the typed refusal, the round rule, the
    title, the hand-off) and §98 addendum 6 (the title).
  - **Typed refusal (Scope 2).** `TaskLease` refusals are `BudgetRefusal` (codes unchanged:
    `task_budget_exhausted` / `task_budget_overrun`) carrying `{dimension, ceiling, used, held, requested[, reserved,
    overrun]}`; an overrun cancels the lease with that record (`runtime/jev/task-context.ts`).
    `providerRefusal`/`providerRefusalText` (`runtime/jev/provider-budget.ts`) type every cause:
    `budget_input_tokens` / `budget_output_tokens` / `budget_actions` / `budget_usd` / `budget_deadline` /
    `unknown_reservation` / `provider_protocol` / `transport`, plus `after_provider_error` (the error the refused
    retry followed) and `unknown_usage_calls`. The reader host (`extensions/module/reader.ts`) keeps the **first**
    cause (the child's echo no longer overwrites it), returns it as `outcome.refusal`, and reports a round that ended
    on a provider error as `outcome.providerError`. The reading service writes a `provider_refused` telemetry row and
    passes `refusal {message, rule: provider_budget_refused | reader_transport, reason}` to `module.read.finish`
    (§22.3.1's record, so the kernel keeps it); `findings.json` keeps the numbers. The worker's `error` event carries
    `refusal`; the App keeps `reason` and `refusal` on the failed phase and its snapshot (`coc-onboarding.ts`).
  - **Stage lease (Scope 3).** `runtime/jev/reading-stage-budget.ts`: `READING_STAGE_BUDGET` (named defaults:
    per-page 16,000 in / 1,000 out / 0.5 actions / US$0.03; share inspect 0, guidance 0.5, opening 1, prepare 1.5;
    floor 4M / 262,144 / 64 / US$10; ceiling 40M / 2M / 800 / US$100; deadline 2 h; per-call output 32,768),
    `readingStageBudget` = per dimension `clamp(floor, pages x per-page x share, ceiling)`, `measuredPageCost` from the
    `usage.jsonl` rows every author round now writes (a measurement only raises the default: it counts the author,
    the lease also pays review), `withStageLease` (the worker runs guidance/opening/prepare inside it; none under an
    operator `PI_COC_READER_CMD`, as `runtime/tasks.ts`). `ReadingService.prepare` takes `{providerBudget}`. The
    lease's `callOutputTokens` reaches the child as `PI_COC_PROVIDER_OUTPUT_LIMIT` (bound = min(model maxTokens,
    32,768)). Round rule: a typed refusal from a lease the job shares across rounds fails the job at once; a round that
    failed on the provider gets the second round, and a second such failure fails with `reason: transport`; with a
    fresh lease per round (the table's reads) a refusal still gets the second round.
  - **P4s (Scope 4).** `bookTitle(job.name)` strips the upload's extension for `converse`'s `title`.
    `ReadingService.dispose/close({handOff})`: at the worker's exit (result, failure or pause) a reading nobody waits
    on is handed off (reader child stopped, no `module.read.finish`, `handed_off` row); the job stays `running` with no
    lock holder and the next owner's claim re-queues it with its retained attempt. A waited-on reading is still
    `cancelled` on a pause; the table host's shutdown is unchanged.
  - **Tests (Scope 5), 29 mutations, all killed** (copy-revert runner, never `git checkout --`):
    `tests/extension/provider-refusal.test.mjs` (real reader host + scripted child with the real child channel: the
    Masks shape -- text ok, image ok, image ends in "Provider stream timed out", retry refused on input tokens with
    `used 10030 = 15 + 15 + 10000`; actions / output / USD; overrun; unknown reservation; changed model; transport;
    per-call output bound; classifier), `tests/extension/reading-stage-budget.test.mjs` (669-page derivation, floor,
    ceiling, shares, inspect, measurement, held vs used, direct `reserve`, `withStageLease`),
    `tests/extension/reading-provider-failure.test.mjs` (stage refusal: one round, typed finish, `provider_refused`
    row, `usage.jsonl`, findings; no stage lease: two rounds; transport twice; hand-off vs waited-on vs table),
    `Electron/packages/pi-backend/test/coc-onboarding.test.ts` (title; typed refusal on the phase).
    Killed: M1 wrong dimension at `reserve`; M2 `used` ignores `held`; M3 overrun loses `reserved`; M4 overrun cancels
    with the bare code; M5 input/output reasons swapped; M6 deadline untyped; M7 child `ContractError:` prefix kept;
    M8 last refusal wins (echo overwrites); M9 output bound not put in the child env; M10 child ignores it; M11
    provider failure not reported; M12 stage refusal retried into the lease; M13 any refusal final; M14 no usage rows;
    M15 provider failure untyped; M16 hand-off still finishes `cancelled`; M17 hand-off takes waited-on jobs; M18 no
    floor; M19 no ceiling; M20 share ignored; M21 any page count measures; M22 failed rounds measured; M23 stage runs
    without its lease; M24 stage lease left open; M25 lease under `PI_COC_READER_CMD`; M26 title keeps `.pdf`; M27
    phase drops the refusal; M28 snapshot drops it; M29 measurement lowers the per-page cost. Not killed by a test:
    the worker's one-line pass-through of `withStageLease`'s budget into `reader.prepare` and the `refusal` field of
    its `error` event (a worker test needs a Pi child with a provider channel; a stand-in reader disables budgeting
    by design) -- both verified on the live run below.
  - **Suites (leehow-pc):**
    - `ext` @ 8a8a9ff39: `ℹ tests 3001` / `ℹ pass 2994` / `ℹ fail 7` with the box at load 28 on 16 threads (wall 504 s).
      The 7: `actual Keeper preparation overlaps NPC and material decisions…`, `a read_more on the same scene reuses the
      first read's prescreen…`, `Keeper explicitly requests support with preload off…`, `post: a review that could not
      answer…`, `root consultation completes through a child…`, `source-only startS0Rpc…` (one listed twice). All six
      files pass on the Mac at the same commit (`ℹ tests 34` / `ℹ pass 34` / `ℹ fail 0`), and all passed in the
      box's earlier run at eaa3d5d05 (`ℹ tests 3001` / `ℹ pass 3000` / `ℹ fail 1`, wall 224 s; the one failure was CJK
      in a `coc-onboarding.ts` comment, fixed in 8a8a9ff39): timing under load, not this change.
    - `loop` @ 8a8a9ff39: `# tests 152` / `# pass 152` / `# fail 0`.
    - `py` @ eaa3d5d05 (+ the per-page change as overlay): `1719 passed, 2 skipped in 410.21s (0:06:50)`.
  - **Manual check on the Mac** (the App's worker order through `29-book-b/worker.sh` repointed at this worktree, fresh
    home `.coc/playtests/sl35-masks/home`, `grok-build/grok-4.7-build-fast` low, zh-Hans, Jev key from the vault, one
    import at a time):
    | stage | wall | reader calls | review calls | tokens in / out | lease | outcome |
    | --- | --- | --- | --- | --- | --- | --- |
    | inspect | 1 s | 0 | 0 | 0 | none (share 0) | `book-1`, 669 pages |
    | guidance | 134 s | 6 (2 rounds x 3) | 4 | 166,343 / 12,314 | 5,352,000 in, 168 actions | ready, scene "Start: Lima" |
    | background index `read-2` | handed off at guidance's exit after 0 pages; re-queued (attempt 2) and completed inside the opening worker | 14 | 0 | 497,785 / 7,740 | its own (per child) | completed |
    | opening | 392 s | 24 (15 + 9) | 189 (35 units, 2 review rounds) | 4,433,838 / 118,669 | 10,704,000 in, 335 actions | failed on review, round 2 |
    - **No provider refusal fired and no provider error occurred** (0 `provider_refused` rows, 0 errored calls), so
      no typed provider reason surfaced live. The opening's failure is content, not the lease: `code: needs`,
      `reason: reading_failed`, `refusal {reason: reading_failed, path: /review/missing}` -- the independent review
      found material missing (e.g. "A successful Psychology roll on Luis de Mendoza reveals that he has a special
      dislike for Jackson Elias", p. 63). Stopped there per the brief: no retry, no `converse`, no `campaign.json`
      (the title is covered by the unit test only).
    - What the change did live: round 1 of the opening spent 716,473 input tokens in one child (the old per-child lease
      was 1,000,000; one stalled image call charged 500,000 would have refused its retry), and its draft call reported
      **11,900 output tokens** -- over the old 8,192 bound, the overrun that killed phase 2's read-3 round 1. It
      completed because the stage lease's per-call bound reached the child, which is also the live proof that the
      worker passed the stage lease into `reader.prepare`. The stage used 213 of 335 actions and 4.43M of 10.7M input.
    - Evidence: `.coc/playtests/sl35-masks/{inspect,guidance,opening}.events.jsonl`, `.../home/.coc/modules/book-1/`
      (`deepen-queue.json`, `work/read-{1,2,3}/attempt-*/{read-*.jsonl,usage.jsonl,findings.json,verify-*}`), all
      gitignored.
  - **Open, not done here:** (1) the table's reads (detail/answer during play) still get the fixed per-child
    standalone lease in `runtime/tasks.ts`; the Masks shape (a stalled image call, then its retry) will refuse there,
    now typed as `budget_input_tokens` with `after_provider_error` -- sizing that path is a separate ruling. (2) An
    output overrun still cancels the lease; raising the per-call bound avoided it here, but a reasoning provider that
    reports output above its bound is still fatal to the round. (3) Masks' opening fails its independent review
    twice on missing authored material (SL-29 book B's next step, not a lease question).
