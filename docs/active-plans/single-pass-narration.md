# Single-pass narration

Status: implementation and focused live verification complete; legacy test migration and integration pending.

## Approved objective

Deliver the Keeper's first completed draft directly. No automatic prose review, rejection/rewrite loop, post-delivery verifier, or NPC wording edit. Keep rule arithmetic, action admission, transactional replay, actual preparation and commit integrity. Provider failure recovery and installation/package changes are outside the approved implementation scope. Owner approved this policy in this chat on 2026-10-01; the current test Keeper is explicitly Flapcode GPT-6 Luna, low.

## Ownership and source

- Integration branch: `codex/single-pass-narration-20261001`, created from `15a4a48be` through the required lifecycle CLI.
- Checkout: `/Users/haoli/.codex/worktrees/single-pass-narration/chatrpgv4-wt-pi-coc-v2`.
- LAN script alias: `/Users/haoli/.codex/worktrees/single-pass-narration/source-single-pass-narration`. Its unique basename avoids another Codex run overwriting the remote scratch checkout.
- Main `0.9.6a` has another owner's dirty kernel/index, canonical dispatcher and contract edits. Do not stage or absorb them. An active wait checks for clean shared paths. A user-input question about messaging that owner is pending; do not message without an answer.

## Implemented

Contract section 166 and a fixed shared policy in `kernel-ts/runtime/narration-policy.ts`. All four delivery paths skip automatic prose review and repair. Mod definition preparation for actual apply/resolve remains. Deterministic rendering remains. Kernel prose-only refusal gates become advisory; actual state effects remain guarded. Keeper prompt asks for one completed draft from current facts.

## Evidence

- Focused extension tests for all delivery paths, active task guards, transaction replay, explicit/implicit hybrid close, markup, speaker attribution, memory extraction and disabled editing pass. Keep exact results in current tool logs; major contract migrations now pass focused checks: 25 core delivery/hybrid-close checks, 22 Python RPC checks, 18 admission checks, 14 line-admission/cost checks, 13 canonical dispatcher checks, 17 host-state/adaptation checks, 29 turn checks, 15 memory/lane checks, 14 speech attribution checks, 9 owed-position checks, 4 settled-card checks, 3 resend checks, 3 disabled-edit checks. Remaining complete-snapshot validation is not yet green.
- LAN focused Python: `test_markup_in_prose.py`, `test_narrate.py`, `test_npc_intents_done.py`: 22 passed, 2026-10-02.
- Genuine driver run `single-pass-flapcode-20261002` retained in the primary checkout's `.coc/playtests` and `.coc/campaigns`: 3 delivered turns, 1 narration per turn, 0 prose reviews, 0 rewrite steers, 0 unfinished notices. Provider/model confirmed from actual events: `flapcode/gpt-6-luna`; same plugin bytes as installed App. This is focused live verification, not full-scenario or packaged-App acceptance.
- The isolated `.tmp/flapcode-test-launch.mjs` reads the existing encrypted App vault in memory and loads the actual plugin. It contains no secret values. Set `PI_COC_HOME` to the primary checkout when using its driver; otherwise pregens and the source launcher use different homes. Do not expose credential values.
- Two earlier runs are marked invalid-for-intent/acceptance and retained; wrong relay and home must not be counted as live proof.

## Remaining

1. Finish migrating legacy review/repair tests. Full ext snapshot before several latest test updates: 4330 tests, 4189 pass, 140 fail, interrupted after no progress at an orphaned test. The remote log was copied to `/tmp/single-pass-full-ext.log`; do not call this run green.
2. Some failures are unused post-terminal faux responses occupying the next turn. Remove those stale fixture responses, preserving independent mechanics assertions. Some pure prompt assertions already fail on the base; confirm rather than changing unrelated prose guidance.
3. Retire automatic-review integration assertions replaced by section 166; keep explicit historical inspection/helper and source-authoring tests. Add or retain current-policy coverage rather than forcing a test-only legacy mode.
4. Run appropriate focused regression and required checks on the exact final tree. Heavy suites/builds use the LAN box, one heavy suite at a time. No new live model calls are necessary without a new relevant change.
5. Review/stage only assigned files, commit, integrate after the other owner settles shared paths, verify merged tree, then lifecycle terminal/audit/closeout. Preserve all live evidence outside the disposable checkout. No push or App install has been authorized.

Latest checkpoint: current focused checks confirm source mechanics and forward-only owed handling still work. The shared main checkout remains dirty in the contract, kernel/index, canonical dispatcher and hybrid engine; no integration has been attempted. The Flapcode driver is stopped and all genuine evidence remains in the primary checkout. The full test snapshot must be rerun or narrowed after the final fixture migration; the old interrupted snapshot is not current verification.

The current LAN full-ext run is session 88552 on remote source-single-pass-narration. Do not confuse the older shared basename run with this isolated snapshot. Current main owner has not cleared dirty overlap; no local branch commit yet.

Updated full-ext run: 4251 tests, 4244 pass, 7 fail; six fixture/timing assertions are being corrected, and one static prose-package phrase assertion is confirmed absent in the base commit as well. The next run should be focused on the remaining files, not another unrelated full sweep.

Final focused remaining regression check: folding/control-token tests pass after removing stale queued tails; lifecycle test now holds opening explicitly and checks SDK agent-start ordering relative to the foreground reservation rather than a later user-message persistence event. Base prose-package phrase mismatch is retained as an unrelated existing failure.
