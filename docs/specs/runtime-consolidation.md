# Runtime Consolidation and Standalone Distribution

Status: Approved and implementing under #35. Acceptance seams were confirmed by the user on 2026-09-08. The implementation ledger is `runtime-consolidation-tickets.md`; kernel contract §27 records the integrated decisions and validation limits. Production migration is implemented and entering consolidated verification; standalone and full product acceptance remain pending.

## Problem Statement

PipiCOC needs a self-contained desktop distribution that carries no Python runtime and requires no developer toolchain. The current local App references a source checkout and its Node and uv installations. Runtime setup knowledge also appears in the kernel launcher, onboarding worker, Mod checker brief, reader wrappers, and read-only check entrypoint. Changes to executable selection or installation layout therefore require coordinated edits across business callers.

The inspected Mod and source-draft checkers already reuse validation functions from their authoritative acceptance paths. Multiple thin entrypoints are useful; deployment knowledge spread across their callers is the confirmed defect. Preserve Keeper responsibilities, deterministic rules and transactions, the seven Keeper verbs, and frontend projections while making runtime selection and resource resolution the host's responsibility.

The user explicitly confirmed the acceptance seams: the existing PipiCOC UI and the existing setup and play product entrypoints must deliver the complete flow; the existing kernel RPC must stay behavior-compatible; and the final proof is a clean machine with no source checkout and no Python or uv.

## Solution

Consolidate runtime ownership behind a host-owned runtime composition and capability interface, replace the production Python runtime with compiled TypeScript/JavaScript behind that seam, then verify standalone distribution. The order is staged deliberately:

- Stage A — runtime consolidation while the existing Python implementation still serves all flows through the unified host interface.
- Stage B — migrate the production kernel and every production checker and reader Python path behind the established seam, using differential evidence.
- Stage C — package the complete runtime closure and remove production Python and uv, with clean-machine end-to-end acceptance.

This is a staged parent spec. Stage A alone does not complete the no-Python goal. After the final cutover, Python may remain developer-only for compatibility tests and build utilities, but cannot be a production dependency of play, onboarding, PDF reading and checking, or Mods.

From the user's point of view the outcome is simple: a packaged app that plays the same game, with the same Keeper behavior and saved campaigns, on a machine that has never had Python.

## User Stories

1. As a player, I want the packaged PipiCOC client to launch and play without installing Python or uv, so that I can run a full campaign like any other desktop application.
2. As a player, I want the complete setup-to-play flow to work identically after the runtime change, so that the way I already prepare a PDF and start a table is not disrupted.
3. As a player, I want my saved campaigns, worldlines, transcripts, and history to survive the runtime migration unchanged, so that I do not lose an ongoing game.
4. As a Keeper operator, I want the seven Keeper verbs and their RPC envelopes, errors, and ordering to remain behavior-compatible, so that the Keeper's reasoning and tool use do not silently change.
5. As a Keeper operator, I want deterministic dice, seeds, and worldline behavior preserved across the new runtime, so that replays, forks, loops, and merges stay reproducible.
6. As a Keeper operator, I want duplicate calls and crash recovery to behave as before, so that a restarted session can safely finish a partially delivered turn.
7. As a maintainer, I want a single host-owned runtime composition to supply launch configuration and capabilities, so that callers stop assembling interpreters, environment variables, and repository paths themselves.
8. As a maintainer, I want callers to supply only semantic task, campaign, and home inputs plus cancellation, so that runtime details live in one place and cannot drift caller by caller.
9. As a maintainer, I want the existing kernel client, reader runner, onboarding host, and thin entrypoints to share that composition, so that there is one seam instead of several half-finished ones.
10. As a maintainer, I want no new daemon, global singleton kernel, scheduler, message bus, or generic dependency-injection container, so that per-session ownership, independent campaigns, and queue and publication leases are preserved.
11. As a maintainer, I want production to target compiled TypeScript/JavaScript, so that the shipped app does not carry a Python interpreter or package manager.
12. As a maintainer, I want one explicitly app-managed Node executable shared by Pi, the kernel, readers, and checkers, so that the app never depends on a globally installed Node.
13. As a maintainer, I want the same validation implementation reused for read-only feedback and final state-changing acceptance, so that the checker and the authoritative acceptance path cannot drift apart.
14. As a maintainer, I want source and packaged modes to share the same business module graph, with only startup composition selecting artifact locations and launchers, so that behavior does not fork by mode.
15. As a maintainer, I want assembly errors to be explicit and to preserve existing state, so that a broken package fails safely instead of silently degrading.
16. As a Mod creator, I want model briefs to reference stable capabilities rather than Python or environment recipes, so that I get consistent validation without knowing the runtime.
17. As a Mod user, I want Mod-generated definitions validated during creation and authoritative acceptance and retained after generator disablement or upgrade, so that accepted objects keep working across the migration.
18. As a PDF reader agent, I want a supplied JavaScript-capable tool environment and semantic check tools, so that I retain read, write, edit, bash, and private PDF tools and am never downgraded to a no-tools single completion.
19. As a PDF reader agent, I want the read-only check to cause no campaign mutation and not require a campaign kernel, so that checking a draft stays cheap and side-effect free.
20. As a release engineer, I want the packaged app to include the complete production dependency and resource closure, including Pi, extensions, prompts, built-in content and Mods, and required native assets, so that the app does not accidentally rely on development dependency pruning.
21. As a release engineer, I want the actual Git executable and native modules bundled for the selected target, so that the hard Git runtime dependency is satisfied without a global Git installation.
22. As a release engineer, I want no hidden runtime auto-download of interpreters or package managers, so that installation is deterministic and dependency bootstrap does not require network.
23. As a release engineer, I want immutable packaged resources separated from app-owned writable data, cache, sessions, logs, temporary work, and credentials, so that a read-only installation directory works and user data is preserved.
24. As a user, I want the packaged app to own an isolated Pi home and never fall back to a global Pi, while explicit user home selection still works, so that my environment is neither polluted nor unexpectedly overridden.
25. As a user, I want spaces and non-ASCII paths and a relocated app to keep working, so that where I install the app does not break the runtime.
26. As a user, I want app-owned data preserved across relocation and update, so that moving or upgrading the app does not cost me my campaigns.
27. As a maintainer, I want file locks, durable writes, and cancellation and publication fencing to preserve behavior across processes and crashes, so that partial turns, duplicate requests, and concurrent campaigns remain trustworthy.
28. As a maintainer, I want existing accepted save, module, and Mod records to survive migration, including byte-level digests and canonical encodings where identity depends on bytes, so that state identity is not silently re-normalized.
29. As a maintainer, I want integer, boolean, null, missing-field, and rounding semantics preserved, so that fixed low-level inputs compare equal across the old and new kernels.
30. As a contributor, I want implementation-only unit tests that import Python internals flagged for porting rather than claimed unchanged, so that the test suite's language assumptions stay honest.
31. As a contributor, I want existing RPC scenarios reused through runtime selection, so that behavior compatibility is verified at the contract seam rather than by language-specific internals.
32. As a reviewer, I want stage A, B, and C completion reported honestly, so that a consolidation-only milestone is never mistaken for the no-Python deliverable.
33. As a reviewer, I want the authoritative kernel RPC and Pi host contracts maintained before each implementation change, so that the seams do not drift while the runtime moves underneath them.

## Implementation Decisions

Approved implementation requirements. Consult the execution ledger for current delivery and acceptance evidence.

Preserve the external game RPC contract: methods, envelopes, closed error codes, serial ordering, the seven Keeper verbs, ownership of receipts and call identities, state authority, and gameplay behavior. The runtime replacement happens behind that contract; it does not redefine it.

Introduce a host-owned runtime composition module that supplies shared launch configuration and capabilities to the existing kernel client, reader runner, onboarding host, and thin entrypoints. Callers continue to supply semantic task, campaign, and home inputs plus cancellation; they no longer assemble interpreter, PATH, PYTHONPATH, or repository paths. This is module organization, not a new daemon, global singleton kernel, scheduler, message bus, generic dependency-injection container, or network port. Preserve per-session and per-preparation ownership, independent campaigns, and queue and publication leases. Do not introduce one global kernel or share a campaign writer merely to reduce child count.

The interface has three responsibilities: open a kernel connection for an explicitly bound owner and home; run an existing reader or Mod task with its cancellation and evidence context; and supply the task's read-only validation and page-access capabilities. Extend the existing kernel client and reader runner rather than adding parallel transports. The host resolves executables, immutable resources and writable locations once for each owner; the business caller receives usable capabilities. Development overrides are resolved in this same composition and apply consistently to play, setup, preparation and checks. The host owns process lifecycle; the kernel retains game state, arithmetic, receipts and publication authority. Consolidation must not create a second queue, game state cache or retry scheduler.

The production target is compiled TypeScript/JavaScript. Keep the JSONL stdio transport and an independent kernel process. Initially use one explicitly app-managed Node executable shared by Pi, the kernel, readers, and checkers; do not depend on a globally installed Node. Further eliminating a separate Node binary through Electron's utility process is outside the mandatory target because it cannot accept stdin and would require a transport change; do not treat it as drop-in JSONL reuse.

Reuse the same validation implementation for read-only feedback and final state-changing acceptance. Packaging commands and tools stay thin. Model briefs reference stable capabilities, not Python or environment recipes.

Native PDF page access remains in the TypeScript host and the kernel continues to consume validated, source-bound material rather than parse PDFs. Readers and Mod creators retain tool-enabled Pi execution with read, write, edit and bash, plus their scoped source and submission tools. Supply JavaScript execution and stable checking capabilities before removing Python wrappers. Preserve original-page evidence, independent review and the authoritative publication check. The memory extraction and verifier lanes retain their existing explicit zero-tool exception; it does not extend to other document work. Do not fork or patch Pi, change the model-facing seven verbs, or require models to reproduce machine-generated identifiers.

Separate immutable packaged resources from app-owned writable user data, cache, sessions, logs, temporary job work, and credentials. Development keeps repository-isolated Pi homes. The packaged app owns its own isolated Pi home and must not fall back to a global Pi. Existing explicit user home selection remains supported. No developer credentials are shipped.

Bundle the actual runtime dependencies, the Git executable, and native modules for the selected target. Use a verified OS-provided shell on the first macOS arm64 target. Do not auto-download interpreters or package managers at runtime as a hidden fallback. Preserve Git semantics and the existing state layout; do not replace history storage.

Source and packaged modes use the same business module graph; only startup composition selects artifact locations and launchers. Assembly errors are explicit and preserve existing state.

Existing accepted save, module, and Mod records survive migration: byte-level content digests and canonical encodings where identity depends on bytes; deterministic dice and seed behavior; integer, boolean, null, missing-field, and rounding semantics; receipt replay and partial turn recovery. Preserve the current seeded generator's observable seeding and sampling behavior, including worldline turn seeds and character creation; choosing a different generator with the same seed is insufficient. Compare old and new kernels on separate isolated copies and fixed low-level inputs, never as concurrent writers of one campaign. Define any comparison exclusions explicitly for nondeterministic metadata such as test timestamps; preserve relationships and never exclude receipts, state changes, canonical digests or dice results. Generated narrative wording is not required to be byte-identical.

File locks, durable writes, and cancellation and publication fencing preserve behavior across processes and crashes. Bounded adapters are allowed when directly required; there is no broad persistence redesign.

Rollout is staged A, B, and C. Stage A keeps the existing Python implementation active through the unified host; stage B migrates the production kernel and all production checker and reader Python paths behind that seam using differential evidence; stage C packages the full closure and removes production Python and uv. Maintain the authoritative kernel RPC and Pi host contracts before each implementation change. Existing accepted decisions about synchronous Git history, the unpatched Pi loop and separate graph authorities remain binding. Specification creation itself does not alter current contracts.

The initial delivery acceptance target is current macOS arm64. Keep paths and launch contracts portable, but make no Windows, Linux, or x64 deliverable promise; those require separate target-specific acceptance. Do not expand into Tauri, frontend redesign, rules or content changes, or Pi forks.

Production Python entrances to eliminate in stages B and C: the play kernel launch, the onboarding kernel launch, the Mod checker brief and its read-only check, the reader wrapper scripts and reader submission check, and the PDF read-only check command. Developer-only compatibility tests and build utilities may remain Python.

| Stage | Required exit evidence |
| --- | --- |
| A: consolidate runtime ownership | Existing play, setup, preparation and checking behavior works through host-owned configuration. Selecting another runtime or relocating resources changes composition only; business callers require no launch edits. Shutdown and cancellation preserve ownership and release writers and leases. Python is still present and this is explicitly an intermediate result. |
| B: replace production Python | The TypeScript implementation covers all currently reachable kernel methods and checker/reader paths, preserves the recorded RPC corpus and selected save/recovery cases, and completes genuine play through the same entrypoints. The Python reference remains development-only; no released flow silently falls back to it. |
| C: verify standalone delivery | The exact packaged App includes its production dependency closure and passes the clean-machine and UI gates below. Source checkout, Python, uv, global Node and global Git are unnecessary. Existing data survives relocation and update. A source-only run or a package that points at the developer checkout cannot pass. |

## Testing Decisions

Acceptance scope update, 2026-09-09: the user explicitly deferred the independent
clean-macOS/VM acceptance step and formal distribution closeout (including
notarization) because this is a self-signed build. Those gates are deferred, not
passed. The VM is stopped and its evidence retained. Its fresh-install Git and
project-onboarding findings remain open; local migration validation continues.

Good tests exercise external behavior at the highest product seam, not implementation details. The acceptance seam is the existing PipiCOC UI and the existing setup and play product entrypoints; the compatibility seam is the existing kernel RPC. Prefer these existing seams; create a new one only if a concrete gap proves it necessary.

Behavior cases to cover: full source-PDF setup and built-in starter; reviewed guidance and deferred opening; partial-work cancel and restart with cache reuse; play with mechanics and choices; Mod management before a Keeper exists and Mod-generated definitions during play, with accepted objects preserved after generator disablement or upgrade; save and resume, worldline fork, switch, and merge with existing history; duplicate requests with the same and different payloads; a crash between write, commit, and reply; no cross-campaign state; cold start, restart, and shutdown with no orphan writers or leases; and a read-only invalid checker that causes no campaign mutation. Include stale publication leases and simultaneous independent preparation jobs. Existing worldline live acceptance has documented gaps; exercise those behaviors and report remaining gaps rather than inferring coverage.

Clean-machine packaged-app acceptance: source checkout absent; Python, uv, global Node, and global Git unavailable; network not required for dependency bootstrap, with model API availability treated separately; read-only installation directory; paths containing spaces and non-ASCII characters; a relocated app; and app-owned data preserved. Verify actual product rendering and structured choices and the literal absence of production Python processes and dependency fallback; build output or a static grep is insufficient.

For genuine gameplay, follow the project's canonical test driver RPC transport with the normal launcher, configured Grok as Keeper, and the main acceptance session as the sole natural-language player, one turn at a time. Continue from setup/opening to an ending or a recorded genuine blocker. Retain the campaign evidence, use no scripted player or fake Keeper, and use no minimum-turn-count proxy. The driver itself may use Python externally on a validation controller; it is not shipped and is not a process dependency of the app under test. Verify the packaged UI and its actual bundled runtime on the clean target separately. A source-mode driver run on a developer machine does not satisfy the packaged gate.

The package gate must record the actual executable and resource paths, architecture, signature and process tree. Exercise a read-only installation location and a writable isolated user-data location without modifying the developer checkout or deleting previous evidence. Block dependency downloads while distinguishing model API traffic from bootstrap traffic. Confirm no Python or uv process is launched by the App, its readers or its checkers; confirm no global runtime is used to rescue a missing packaged resource. Account setup uses the user's normal product flow, not embedded developer credentials. A public macOS release additionally follows the existing signing and notarization requirements; a local development signature alone is not proof of end-user distribution.

Keep the existing required kernel and play, extension, and Electron-baseline checks. Annotate implementation-only unit tests that need porting rather than claiming they are language-agnostic. This specification has no executed acceptance evidence.

## Out of Scope

- A Windows, Linux, or x64 deliverable promise; those require separate target-specific acceptance.
- Tauri, frontend redesign, rules or content changes, and Pi forks.
- Replacing Git history storage or the Git sidecar semantics; Git remains a hard runtime dependency.
- Removing Python from developer-only compatibility tests and build utilities.
- A new daemon, global kernel, scheduler, message bus, generic dependency-injection container, or network port.
- Electron utility process as a mandatory replacement for the app-managed Node executable.
- Runtime auto-download of interpreters or package managers.
- Broad persistence redesign or normalization of meaningful differences in accepted records.

## Further Notes

### Source evidence

Inspected local branch `0.9.1a`; final source-reference check at `3805a95f9f0376736e3bd8090fef9bc7b4d10b46` on 2026-09-09T00:14:07.303Z. This checkout contains concurrent work, so this is a dated local-source observation, not a frozen release baseline or a claim that the commit is published remotely. No implementation files, existing specifications, campaign data or credentials were changed by this task.

The following locations are evidence pointers, not required future file placement. The implementation decisions above deliberately specify responsibilities and observable behavior rather than a directory redesign.

| Observed behavior | Current source location |
| --- | --- |
| Serialized JSONL, process restart and closing gate already exist. | `extensions/kernel/client.ts`, `KernelClient.call`, `handleExit`, `close` |
| Kernel command override exists but onboarding assembles a separate Python launch. | `extensions/kernel/index.ts`, `kernelCommand`; `pipicoc/onboarding-worker.ts`, kernel construction |
| Mod creation advertises a Python command; feedback and acceptance reuse one validator. | `extensions/mods/index.ts`, `task`; `kernel/coc/mods/check.py`; `kernel/coc/mods/adapter.py`, `accept` |
| Source feedback and authoritative publication share draft validation. | `bin/coc-read-check`; `extensions/module/reader-submit.ts`; `extensions/module/reading-service.ts`, `runJob`; `kernel/coc/modules/visual_check.py`; `kernel/coc/modules/reading.py` |
| Reader jobs install Python wrappers, while original-page rendering is already TypeScript. | `extensions/module/reader.ts`, `runOwnedReader`; `extensions/module/source.ts` |
| The App records absolute checkout, Node and uv locations and resolves a repository Pi home. | `pipicoc/package.mjs`; `Electron/apps/electron/src/main/runtime-assets.ts`, `resolveRuntimeAssets` |
| The tracked preparation host has its own worker lifecycle. Untracked copies are not implementation sources for this spec. | `Electron/packages/pi-backend/src/coc-onboarding.ts`; unrelated `pipicoc/onboarding-host.js` and `.d.ts` remain untouched |
| Pi is a production necessity currently declared as a development dependency. Native PDF dependencies also need packaging. | Root `package.json`; `extensions/module/source.ts` |
| Atomic writes, canonical digests, seeded dice, file locks and external Git carry compatibility obligations. | `kernel/coc/fileio.py`; `kernel/coc/store.py`; `kernel/coc/rpc.py`; `kernel/coc/worldline.py`; `kernel/coc/setup_drafts.py`; `kernel/coc/modules/reading.py`; `kernel/coc/history.py` |
| Existing compatibility evidence is reusable, but the current RPC launcher and some tests are Python-specific. | `tests/kernel/conftest.py`; `tests/kernel/test_corpus.py`; `tests/kernel/corpus/`; `tests/extension/`; `tests/play/driver.py` |

Normative references to update before implementation are the kernel RPC contract, especially sections 1, 8, 9, 12, 15, 22, 23 and 26, and the Pi host contract. Respect ADR-0001 (synchronous sidecar Git history), ADR-0002's supersession (no Pi patches), and ADR-0003 (separate graph authorities). The domain glossary supplies names; superseded OCR and number-check descriptions do not override the current kernel contract. Existing acceptance rules remain in force.

### External comparison

| Source | What it confirms | Limit for this project |
| --- | --- | --- |
| [Electron utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process) | Electron can supply a Node-enabled child process. | stdin must be ignored; this is not a direct replacement for the existing JSONL transport. |
| [Node child_process](https://nodejs.org/api/child_process.html) | Executable, environment, working directory and stdio belong to process creation. | A call to global Node does not make an App self-contained. |
| [Fowler: separating configuration from use](https://www.martinfowler.com/articles/injection.html) | Callers can depend on a capability while assembly selects its implementation. | This supports a small composition module, not a requirement for a DI framework. |
| [VS Code extension host](https://code.visualstudio.com/api/advanced-topics/extension-host) | The host selects the execution environment for extensions. | Its remote-host architecture is outside this project's needs. |
| [Rust executable distribution](https://doc.rust-lang.org/book/ch01-02-hello-world.html) and [cross-compilation](https://rust-lang.github.io/rustup/cross-compilation.html) | A native kernel can ship without a Rust installation. | Target-specific artifacts and linkers remain; Pi still needs a JavaScript runtime. Rust is not selected for this spec. |
| [PyInstaller operating mode](https://pyinstaller.org/en/stable/operating-mode.html) | A frozen Python application needs no user-installed Python. | It still carries the interpreter, so it does not satisfy the final no-Python package goal. |

These precedents support the proposed ownership and distribution choices; they do not establish migration correctness, package size, performance gains or completed acceptance. No size or latency reduction is promised.
