Status: ready (filed 2026-09-24 from SL-35's report; next batch)
Stage: SL-41 (P1, in-play reading on PDF modules; confirmed live on SL-29A batch-4 table: `budget_input_tokens` at 1,000,000 on the detail read; with SL-45)
Spec: docs/kernel-rpc.md §20 addendum 2, §98 addendum 6 (SL-35), §22

# SL-41 — Reads during play (detail, answer, map) get the same sized lease as the import stages

## Evidence (SL-35, 2026-09-24)
- SL-35 sized the import stages' provider lease from the book (`runtime/jev/reading-stage-budget.ts`, shares inspect 0 / guidance 0.5 / opening 1 / prepare 1.5) and typed the refusal. Reads raised during play (`purpose: detail`, `answer`, and the map job) still get the fixed per-child lease in `runtime/tasks.ts` (1M input tokens, 16 actions): the same Masks pattern (an image call reserves the model's whole 500K context; a call that dies in a provider error is charged the full reservation; the retry is refused) will refuse an in-play read on a large book, now with a typed reason but still refused.
- An output overrun above the per-call limit still cancels the lease; the larger limit (32,768) avoided it once, but a provider reporting output above its limit still kills the round.

## Scope
1. Contract: the in-play read purposes are stages of the same table (`detail`, `answer`, `map` shares named in `READING_STAGE_BUDGET`), sized from the book like the import stages; the refusal reasons of SL-35 apply.
2. `runtime/tasks.ts`: the per-child lease for a play read is derived from the module's page count and measured per-page cost, not the fixed default.
3. An output overrun fails the call with `budget_output_tokens` and lets the round continue with the next call, instead of cancelling the whole lease.
4. Tests, mutation-killable, on the stage-budget fixture; then one `lookup kind=source` answer on the Masks module home from SL-35's evidence.

## Comments
