Status: ready (filed 2026-09-24 from SL-29B; batch 4)
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
