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
