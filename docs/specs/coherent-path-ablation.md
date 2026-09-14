# Coherent offers and bounded runtime protocols

Status: implemented and automatically verified on 2026-09-14. Final scoped commit closeout is tracked by the published plan; genuine-play and installed-package acceptance remain out of scope.

Plan id: `coherent-path-ablation`

Baseline: `0.9.3a` at `96b70a4d2` (2026-09-14). The uncommitted change to `docs/pi-host-contract.md` is external to this work and must remain untouched.

## Problem Statement

The first simplification pass already consolidated lane scheduling, product identity, launcher mounts and turn delivery. Repeating those refactors would not address the remaining failures.

Two current-source probes exposed incorrect offer behavior: filling the three suggestion slots can bypass the rule that a previous consequence keeps a seat; ticking one of two clocks on the same threat produces two anonymous `pressure:` adoption entries. Other remaining duplication is in capsule projection and the presenter file protocol, not in the number of game capabilities.

Packaging has a separate ownership gap. The canonical App packager cleans its outer stage, but the runtime assembler leaves its own heavy workspace when called directly. The canonical receipt also names evidence inside a stage that is subsequently removed. App version metadata is hand-authored separately, and an obsolete product packager remains a misleading executable entry. The inherited packaging suite fails during collection and therefore does not test the current PipiCOC recipe.

Success means fewer independently maintained sources/protocols while preserving behavior. Fewer files, fewer lines, unchanged source-regex tests, or merging distinct agents are not success criteria.

## Solution

1. Preserve consequence selection and carry exact clock targets through offer generation and adoption, without interpreting display text.
2. Project unanswered rule continuations once in the base capsule, retaining the Director's ability to select one from that canonical projection.
3. Make runtime assembly own cleanup of its heavy working resources on every catchable exit, preserving only the requested successful output and small diagnostics.
4. Derive the App version from the root package manifest, seal the obsolete product entry and replace dead packaging assertions with executable tests of the current recipe.
5. Share the presenters' two-round file-attempt protocol, while retaining their different prompts, validators, caches, partial-success rules and concurrency behavior.

No new Keeper verb, model call, semantic classifier, language table or production backend is introduced.

## User Stories

1. As a player, I want the material given to the Keeper to retain the previous consequence even when several new suggestions are available.
2. As a maintainer, I want one clock tick attributed to exactly the clock that moved, so adoption diagnostics are trustworthy.
3. As a maintainer, I want changing or clipping display text to leave target matching unchanged.
4. As a player, I want an unanswered rule continuation represented consistently rather than duplicated as two different base obligations.
5. As a player, I want basic threat information to remain available when a pacing Mod is disabled.
6. As a developer, I want direct runtime assembly and App packaging to clean their own temporary resources on success, failure and supported interruption.
7. As a developer, I want retained failure diagnostics without retaining another Node installation, dependency closure, archive cache or App backup.
8. As a developer, I want the package receipt's evidence reference to remain readable after staging cleanup.
9. As a user, I want App version metadata to come from one maintained source rather than a separate literal.
10. As a developer, I want an obsolete product packager to refuse before any build, download or output creation, and identify the supported command.
11. As a maintainer, I want current packaging tests to execute the recipe's behavior rather than validate obsolete PipiUI files or particular source formatting.
12. As a player, I want UI, map, character and document projections to retain their existing language, cache, retry and cancellation behavior after their mechanical protocol is shared.

## Implementation Decisions

### A. Offer selection and exact targets

- Keep the existing beat orders, four offer kinds, three-row cap, line clipping and capsule-budget behavior. Do not return from the first selection pass before applying the consequence-seat rule. The guarantee applies to candidate selection; the separately documented overall capsule budget remains unchanged.
- Add an optional structured `target` to actionable pressure offer rows. Its bounded shape is `{threat: string, clock: string}`. Values are existing readable graph names/clock names, never model-copied receipt ids or new opaque identifiers.
- The source pressure projection writes this target from graph/world data. Offer generation carries it unchanged. Adoption reads it and matches both dimensions against canonical threat receipts using existing name-normalization semantics, never `line.startsWith`, text parsing or prefix equality.
- A selected clock's adoption key is `pressure:<threat>/<clock>`. Each selected target is recorded at most once. Unrelated clocks, common-prefix names and repeated receipts must not create extra adoption entries.
- Existing `who` and `where` continue to identify person and route offers. Do not introduce a generic entity registry or rewrite those protocols.
- Share the narrow clock-target matching/key construction used by selected-offer adoption and the all-material clock ledger. Preserve the ledgers' distinct scopes and existing `clock:` versus `pressure:` namespaces: all available material is not the same thing as the Director's selected subset.
- Historical records are immutable. A historical/open capsule without a structured clock target remains readable and does not fail turn closure; do not reconstruct a target from its prose or falsely mark it taken. No save migration or history rewrite is needed.
- Three ends: graph/world projections produce the target; the capsule and adoption logic read it; the Keeper still acts through ordinary `apply threat` receipts. Telemetry remains counting-only and never feeds obligations, prioritization or quotas back into the next capsule.

### B. One base continuation projection

- `obligations[kind=continuation]` is the single base projection of an unanswered rule continuation, preserving `name`, `who`, `state` and `cue`.
- Remove the duplicate `pressures[kind=rule]` projection and its obsolete construction branch. Keep physical/rule-derived clocks and basic threat rows in pressures.
- The Director may still select a continuation as a pressure-kind offer, reading it from the canonical obligations collection and labeling its source `obligations`. This selected summary is not a second independently constructed base projection.
- Preserve current continuation detection, `source_receipt`/`continued_by` handling, pending choices, player authorization and budgets. Do not change push/luck behavior or automatically ask the player to use either.
- Keep basic threat projection independent of optional pacing/thread Mods; do not move core duties into a disabled-able package. Do not remove quest obligations in this change.

### C. Assembly ownership and diagnostics

- The runtime assembler owns the heavy workspace it creates; the App packager owns its outer stage. Both imported and direct-CLI routes obey the same resource lifetime.
- On success, exception, SIGINT, SIGTERM and SIGHUP: stop/settle only this operation's spawned children before cleanup, restore permissions on owned read-only resources, then remove heavy temporary directories. Do not promise cleanup after SIGKILL, power loss or an OS crash.
- Successful explicit output is retained. A pre-existing output is rejected without modification. Failed task-owned partial output is not left as an apparently valid result.
- Preserve small diagnostic JSON and known text logs in a run-owned diagnostics directory under the repository's existing `.build.noindex` root, outside the disposable stage. Retained files are capped at 256 KiB each with truncation recorded. Do not recursively copy the workspace: no dependency directory, archive, native binary, toolchain or bundle belongs in diagnostics.
- The successful `evidence` return value and App receipt's `assemblyEvidence` point to those durable small diagnostics, not to the deleted workspace. Existing historical receipts are not rewritten.
- The failure path preserves diagnostics too; retaining the full heavy workspace on ordinary failure is explicitly rejected. No new retain-heavy-work option is introduced. If the OS does not allow confirmation that owned processes have stopped after the bounded TERM/KILL waits, report `cleanupBlocked` and do not delete their still-active paths. The outer owner must honor that failure: neither an unresolved stop timeout nor failed cleanup is reported as success. This is an explicit inability to clean safely, not a retention mode.
- Preserve the single canonical App path, its back-link, running-App guard, resource integrity checks, signing order and rollback safety. This work does not install, sign, launch, restart or package an actual App as a verification step.
- All `.coc` campaign/module/playtest evidence is outside this cleanup ownership and remains untouched.

### D. Product version, obsolete entry and current tests

- The root package manifest's `version` is the only App version source. Its current value is `2.0.0-alpha.0`; this work does not change that value, infer a version from the `0.9.3a` branch or reuse the extension manifest's separate version.
- Keep the product identity manifest free of a second version field.
- Make current builder configuration available through a small pure recipe function. The executable packager consumes that same function; tests inspect returned configuration, not a parallel test-only recipe or source regex.
- Seal the obsolete product-packaging entry before parsing/building/staging/spawning. A direct invocation fails nonzero with the supported `node pipicoc/package.mjs` route. Remove its unreachable product-assembly body rather than adding a permanent guard above dead implementation.
- Do not delete shared Electron build/dev code or the entire inherited runtime toolchain. Lower-level vendored tooling and non-COC platforms are not a new cleanup project.
- Replace the obsolete packaging suite's current-product responsibilities with executable tests against the PipiCOC recipe and owned-resource lifecycle. Retire assertions about absent PipiUI release scripts, Hermes packaging and unsupported product identities. Preserve applicable resource/external-module/signing-boundary checks rather than deleting them merely to make a suite green.
- Keep the suite file runnable for existing test entry lists where practical; do not blanket-skip it. Update explicit references if tests move. Regenerate the failure baseline only with its record command, inspect the result and accept removals only. Never add an entry to mask a new failure.

### E. Shared presenter attempt protocol

- The existing owner-provided tool-enabled runner remains authoritative for process execution. Do not add a new spawn backend.
- Extract only the repeated file-attempt mechanics: attempt/check setup, a maximum of two runner rounds, event-log names, reading an output, and writing validation findings for another round.
- The shared helper receives the caller's attempt path, prompt/check content, runner/signal, and bounded per-round callbacks for preparing input and accepting or rejecting output. It does not select a language, task, model, cache key or concurrency policy.
- Common execution retains the existing 120-second per-round deadline. Preserve each caller's error codes and failure-detail text; a helper must not collapse cancellation and provider failure.
- The helper is first exercised through UI and map projection, then the character and document paths migrate to the same proven contract. A helper-only slice with no production consumer is not accepted.
- Cache writes remain caller-owned. Reuse an existing atomic-write helper if suitable, but do not create a cache framework or force a common commit point.

The following differences are binding, not cleanup opportunities:

| Behavior | UI | Map | Character | Document |
| --- | --- | --- | --- | --- |
| Partial result | Accept within attempt; persist only when complete | Preserve accepted words even when remaining words fail | Merge accepted vocabulary per round; preserve finance/equipment separation | Validate and accept a whole reading only |
| Cache identity | Existing language/content/instruction digest | Existing growing dictionary digest | Existing vocabulary and equipment keys | Existing request-plus-instructions fingerprint |
| Single-flight | No new policy | No new policy | No new policy | Preserve owner-scoped pending map |
| Model bypass | Authored language and seed/cache hits | Existing cache/empty-input bypass | Existing known-label and cache bypass | Existing cache and player-edited behavior |
| Artifacts | Existing packet/output names | Existing packet/output names | Existing per-round output and vocabulary artifacts | Existing request/result/run logs |

Prompts, validators, output schemas, placeholder checks, model/thinking propagation, language openness and retained attempt evidence do not change.

## Testing Decisions

Use the highest existing seam that proves each behavior; these domains do not share one meaningful test seam.

1. **Offers and continuations:** current TS RPC/capsule/closed-turn tests plus narrow pure-function matrices for all beat orders. Cover crowded offer pools, no consequence, failed dice excluded, multiple clocks on one threat, common-prefix names, repeated receipts, clipped/changed display lines, target-less historical capsules, both `ask` and `narrate`, Mods disabled and continuation answered/unanswered. Check both telemetry layers without conflating them.
2. **Assembly ownership:** deterministic temporary-filesystem and isolated child-process tests with injected/stubbed assembly work. Cover success, thrown failure, SIGINT/SIGTERM/SIGHUP, read-only directories, existing-output rejection, child termination before cleanup, preserved successful output and readable small diagnostics. No real downloads, dependency installation, codesign or `/Applications` write.
3. **Packaging recipe:** execute the same pure configuration builder used by production, asserting canonical identity, root version, resource allow-list, exclusion of old embedded runtimes and current output/back-link policy. Execute the sealed legacy entry in a child process and prove refusal happens without creating output or spawning packaging work.
4. **Presenters:** use existing injected fake-runner tests, not real model calls. Cover no-call cache/seed hits, two-round success and exhaustion, each partial-write policy, malformed JSON, validation failure, abort/error identity, document single-flight and unchanged cache keys/artifact names.
5. **Integration:** kernel typecheck, emitted runtime build, complete extension suite, serialized kernel/play pytest suite and Electron baseline comparison. New failures are regressions to diagnose; frozen Python oracle/cache and baseline expectations may not be altered to manufacture compatibility.
6. **Review:** cold code review of each landed slice before a dependent builds on it, and a whole-diff review against this specification before closeout. Review and independent executable checks run in parallel.

The earlier read-only evidence is not implementation verification: two in-memory current-source probes exposed the offer defects; the existing product-source tests passed 4/4 without covering them or the packaging lifecycle. No genuine-play or real package acceptance has been performed for this spec. Deterministic regression success will not be reported as genuine-play or measured latency improvement.

## Tracer-bullet Tickets

Tickets are represented by the published runtime plan, with these stable ids. No external issues are created by this specification.

### 1. `offer-sources` — coherent offer selection, attribution and continuation projection

Blocked by: none.

Deliver: both reproduced offer defects fixed and one base continuation projection, through the real capsule/close-turn seam. The lead owns all shared kernel-contract updates before other business-code slices begin.

Acceptance:
- Crowded selection preserves a previous consequence without changing row/budget limits.
- One exact clock tick cannot mark another clock taken; no anonymous/duplicate pressure adoption keys.
- Display-text changes cannot affect adoption, and target-less historical capsules still close safely.
- The all-material ledger and selected-offer adoption retain their different scopes.
- Continuations appear once in the base capsule and remain selectable from obligations; basic threats survive disabled Mods.
- Relevant kernel/RPC tests and typecheck pass without oracle changes.

### 2. `assembly-lifetime` — bounded assembly resources and durable diagnostics

Blocked by: none, after the lead publishes the shared contract decisions.

Deliver: imported and direct runtime assembly clean heavy work on supported exits while retaining successful output and small readable evidence; the App receipt no longer points into deleted staging.

Acceptance:
- Filesystem/subprocess tests cover success, exception, signals, read-only cleanup and owned-child shutdown.
- Heavy working directories and failed partial output are gone; prior output and all play evidence remain untouched.
- The success receipt and failure diagnostic reference remain readable after cleanup.
- No real packaging, installation or host-process restart is executed.

### 3. `package-contract` — one product recipe, version source and supported entry

Blocked by: `assembly-lifetime` (the executable packaging tests must use the settled lifecycle/evidence contract).

Deliver: the actual packager consumes an import-safe configuration recipe; its App version comes from the root manifest; the obsolete entry refuses without side effects; inherited packaging coverage is replaced by current executable behavior checks.

Acceptance:
- Configuration behavior tests pass and no test-only recipe/source-format assertion substitutes for them.
- Identity, resource closure boundaries, default App path/back-link and existing applicable package safety checks remain covered.
- Legacy entry refusal is executed and creates no package/stage.
- The packaging suite loads and runs; baseline recording removes obsolete failures only.
- Build/dev tooling remains available; root/extension versions are not bumped.

### 4. `presenter-attempt` — shared attempt protocol with UI and map consumers

Blocked by: none, after the lead publishes the shared contract decisions.

Deliver: UI and map projections use one bounded attempt helper, preserving their intentionally different partial-success/cache behavior.

Acceptance:
- Existing UI/map/word tests pass alongside explicit retry, cancellation and partial-cache regression cases.
- Authored-language, seed and cache hits still avoid runner calls.
- The shared helper owns no language, cache-key, single-flight or model-selection policy.

### 5. `presenter-migrate` — character and document consumers on the same protocol

Blocked by: `presenter-attempt`.

Deliver: remaining character/document attempt loops use the landed helper, without introducing a second helper or changing their data and concurrency contracts.

Acceptance:
- Character vocabulary persists at its original per-round points; finance/equipment behavior stays separate.
- Document whole-result validation, owner-scoped single-flight and fingerprint cache remain intact.
- Existing character/document tests and the combined presenter regression set pass.
- The four production callers use the shared mechanics without leaving unused duplicate attempt loops.

### 6. `integration-closeout` — integrate, review, verify and commit

Blocked by: `offer-sources`, `assembly-lifetime`, `package-contract`, `presenter-attempt`, `presenter-migrate`.

Deliver: accepted slices on the latest development line, full relevant integration evidence, cold whole-diff review and a scoped secretary commit.

Acceptance:
- Shared contract and implementation agree; only authorized paths changed.
- Typecheck, runtime build, extension suite, one kernel/play pytest at a time and Electron baseline comparison have real exit results.
- All review findings have final dispositions; baseline changes are generated removals only.
- External dirty files and all campaign/module/playtest evidence remain untouched.
- No related worker remains live; final commit and verification limits are reported truthfully.

## Out of Scope

- Repeating the already landed queue/product/mount/delivery simplification.
- Merging memory and NPC journal model tasks, deleting their responsibilities, or moving deferred registration scheduling.
- Removing admission, source/continuity audit or verifier duties; changing fail-closed authorization behavior.
- Replacing tool-enabled presenters/readers with bare completion or a language lookup table.
- Deleting basic threats, quest obligations, game rule families or optional-Mod semantics.
- Restoring Python, modifying frozen oracle behavior, rewriting history, or deleting `.coc` evidence.
- A generic process/cache/build framework, broad vendored-Electron cleanup, or a new telemetry feedback controller.
- Actual App packaging/install/release/signing/notarization, host restart, genuine-play acceptance, or latency/quality claims without measurements.

## Further Notes

Implementation anchors (navigation, not additional scope):
- Kernel: `kernel-ts/read/offer.ts`, `read/assemble.ts`, `read/pressures.ts`, `write/text.ts`; contract sections 13, 31 and 34; `tests/kernel/test_turn_floor.py`, `test_mod_director_text.py`, capsule/rules-family tests.
- Packaging: `scripts/package-runtime.mjs`, `pipicoc/package.mjs`, `Electron/scripts/package-product.mjs`, `Electron/apps/electron/packaging-contract.test.ts`, `tests/extension/product-source.test.mjs`; contract sections 23 and 27.
- Presenters: `extensions/module/{ui-presentation,map-presentation,character-presentation}.ts`, `extensions/mods/document-presentation.ts`; existing UI/map/character/document projection tests.
- Read-only reports: `.pi/findings/audit-kernel.md`, `audit-product.md`, `audit-lanes.md`, `spec-packaging.md`, `spec-presenters.md`. Their proposals are advisory: this specification explicitly rejects merging agents, retaining heavy failure workspaces, replacing behavior tests with source regex, and deleting base threats in favor of optional pacing.

The lead holds the shared contract and kernel mainline. Packaging and presenter slices are sidecars. Dependent slices start only after the predecessor's executable checks and cold review are accepted. Worktree briefs must use the absolute path to this spec and the lead-owned contract snapshot so uncommitted shared decisions are not silently lost.

## Implementation and Verification Record (2026-09-14)

All five implementation slices and their independent reviews are complete. The final whole-goal review found no blocking integration defect. The shared contract amendments are present in current mainline; unrelated concurrent work was preserved.

| Check | Actual final result |
| --- | --- |
| Kernel strict typecheck | `npm run check:kernel` passed |
| Emitted runtime and Electron test prerequisites | `npm run build:runtime` and the `pretest:electron` build chain passed |
| Kernel and play-controller regression | `uv run --frozen python -m pytest tests/kernel tests/play -q`: 1273 passed, exit 0, 1684.41 seconds |
| Kernel verification inputs | 557 recorded files unchanged across the final run; checked again after Electron prerequisite builds with no differences |
| Extension regression | `npm run test:ext`: 1114 passed, 0 failed, exit 0 |
| Current packaging contract | The formerly uncollectable suite now runs 16 tests, all passing, without skips |
| Vendored Electron baseline | Generated with `--record`: 195 to 194 inherited failures, only the obsolete packaging-suite collection failure removed; no added failures or flaky exemptions |
| Electron regression check | `npm run test:electron` exited 0 and reported 194 known failures, 0 flaky exemptions, nothing new |

Pre-final failures were retained and addressed rather than hidden. The first kernel run still had the old assertion requiring duplicate continuation projections; it was changed to assert the canonical obligation, its state/cue and removal after a real pushed-roll resolution. The first full extension run found a remote-control test reading the old packager's source text; it now executes the same pure recipe as production and checks the exact browser resource. Both full suites were then rerun successfully. A concurrent change to two UI caption files was also detected by the first input fingerprint, so that run was not reused as unchanged final evidence.

Assembly regression includes real signals to isolated imported/CLI/packager test processes, repeated signals during cleanup, exited parents with live descendants, output reservation/replacement conflicts, read-only and symlink safety, bounded diagnostics, diagnostic failure while cleanup is blocked, and actual log-FD reuse after a failed stop. These are deterministic development fixtures, not actual App packaging or genuine play.

Retained local execution evidence is under `.pi/progress/` (the `coherent-kernel-final-*`, `coherent-extension-final-suite.log`, and `coherent-electron-*` records). No real model calls, App installation/signing/restart, or genuine-play acceptance were performed. The remaining inherited Electron failures are not claimed to be fixed by this work.
