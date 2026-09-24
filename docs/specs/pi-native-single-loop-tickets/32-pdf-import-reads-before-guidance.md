Status: ready-for-agent
Stage: SL-32 (P0, product import path; blocks SL-29)
Spec: docs/kernel-rpc.md §20, §22, §98 (setup), §90.5

# SL-32 — The App's PDF import fails on any unread book: guidance is keyed before the first reading

## Evidence (SL-29A, 2026-09-24, worktree chatrpgv4-wt-pdf-a, logs under its .coc/playtests/sl29-a-import/)
- The App's import runs `build/pipicoc/onboarding-worker.mjs` (orchestrated by Electron/packages/pi-backend/src/coc-onboarding.ts via runtime/preparation.ts): inspect → guidance → opening → converse.
- `inspect` registers 血色公路 as `book-1` (no graph yet). `guidance` fails at once: `ENOENT … .coc/modules/book-1/module-graph.json`; the App's retry hits the same step. No model call, no reading job.
- Cause: `pipicoc/onboarding-worker.ts:200` computes the guidance key before any reading; that calls `extensions/module/character-guidance.ts:61`, which always reads `module-graph.json`. Commit `d552e5f77` (2026-09-20) removed the check that skipped this read for PDF modules. The App's last successful PDF import is dated 2026-09-18.
- No test runs the worker's guidance step on a freshly registered PDF (every `guidanceFingerprint` test writes a graph first).

## Scope
1. Contract: state in §20/§98 (dated addendum) the order for an unread book: the first reading (§22's opening reading / demand-driven graph) produces the graph before any guidance key is computed; a starter with a shipped graph skips the reading as before.
2. Fix `onboarding-worker.ts` (and `character-guidance.ts` if it must tolerate a missing graph until the reading lands) so an unread PDF goes through the reading first; keep `d552e5f77`'s intent for starters.
3. Test through the real worker entry with a small fixture PDF the suite owns (find how existing PDF tests provide one): inspect → guidance on a fresh book succeeds (or waits on the reading job) instead of ENOENT; mutation: the old order fails the test.
4. Manual check: run the worker as the App spawns it on 血色公路 (the harness `pdf-a/worker.sh` in the session scratchpad shows the exact spawn) through `guidance` and `opening`, reporting stages, wall and model calls; stop before `converse` (SL-29's workers take it from there).

## Comments
