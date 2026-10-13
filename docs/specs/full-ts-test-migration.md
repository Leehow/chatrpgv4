# Full TypeScript test migration and image-item release

## Approved outcome

On 2026-10-13 the owner requested continued Enhanced Items validation, repair of
related failures, canonical App packaging, and removal of pytest. The owner then
explicitly chose to migrate all remaining legacy cases to TypeScript before
removing pytest, rather than merely disconnecting the old suite.

Success means all original assertions, parameter sets, negative cases and boundary
responsibilities have a runnable TS counterpart. Test deletion, skipped conversion,
a Python interpreter behind a Node wrapper, and a smaller green suite are not
completion. Frozen Python oracle files and historical evidence remain unchanged.

## Ownership and scope

- Current source: `0.9.7a`, initially `c9df4d27b`, shared dirty checkout.
- Preserve concurrent output/reader/admission and NPC work. No push or shared-history changes.
- Prior fast migration is documented separately in `direct-ts-test-migration.md`;
  its 129-case result is not evidence for the complete migration.
- Image items are implemented in Enhanced Items 1.4.0. Relevant TS, UI, ownership,
  asynchronous replacement and instruction-budget checks passed in the prior turn.
- Canonical package is the real `/Applications/PipiCOC.app`, with the existing
  backlink and receipt under `~/leehow/code/pipicoc-build/`. Stable signing and
  staging cleanup are mandatory. The latest owner instruction requires full TS
  migration and validation, then pytest removal, then a real Enhanced Items table
  with Luna/high, repair of findings, and a fresh canonical App package in that order.
  The earlier image-item package is retained evidence, not completion of this order.
  If Luna reports saturated upstream concurrency, that table and its author/lanes
  fall back to Grok 4.5/low under the owner's latest instruction. Preserve the Luna
  failure and actual fallback model attribution; the next table still starts with Luna/high.
- The owner explicitly authorized three parallel migration agents on 2026-10-13.
  Their test-file ownership is disjoint (rules, NPC, world); the main agent owns
  setup/time/process/play support, the shared ledger, integration and acceptance.

## Execution

- [x] Inventory all remaining Python test functions, assertions and parameters.
- [x] Provide native TS RPC/disk/process fixtures with independent kernel processes.
- [x] Finish helper/fixture inventories and all process/transport boundary cases.
- [x] Migrate domain batches; maintain exact source-to-counterpart evidence.
- [x] Migrate process, storage, concurrency, driver and historical-contract cases.
- [x] Verify case/parameter/negative-assertion parity and representative mutations.
- [x] Replace integration/all/focused/remote routes with TS; remove pytest dependencies.
- [ ] Recheck Enhanced Items, including source/image custody and the player UI.
- [x] Run all supported TS regression gates, then remove pytest execution/dependencies.
- [ ] Run actual one-turn-at-a-time Enhanced Items acceptance with Luna/high.
- [ ] Repair findings, repeat affected validation, package and verify canonical App.

## Initial evidence and constraints

Initial file inventory: 150 `test_*.py` files, about 1,788 named test functions,
43,773 lines including helpers, with parametrization expanding the previous run
to over 2,100 cases. Some tests directly import the retired oracle and need
explicit compatibility evidence instead of restoring production Python.
The shared worktree also has active unrelated changes; a full run from the prior
turn included unrelated prescreen/admission failures. Attribute failures before
changing any production path.

## Current migration evidence

`tests/ts-migration-manifest.json` records source hashes and each assertion and
decorator. The full inventory also includes the four explicit storage-runner
tests outside the default pytest testpaths: 151 files, 1,792 functions and 8,383
assertion statements. At the 2026-10-13 integration checkpoint, more than 1,500 original functions have native,
individually executed counterparts. The exact current counts and assertion hashes are
reported by `node scripts/check-ts-migration.mjs`; changed counterparts require fresh
execution before re-entering the ledger. Parametrized source functions expand into their
original rows. This is still a partial migration until the complete ledger and full suite pass.

Completed groups include carrier editing, handouts, package lifecycle, all 44
Mod cases (including asynchronous identity and placeholder replacement), campaign
creation, notes/resume, published/legacy assets, graph playability, template
lookup, language packages, markup, last exchanges, table clocks, road publication,
and duplicated travel-time guards. New code is under `tests/integration/`.
`chargen-rpc.test.ts` preserves the two character-creation RPC cases. The existing
37 direct chargen functions and two mechanics-identity functions were reviewed
against their original assertions and parameter sets, verified by the 129-case
fast run, and included in the full ledger. Recovery and SAN-day cases now also
have their native RPC/disk counterparts, preserving the boundaries which the
fast arithmetic fixtures did not claim to cover.

`node scripts/test-integration-ts.mjs [files...]` runs the new tier and retains
JUnit plus its exit status under `.coc/test-runs/integration-ts-*/`.
`node scripts/check-ts-migration.mjs` checks ledger consistency; it does not claim
assertion equivalence. `--require-complete` deliberately fails until retirement is
fully done. Both source and counterpart hashes must remain current.

Recent evidence directories: `integration-ts-ptZ3HF` (10 graph/boundary cases),
`integration-ts-yA7dhO` (10 clocks/exchange cases), `integration-ts-x0SU5N` (11 road
cases), `integration-ts-Lom3TV` (9 spatial/rule cases), `integration-ts-s78TpP`
(15 inventory cases), `integration-ts-58paK7` (6 deferral cases),
`integration-ts-0zSxvz` (12 prefetch cases), `integration-ts-PcBWdU` (11 Mod combat
cases), and `integration-ts-fWfvaw` (2 chargen RPC cases). Each exited zero.
The original direct fast tier still passes 129 cases (`/tmp/enhanced-items-migration-fast.log`).
Further evidence: `integration-ts-lzSvsf` (12 real HP/MP recovery cases) and
`integration-ts-Akew4C` (6 real SAN-day cases), both exit 0. Typechecking all new
integration TypeScript files and `git diff --check` passed after the final batch.

Two migration mistakes were fixed without production changes: the Git helper now
reads the campaign's `.coc/repos/c1.git`, and the graph-digest expectation retains
JSON float spelling (`1.0` differs from `1`) instead of losing it in JS parsing.

## Image-item App delivery

No pytest entrypoint or dependency has been removed. Enhanced Items 1.4.0 was
packaged with `node pipicoc/package.mjs` (exit 0) into the real canonical App on
2026-10-13 at 04:53:41 UTC. The receipt remains at
`~/leehow/code/pipicoc-build/pipicoc-package.json`, source HEAD `c9df4d27b` plus
the current working-tree changes. Stable signature: `PipiUI Dev`, certificate
`108232C5A713C15A869FC4C267E18D2E35CD276C`. Deep strict signing verification passed.
LaunchServices and Spotlight both enumerate only `/Applications/PipiCOC.app` for
the product identifier; the backlink points there, and `.staging` is empty.

The installed package's own Node and RPC entry passed image acquisition, delayed
definition replacement with the original instance id, preserved image bytes,
read-only view, edit rejection and inventory projection. Evidence:
`.coc/test-runs/image-items-installed-i88w0C/` (`result.json` and raw exchanges).
This is installed-artifact verification, not live Keeper acceptance. The App was
restarted from the canonical path (PID 32432 at verification), restored its prior
idle session, and displayed the new paper/book inventory grouping. No player
campaign was edited for the verification and no live-play claim is made.

Remaining work is the full native integration migration, parity audit, native
driver/controller test coverage and replacement of all pytest execution and
dependency routes, followed by the full supported regression gate. Preserve the
older direct business tier; its presence alone does not prove those boundaries.

Native play tooling now includes driver, player, KPI, D6/Jev steps, persona metrics/report,
and a standalone quoted-citation judge tool. Unit fake-Pi transport runs remain benchmark
instrument validation, never a real Keeper table. A migrated Boolean assertion exposed a
brief budget overrun from omission metadata; §187.4 now includes that metadata in the fit.

## Full-gate checkpoint, 2026-10-13

All 1,792 originals now have native counterpart mappings. The ledger still needs a
successful current-snapshot full execution before it can authorize retirement;
counterpart type/arity/exception and rounding corrections invalidated older hashes.
Neither pytest routes nor dependencies have been removed.

The first amax native run (`run.0TB4DFAU`, 465 seconds) ran 2,080 expanded tests:
2,078 passed, one timeline DTO assertion failed, and the real historical KPI baseline
was skipped because its retained telemetry was absent on that box. The explicit
§235 timeline adaptation preserves every original field comparison and separately
checks the additive outcome schema and receipts; its complete file passed four tests.
The real Mac baseline telemetry was then transferred alone over LAN, with SHA-256
`ca4f2475b3f9c8cbbf20ff0f12488d30aaac6772d1532af5037cebddcc91fb5a`,
and all three baseline assertions executed. No baseline was synthesized.

The second amax native run (`run.aRCo7w66`, 465 seconds) ran 2,080 tests with zero
skips: 2,078 passed and two memory packet boundary assertions failed. A concurrently
owned §235 implementation added a raw canonical outcome to model-facing memory
packets; the original names-only and machine-key boundaries remain binding. Preserve
the failed evidence and the owner's live source edits; diagnose without overwriting
that implementation. Final integration waits for a current passing snapshot.

Enhanced Items revealed an actual published-source gap: handouts referring to an
image asset did not resolve the linked MIME/source. §234 now shares that resolver,
offers held region maps, and binds acquisition to the existing renderer's current
masked PNG and digest receipt. Six real RPC/bridge image tests, seven cache tests
and nine existing render tests passed, including distinct wrapper names and reviewed
second-print aliases. They are contract evidence, not a live Keeper table.

Final structural/parity audit (`.tmp/migration-final-audit.json`) covers 151 source
files, 1,792 functions, 8,383 assertion statements, 75 parametrized functions,
49 exception sites and five loop-else exhaustion branches. Original source hashes
match. Focused corrections restore exception classification/identity, exact binary64
rounding and approximate numeric assertions, player sandbox confinement, and Unix
socket length/UID/permission boundaries. Native integration and kernel type gates
pass (`/tmp/migration-*-final-typecheck-v3.log`); current-snapshot full execution is
still required for the remaining ledger refreshes.

The full amax routing-loop run (`run.509vbAED`, 378 seconds) ran 339 tests:
331 passed and eight failed. A minimal mounted-loop reproduction identified one
fixture protocol gap, `table.untold`; the real kernel already implements it. The
clean fake-kernel fixture now derives that read-only view from its actual state.
No original assertions or production code were changed; the four affected files
passed 32 tests. Retain the original failed log and diagnosis under
`.coc/test-runs/amax-loop-failure-509vbAED/`, then repeat the complete loop gate.

The memory failure independently reproduces through current native RPC. Actual
packets and exact leaked receipt/call/roll paths are retained in
`.coc/test-runs/memory-packet-diagnostic-FjPAri/` and
`.coc/test-runs/amax-memory-failure-aRCo7w66/`. The source owner is the active chat
`评估 KP 叙事与状态流程` (`01a1339b-1ce9-7b02-91c9-0c106d72b3ee`). Sending
these findings to that chat awaits the specific asynchronous human authorization;
do not infer it from the earlier three-agent migration permission.

Pytest route, selector and benchmark replacements are reviewable drafts under
`.tmp/pytest-retirement/`, with `.tmp/pytest-retirement/inventory.json` recording
dependencies, active mixed-directory fixtures and immutable audit sources. The
live benchmark scripts remain byte-identical to their pre-draft hashes. Apply
retirement only after the original full-gate prerequisite passes. All four App
runtime archives are cached and SHA-verified under
`~/Library/Caches/pipicoc-runtime/`; packaging can use explicit archive overrides
without any Internet download. Electron 44.0.0 arm64 is also cached.

The concurrent owner subsequently repaired the memory production path: legacy
records keep their original DTO and packet shapes; genuinely new event evidence
is projected by semantic names. The temporary legacy timeline outcome adaptation
was therefore removed rather than tolerated as an optional field. All original
complete DTO and whole-packet machine-ID guards now pass: memory 15, memory-laws
7 and recall 4, zero skips. Current proof is
`.tmp/npc-memory-legacy-revalidation.json`; failed and intermediate evidence remains.
The earlier message-send permission request is no longer needed and no message was
sent to the other chat.

The serial complete Electron baseline check (`electron-baseline-ujvG1R`, 472 seconds)
found exactly four additions to its 194 recorded failures, all in
`live-delivery-prose.test.ts`. Independent single-file reproduction confirms that
they still demand old §171 private-argument previews, superseded explicitly by
§233.11. Adapt only these host tests to verify zero private preview plus accepted
publication/retry/first-prose behavior. Keep the legacy streaming parser's explicit
test-only opt-in coverage. Do not restore production previews or add baseline rows.

## Full native and frontend evidence, with subsequent source drift

The third complete amax native run (`run.XD3mtfGd`, 454 seconds) passed all
2,090 tests with zero failures and zero skips. Its complete source SHA receipt,
JUnit, native/storage run records and 138 storage reports are retained under
`.coc/test-runs/amax-native-XD3mtfGd/`. At receipt integration, all 1,410 source
identities and the current path set matched. Independent original decorator and
fixture-matrix counting matched 1,753 original native functions to all 2,076
expanded JUnit cases, including 68 parameterized functions. Fourteen additional
native cases are recorded separately. The 39 extension counterparts retain their
independent fast proof; they do not inherit the native run result. Original
source hashes remain unchanged. Coverage evidence and the reproducible verifier
are `coverage-verification.json` in that directory and
`.tmp/verify-native-full.mjs`. The 193 pending counterpart entries were refreshed;
the ledger deliberately remains `complete: false`.

The repeated serial full Electron gate (`electron-baseline-rLZjHi`, 461 seconds)
matches all 194 recorded failures exactly, with zero additions and zero removed
baseline entries. Its `result.json`, `observed.json` and source SHA receipt are
retained under `.coc/test-runs/electron-baseline-rLZjHi/`; the runner output is
`/tmp/migration-electron-baseline-serial-v2.log`. This is a baseline match, not a
claim that the 194 existing failures are fixed.

After the native proof, the concurrent production owner changed
`kernel-ts/turn-events.ts` and `kernel-ts/write/index.ts`. An independent repeat
comparison found exactly these two changed byte identities; the other 1,408
recorded files, including every native test and helper, still match. The full
native result therefore proves its recorded snapshot and does not certify those
later production edits. Exact prior/current SHA values and the affected event,
ask/narrate, memory and NPC consumer routes are recorded in
`.coc/test-runs/amax-native-XD3mtfGd/post-run-drift.json`. Do not overwrite the
production owner's paths or convert this into completion. Current-source
regression gates, pytest retirement, real Luna/high acceptance and canonical
packaging remain pending.

Read-only fixture verification confirms that `support.kernel(t)` and the native
NPC/world adapters launch fresh real RPC subprocesses. Native helpers do not read
`COC_TEST_KERNEL_POOL`; pooling is exercised only by the explicit
`kernel-pool.test.ts` equivalence/teardown cases. Hybrid fixture storage does not
imply kernel-process pooling. The post-drift focused `world-narrate.test.ts` run
passed nine tests (`.tmp/native-after-drift-narrate.log`), covering legacy write
projection, ask/narrate closure and replay. This is bounded regression evidence,
not coverage of every new semantic-event branch or a current full native gate.

## Complete migration and actual pytest retirement

All 1,792 original functions and 8,383 assertion statements now have validated native counterparts; manifest complete is true. The final native snapshot passed 2,094 tests, the full loop gate passed 339, and the independently paired extension snapshot passed 5,834 with one pre-existing opt-in skip. The frontend gate exactly matches its 194 recorded failures. Later five guidance-only hunks were reviewed separately and checked with focused current-source gates; evidence is not presented as one byte-identical snapshot.

Pytest and xdist plus their exclusive dependencies were removed with offline uv lock/sync. Nineteen old controllers were preserved under .tmp/pytest-retirement/removed-controllers, while all 151 immutable original test files remain for assertion auditing. Integration/all/focused and both remote namespaces now execute native TS and reject the retired py route for this repository. Post-retirement local fast gate passes 130 tests and the selector/tier/retirement guards pass 28. The supported remote native route is being rechecked before live acceptance.

Earlier partial checkpoints above are historical; they are superseded by this completion record, not rewritten. Real Luna/high acceptance and fresh canonical packaging remain pending.

Post-retirement supported amax native route run.OmCwdgHt passed 2,094/2,094 in 446 seconds, zero failures/skips; raw proof retained at .coc/test-runs/amax-native-retired-OmCwdgHt/. Subsequent live-driver child-close wake/final-totals repair passed 98 original driver tests on amax and a real-child stop regression. Uniform actual HTTP lane effort plus BUILD worker profile tests pass 14 local cases. Actual Luna requests returned relay 503 upstream concurrency saturated three times; retained enhanced-image-items-20261013-luna-v2 is capacity evidence, not successful gameplay. Grok 4.5/low fallback now starts on the same isolated campaign; ordinary product defaults remain unchanged.

Live image checkpoint: eight genuine delivered turns progressed from the commission to the house. The self-drawn sketch was correctly a text paper carrier and is not image acceptance. A real PNG handout was revealed in turn 8. In turn 9, explicit player reference collection failed because the Keeper proposed an unchosen physical-paper object; admission correctly refused that addition. Clarify the existing Mod writer/creator reference basis under §234, preserve the gate and immutable image source, upgrade by a new Mod version, then repeat the actual player collection. A raw output-protocol answer in turn 6 remains marked invalid for narrative acceptance, not normalized into success. Desktop inspection still awaits manual Mac unlock.

The owner approved the concrete image-reference collection extension: nonphysical
player reference maps/pictured handouts also belong in the backpack. Implementation
follows §234.1 and .tmp/image-reference-collection-proposal.md: host-only explicit
selection, stable asynchronous sidecar references, existing image authority gates,
no fictional objects or permissive interaction-scope override. This supersedes the
failed idea of using define/object for pure reference-scope requests. Physical
image carriers continue through the existing Mod path. Canonical packaging follows
integrated collection validation and actual desktop acceptance when unlocked.

### Reference collection implementation checkpoint (2026-10-13)

Owner-approved host reference collection is §234.1. Enhanced Items 1.4.2 declares `objects.image-references.v1`; collection uses campaign sidecar ownership, queued asynchronous completion, and Maps/Images UI controls. The invalid supplemental 1.4.1 define/object reference experiment was replaced by a host-routing regression; all six original physical image tests remain, and all seven cases pass. Real native reference authority and host/UI tests are in progress. CUA still reports the Mac locked, so desktop acceptance awaits manual unlock and is not claimed.

The narrowed host boundary follows [Electron IPC security](https://www.electronjs.org/docs/latest/tutorial/security#17-validate-the-sender-of-all-ipc-messages): session binding and validated parameters stay host-owned. Stable retries follow [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests), with campaign-local source/view/category identity instead of a caller-supplied payment key; collection retains immutable source pins and explicit refusal rather than reauthoring content.

Final reference collection integration checkpoint: physical image tests 7/7, reference kernel authority 9/9, bound host routing 6/6, and real-pack UI regressions 63/63 pass. Kernel/integration/backend strict type checks and Electron build/preload verification pass. Independent read-only authority review found no blocking defect. Current-only RPC method registration was extended for collect/references/reference_finish without changing the frozen Python oracle. Final amax all run.vEs9BdcE is in progress against frozen task sources. The actual installed App still predates this collection implementation; no fresh package or desktop success is claimed while the Mac is locked and the old App remains running.

Final integrated all run.vEs9BdcE discovered four EXT failures, retained as failure evidence: new Enhanced Items version/digest was absent from the existing preset lock expectation; the added Mod instructions put shipped whole instructions 221 characters above the existing 65,536 budget; queue recovery joined an absent minimal runtime home; the old map viewport static test included the separate collection control. Current-version expectations now pin independently hashed 1.4.2 bytes while retaining frozen 1.2.2 assertions. Only new image/reference instructions were shortened, leaving total 65,516 with unchanged budget. Missing runtime home suppresses recovery rather than throwing, without relaxing collection authority. Viewport tests retain zoom/pan assertions and prove zero actual bound host callbacks, then positively check the separate collection selection callback. Repairs pass focused tests and will be checked by a fresh integrated all invocation.

An independent bounded native audit also verified the actual public-source shape: map shown first and linked raster handout later remain one known source; public title, issued handout and semantic map handle all return the same collection id. Source authority was not broadened. The corrected integrated all run.y3c0KbFh has completed all 658 EXT files without nonzero file results and is finishing native integration; final success still awaits actual exit status.

Corrected integrated amax all run.y3c0KbFh completed with actual exit 0 in 971 seconds: EXT 5,888 cases, 5,887 passed, zero failed, one existing opt-in skip; native integration 2,094/2,094 zero failures/skips; additional routing 12/12. Raw logs/source hashes/results retained at .coc/test-runs/amax-all-reference-y3c0KbFh/. The current-only method list and four discovered seams are included. A refreshed compiled runtime will be fetched from amax before the serial Electron baseline comparison; interrupted parallel/pre-fetch attempts do not establish a baseline.

The all-run source pairing rechecked 1,400 captured files against the local owning source: zero missing or changed files (.coc/test-runs/reference-items-integration-20261013/all-source-review.json). Refreshed runtime build/fetch run.BsR30EJN passed exit 0 and transferred 60 MB directly over the LAN. The fresh serial vendored Electron baseline check is in progress against this compiled runtime. Canonical staging remains empty. The latest CUA check still says the Mac is locked and requires manual unlock; the running old canonical App has not been replaced.

Fresh compiled-runtime Electron serial full suite completed: 195 failures, the 194 unchanged known baseline members plus one new panel-fixture last-call mismatch. The fixture had consumed its next sheet response for the new reference read; it now dispatches by method and independently checks both sheet refreshes and both references. All original passport/era/art/refresh assertions remain. Only Electron/packages/ui/src/coc-panel.test.tsx changed; production files and the failure baseline are unchanged. Panel file 55/55 and reference UI 8/8 pass. The original baseline checker confirmed the differing file after this test-only repair: 194 retained known failures, zero new failures and zero fixed entries, exit 0. Evidence: .coc/test-runs/reference-items-integration-20261013/electron-baseline-final-confirmed.json and reference-items-ui-20261013/panel-after-fix.log.

All independent code/test/build gates are complete. Canonical App installation and actual desktop collection/backpack/restart inspection remain pending: CUA still reports the Mac locked, and old canonical App PID 9646 is running. Manual unlock/quit was requested; no reply establishing that condition has arrived. No second bundle or temporary App was installed, canonical staging is empty, and the old App remains intact.

The owner subsequently confirmed manual unlock and quitting the old App. The coordinated streaming acceptance task installed the current canonical stable-signed package (receipt 2026-10-13T11:44:24.734Z), including Enhanced Items 1.4.2, and currently holds exclusive App control. Root must wait for its handoff before image collection UI acceptance. A separate packaged native runtime probe exits 0 and confirms all three reference RPC routes; this is package evidence, not live gameplay. Current source focused checks pass physical images 7/7, reference authority 9/9 and actual UI regressions 74/74. The earlier full all result remains paired with its captured source snapshot; later streaming changes await their owner's final full run. Updated evidence is reference-items-integration-20261013/checkpoint.json, packaged-runtime-probe.json and current-image-reference-QLF684/.

Native desktop collection acceptance now passes on the canonical package installed at 11:51 UTC. A fresh Luna/high attempt retained four actual upstream 503 saturation errors, so the authorized Grok 4.5/low fallback continued the same real campaign. The normal Pi session was persisted into an App-created session by the transport launcher; no dialogue, world state or binding entries were synthesized. In that session, native UI saved the already-public Corbitt map as both a picture handout and a map, showed asynchronous saving, displayed distinct backpack groups, opened only read-only images and retained both references after normal App restart. The two immutable assets match their recorded digest. Evidence: .coc/test-runs/reference-items-desktop-20261013/result.json and three native screenshots. One actual UI defect was found: missing sheet.nameKey in collection owner labels. Both collectors now reuse existing sheet.identityTitle; two new assertions fail before and the 74-case UI group passes after the repair. Final packaging is coordinated with the streaming owner, who has the App lease again; the two label-line fixes must be included. An unrelated old-package delivery footer mismatch was reported to that owner and is not silently counted as narrative acceptance.
