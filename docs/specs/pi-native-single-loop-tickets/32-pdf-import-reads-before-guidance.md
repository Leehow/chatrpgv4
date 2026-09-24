Status: ready-for-human (implemented 2026-09-24 on `claude/sl32-20260924`@59b970d00 from `claude/integ-single-loop-20260923`@98cf8516d, which had not moved; awaiting review)
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

- **2026-09-24, implementation (claude/sl32-20260924, 59b970d00).**
  - Cause, narrowed: the guidance key, not the worker's order. `pipicoc/onboarding-worker.ts:200` (now :202) computes
    the key before the reading, which is the contract (§22.9: the key "does not depend on the complete graph
    generation"; "PDF guidance retains its source-file binding") -- the key is the identity the kernel queues the
    guidance reading under and accepts the guidance under. What broke is `guidanceFingerprint`
    (`extensions/module/character-guidance.ts:61`), which since `d552e5f77` read `module-graph.json` for every module.
    On an unread book the guidance reading *is* the first reading: the kernel handles a missing graph
    (`store.readGraph` returns null; publication assembles the first graph with the guidance), so no separate
    reading is needed before it.
  - What `d552e5f77` intended: the v2 reference protocol for host-authored guidance -- the key binds the
    selector protocol plus the opening scene node resolved on the graph and the opening NPCs the author selects a
    guide alias from (T14, "new fingerprint/cache acceptance must account for the selector protocol and actual
    opening/guide source fields"). That only has meaning where the host author runs on a shipped graph (starters,
    whose bundles are stamped with it). For a PDF the kernel's guidance reading writes the guidance and checks the
    guide against the graph at publication; its key only ever had to be source-bound. The commit dropped the
    `if(!meta.file_sha256)` branch for both kinds.
  - Fix: a module with `file_sha256` keys on `[file_sha256, {protocol: setup-guidance-reference-v2, opening as
    requested}, play_language, occupations, prompts]` and never opens the graph; a starter keys exactly as
    `d552e5f77` does (graph digest, resolved scene, guide NPCs), so its stamped bundles stay valid. The protocol
    stays in the PDF key, so pre-`d552e5f77` PDF caches are still not served. Not chosen: "tolerate a missing graph,
    bind it once present" -- the key would change after the first reading, so a retry or a second campaign on the
    same book would re-key and read its guidance again (the test kills that variant). Not chosen: a skeleton
    reading before guidance -- a whole extra reading on the import's critical path that §22.9's early guidance
    exists to avoid, with the same re-key problem.
  - Contract: §20 addendum (order for an unread book), §98 addendum 5, one-line pointer at §22.9.
  - Test: `tests/extension/onboarding-worker-unread-pdf.test.mjs` -- built worker, emitted kernel, real source
    helper, a two-page PDF the test writes, a stand-in reader via `PI_COC_READER_CMD`. `inspect` leaves no graph;
    `guidance` reaches a guidance reading (the stand-in records `purpose: guidance`, `zh-Hans`) with no error; the
    queued job's key equals `guidanceFingerprint` and is unchanged after a first graph is written. Mutations: the
    pre-fix `character-guidance.ts` fails with SL-29A's exact `ENOENT ... book-1/module-graph.json`; the
    tolerate-then-bind variant fails "the first graph does not change the key". ~2 s.
  - Suites (leehow-pc @59b970d00): loop 149/149; py 1719 passed, 2 skipped; ext 2941/2942 -- the one failure is
    `single-loop-looks-first-visit.test.mjs` "after the clerk's move ... carries the destination's passages"
    (`both reads ran the prescreen: ["prepared","fallback"]`, 25 s, a timing fallback under the 12-way run); the
    same file passed inside the loop run. Nothing on its path is touched here.
  - Manual check, 血色公路 (111 pp), spawned as `runtime/preparation.ts` does (built worker, App grok login copied into
    the worktree's agent home, Jev key from the vault, `grok-build/grok-4.7-build-fast` low, zh-Hans), fresh home
    `.coc/playtests/sl32-import/home` in the worktree. Mac load average 5-9.5 throughout (Spotlight `mds`/
    `mds_stores`, PipiUI, other sessions).

    | step | wall | stages | model calls (reader+review) | outcome |
    |---|---|---|---|---|
    | inspect | 0.9 s | bind | 0 | `book-1`, 111 pages, no graph |
    | guidance | 74.5 s | read 51.7 s (5 page images) → verify 21.5 s (1 unit) | 6 (4+2), ~73K in / 6.8K out | ready: key `d333f169…`, scene 序幕, graph gen 1; background index job started, cancelled when the worker exited (as before) |
    | opening #1 | 3 min 9 s | read 75 s → verify 8 units 45 s → read r2 14.6 s → verify 8 units 53 s | 47 (11+36), ~365K in / 47K out | **failed**: review refused `/nodes/0` (reader gave 序幕 the alias 片头字幕; p.76 lists them as separate steps); code `needs`, reason `reading_failed`, fix `retry: true`; shown as the generic "preparation stopped" |
    | opening #2 (App retry, `retry: true`) | 74.5 s | read 32 s → verify 8 units 41 s | 21 (5+16), ~197K in / 22K out | ready: `opening_ready: true`, graph gen 2, `installed`; guidance key recomputed on gen 2 still `d333f169…` |

    Import to a ready opening: ~5.5 min wall, 74 model calls, one player retry. Stopped before `converse`.
  - For SL-29 (not fixed here): the opening's first attempt was refused by its own reviewer over an alias, after two
    rounds; the retry passed. And that refusal reaches the overlay as `PREPARATION_STOPPED` with the review text in
    `detail` -- the player sees "retry", which works, but not why.

