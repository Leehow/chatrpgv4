# Single-pass narration

Status: implementation, fixture migration, focused live verification and source integration complete. Packaging is outside this task's scope.

## Approved objective

Deliver the Keeper's first completed draft directly. No automatic prose review, rejection/rewrite loop, post-delivery verifier, or NPC wording edit. Keep rule arithmetic, action admission, transactional replay, actual preparation and commit integrity. Provider failure recovery and installation/package changes are outside the approved implementation scope. Owner approved this policy in this chat on 2026-10-01; the current test Keeper is explicitly Flapcode GPT-6 Luna, low.

## Ownership and source

- Integration branch: `codex/single-pass-narration-20261001`, created from `15a4a48be` through the required lifecycle CLI.
- Checkout: `/Users/haoli/.codex/worktrees/single-pass-narration/chatrpgv4-wt-pi-coc-v2`.
- LAN script alias: `/Users/haoli/.codex/worktrees/single-pass-narration/source-single-pass-narration`. Its unique basename avoids another Codex run overwriting the remote scratch checkout.
- Main `0.9.6a` received the implementation and integration commits through `62b76de55`. The other owner's `5903a311f` work was committed before integration. The two conflicts preserve the new context-aware dispatcher and nonblocking historical-review watch while keeping automatic prose review disabled. No inter-chat message was sent.

## Implemented

Contract section 166 and a fixed shared policy in `kernel-ts/runtime/narration-policy.ts`. All four delivery paths skip automatic prose review and repair. Mod definition preparation for actual apply/resolve remains. Deterministic rendering remains. Kernel prose-only refusal gates become advisory; actual state effects remain guarded. Keeper prompt asks for one completed draft from current facts.

## Evidence

- Focused extension tests for all delivery paths, active task guards, transaction replay, explicit/implicit hybrid close, markup, speaker attribution, memory extraction and disabled editing pass. Keep exact results in current tool logs; major contract migrations now pass focused checks: 25 core delivery/hybrid-close checks, 22 Python RPC checks, 18 admission checks, 14 line-admission/cost checks, 13 canonical dispatcher checks, 17 host-state/adaptation checks, 29 turn checks, 15 memory/lane checks, 14 speech attribution checks, 9 owed-position checks, 4 settled-card checks, 3 resend checks, 3 disabled-edit checks. Remaining complete-snapshot validation is not yet green.
- LAN focused Python: `test_markup_in_prose.py`, `test_narrate.py`, `test_npc_intents_done.py`: 22 passed, 2026-10-02.
- Genuine driver run `single-pass-flapcode-20261002` retained in the primary checkout's `.coc/playtests` and `.coc/campaigns`: 3 delivered turns, 1 narration per turn, 0 prose reviews, 0 rewrite steers, 0 unfinished notices. Provider/model confirmed from actual events: `flapcode/gpt-6-luna`; same plugin bytes as installed App. This is focused live verification, not full-scenario or packaged-App acceptance.
- The isolated test launcher reads the existing encrypted App vault in memory and loads the actual plugin. It contains no secret values. Its historical source and retained offline regression evidence are copied to the primary `.coc/playtests/single-pass-source-evidence-20261002` before disposing of the checkout. Set `PI_COC_HOME` to the primary checkout when using its driver; otherwise pregens and the source launcher use different homes. Do not expose credential values.
- Two earlier runs are marked invalid-for-intent/acceptance and retained; wrong relay and home must not be counted as live proof.

## Integration and closeout

Main received the source by fast-forward, remained clean, and received the LAN-built runtime from the same production source at `62b76de55` (build exit 0). The nine first-draft tests passed again on the primary checkout with those compiled artifacts. The final documentation update changes no runtime code. The disposable checkout's terminal classification is maintained by the required lifecycle CLI's manifest and audit. Genuine evidence and the retained offline evidence remain in the primary checkout. No push or App install was performed.

Implementation commit: `f1e08f93c`. Old automatic-review expectations were retired or replaced by first-draft assertions. Unused post-terminal faux responses were removed so they cannot become the next turn's first draft; independent mechanics assertions remain. Historical inspection/helper and source-authoring tests remain.

Full ext snapshot before the final fixture corrections: 4251 tests, 4244 passed, 7 failed, exit 1. Six failures were stale fixture/timing assertions and now pass focused checks; one `keeper-prose-contract.test.mjs` phrase assertion is confirmed absent in the base commit `15a4a48be` as well. The unrelated prose-package mismatch remains reported rather than changing its content to make the suite green. Log: `/tmp/single-pass-full-ext-v2.log`. The older interrupted snapshot (`/tmp/single-pass-full-ext.log`) is superseded and is not green evidence.

After merging main into the owned checkout: `check:kernel`, `git diff --check`, 50 focused first-draft/canonical-dispatcher/lifecycle/folding/control-token/post-delivery checks, 58 admission/owed-watch/task-guard checks and 9 system-language/disabled-edit checks passed. The LAN runtime build and 296 loop checks passed at `b941fa6ba` (exit 0, 204 s). No production code changed after those checks. The Flapcode driver is stopped; genuine campaign evidence remains in the primary checkout. Packaging and installed-App acceptance are separate and were not performed.
