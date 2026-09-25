Status: ready-for-human (scope 1-3 done 2026-09-25; scope 4, the live gate, is the owner's)
Stage: SL-61 (P1, Keeper model latency; product-owned provider data)
Spec: docs/kernel-rpc.md §135.27 (thinking schedule) amend; runtime/host.ts (agent home); tests/play/driver.py `--thinking`

# SL-61 — Provider data corrections shipped with the product: a deepseek Keeper via opencode-go can be told thinking off

## Evidence (long gate #9 `longgate9-haunting-1234`, probes in the session scratchpad `thinking-probe/`)
- With the Keeper on `opencode-go/deepseek-v4.1-flash` "low", every turn was over 60 s (median 109 s): 59 model calls with reasoning p50 2,883 tokens (max 13,131), 90% of all output tokens were reasoning. The lane on the same model was fast because its prompts are small.
- Why "low" did nothing: pi-ai's deepseek thinking format sends `reasoning_effort` only when `compat.supportsReasoningEffort` is set, and the opencode-go model data (pi-ai's `providers/data/opencode-go.json`, mirrored in the App's `models-store.json`) has no such flag and declares `thinkingLevelMap.off: null` (off unsupported). So the product sent `thinking: {type: "enabled"}` with no effort and could not send off.
- Probed on the real turn-1 and turn-8 requests (40k tokens): `reasoning_effort` low/minimal is accepted by the endpoint but does not reduce reasoning (1,500–8,700 tokens); `thinking: {type: "disabled"}` is accepted and works: reasoning 0, turn 8 from 59–92 s to 3.1–3.5 s, tools still called. A `models.json` override `providers.opencode-go.modelOverrides.<model>.thinkingLevelMap.off = "off"` makes Pi send it (verified with `ModelRuntime.create({modelsPath})`).

## Ruling (owner, 2026-09-25)
Provider model data the product knows to be wrong is corrected by the product, as data: a corrections file shipped with the product (provider → model → override fields as Pi's `models.json` `modelOverrides` schema) is merged into the agent home's `models.json` when the host prepares the home, never clobbering a user's own entries. The first entries: `opencode-go/deepseek-v4.1-flash` and `deepseek-v4-flash` support `off`. The play driver takes `--thinking` (landed on the integration branch: `tests/play/driver.py`), and the gate launcher passes `off` for the deepseek Keeper.

## Scope
1. Contract: §135.27 addendum (provider data corrections; where the file lives; merge rule: product entries under user entries; the App's canonical models.json path is the pi-backend's business, so the merge happens where the agent home is prepared for a table, `runtime/host.ts`, and the same corrections are applied by pi-backend's home preparation if it has a hook, else recorded as a follow-up).
2. Data file (e.g. `content/providers/model-corrections.json`) with the two entries; the merge at host preparation; a note in the agent home file saying which entries are the product's.
3. Tests, mutation-killable: the merge writes the override into an empty home; keeps a user's existing override and other providers; the registry resolves `off` for the corrected model (Pi's `ModelRuntime.create({modelsPath})` on a fixture home); the driver's `--thinking off` reaches the launcher args.
4. Live: the owner runs long gate #10 with `--thinking off` on this build; the ticket records its numbers.

## Comments

- **2026-09-25, owner, scope 4 (live).** Long gate #10 on the same runtime with the agent home's `models.json` override and `--thinking off`: 73 Keeper calls, reasoning tokens 0 on every one, p50 2.6 s / p90 7.1 s (gate #9 "low": p50 27 s, 11 calls over 45 s); median wall 26 s, 19/20 turns under 60 s; prose zh-Hans and coherent on the four turns read. The one stranded turn (t4) is unrelated to thinking (SL-62/63). The override is the right shape; this ticket ships it as product data.
**2026-09-25, worker (SL-61, scope 1-3 done on `claude/sl61-20260925`, base `207512a20`).**

- **Scope 1 (contract).** Added `#### 135.27.1 Addendum` to `docs/kernel-rpc.md` (a subsection, not a
  renumber, per the stable-id rule): the evidence, the ruling, the corrections file's shape, the merge
  rule and its idempotence/tolerance, and the App's canonical `models.json` finding below.
- **Scope 2 (data file + merge).** `content/providers/model-corrections.json`: `opencode-go/deepseek-v4.1-flash`
  and `opencode-go/deepseek-v4-flash`, both `thinkingLevelMap: {off: "off"}`, each with a `$comment` explaining
  the correction (stripped before it ever reaches an agent home). `runtime/host.ts` gained
  `mergeProviderModelCorrections` (pure, JSON in/out) and `applyProviderModelCorrections` (its filesystem
  wrapper: reads the corrections file and the agent home's `models.json`, tolerant of both being absent or
  broken, writes back only on change). Wired into `runtime/launch.ts`'s `piLaunch`, right where it already
  reconciles `settings.json` (which made `piLaunch`/`launchMain` async; nothing else called `piLaunch`). The
  merged file carries a `//`-comment header naming which provider/model pairs are the product's; a user's own
  override for the same provider+model is left byte-for-byte untouched, whole (not merged field-by-field), and
  every other provider/field is untouched. Idempotent by construction (same inputs -> same bytes -> no rewrite).
- **The App's canonical `models.json` (the pi-backend question in scope 1).** Found the hook:
  `Electron/apps/electron/src/main/pi-profile.ts`'s `installBundledModelCapabilityOverrides(profile,
  snapshotPath)` -- "Install the bundled capability layer before Pi ModelRuntime reads models.json" -- with its
  own managed-field provenance file so a user's decision is never resurrected. It is unit-tested
  (`pi-profile.test.ts`) but **is dead code**: nothing calls it, no `snapshotPath` bundle exists on disk, and no
  startup path (`ensureProjectPiHome`, `ensureIsolatedProjectHome`, or the canonical-models migration in
  `Electron/packages/pi-backend/src/project-pi-home.ts`) invokes it. Wiring it for real needs decisions (where the
  bundled snapshot ships in the Electron build, when it runs relative to `migrateSharedProjectModels`'s
  canonical/project symlink machinery, whether it targets the per-project agent dir or the shared profile dir)
  that are packaging/startup-sequencing calls outside a TS-kernel-only worktree, so per the marker's instruction
  this is recorded here, not restructured. **Follow-up for whoever owns the Electron side next.**
- **The driver's `--thinking` (scope 3's fourth test).** Found a live bug while writing that test:
  `tests/play/driver.py`'s `Daemon._start_pi` took `thinking` as a constructor argument but never read it --
  `launch_args` always hard-coded `DEFAULT_THINKING` ("low"), so `start --thinking off` would still have sent
  `low` to the launcher. Fixed to `self.thinking or DEFAULT_THINKING` (the CLI's own default is `None`, so an
  omitted flag still falls back to `low`). This means before this fix, long gate #9's own baseline could not have
  been un-stuck by `--thinking off` even after this ticket's merge landed -- the merge makes off *sendable*, the
  driver bug would have kept it from being *sent*.
- **Tests (all mutation-killed by hand: verified each fails when its guard is removed, then restored).**
  `tests/extension/provider-model-corrections.test.mjs` (11 cases: the pure merge in memory -- empty home, a
  user's override and other provider fields untouched, `$comment` stripped, a no-op corrections shape; the I/O
  wrapper -- empty home, missing corrections file, idempotent second call by mtime+bytes, an operator's own file
  keeps its override, a hand-broken file is left alone; two against the real vendored Pi
  (`build/node_modules/@earendil-works/pi-coding-agent`) proving `ModelRuntime.create({modelsPath})` resolves
  `thinkingLevelMap.off` `null` before the merge and `"off"` after for both models, and still `null` for a model
  an operator explicitly kept unsupported). `tests/play/test_driver.py` gained
  `test_thinking_off_reaches_the_launcher_args` and `test_thinking_omitted_falls_back_to_default`.
- **Suites, on leehow-pc, base `207512a20` (git HEAD; uncommitted changes overlaid), serially (running `ext`
  and `py` concurrently against the same worktree name raced their shared `git clean`/build step and produced a
  spurious `ext` failure on the first attempt -- reran clean):**
  - `== ext on leehow-pc @ 207512a20d470d46134ea8df9bb6d55ad244c6e1: exit=1 wall=259s log=/home/leehow/leehow/code/wt/chatrpgv4-wt-sl61/remote-ext.log` --
    `ℹ tests 3141` / `ℹ pass 3140` / `ℹ fail 1`, the one failure
    (`continuity-audit.test.mjs`, "a turn left undelivered under a paused review is released without waiting for
    the player") reruns green in isolation (`node --test tests/extension/continuity-audit.test.mjs` on the Mac,
    37/37 pass, confirmed before this note) -- a load-sensitive flake under the box's full 3141-test run, not a
    regression from this change (nothing in this ticket's diff touches continuity-review code).
  - `== py on leehow-pc @ 207512a20d470d46134ea8df9bb6d55ad244c6e1: exit=0 wall=362s log=/home/leehow/leehow/code/wt/chatrpgv4-wt-sl61/remote-py.log` --
    `1730 passed, 2 skipped in 357.11s (0:05:57)`.
  - `== loop on leehow-pc @ 207512a20d470d46134ea8df9bb6d55ad244c6e1: exit=0 wall=44s log=/home/leehow/leehow/code/wt/chatrpgv4-wt-sl61/remote-loop.log` --
    `# tests 195` / `# pass 195` / `# fail 0`.
- **Undone: scope 4 (live gate #10 with `--thinking off`)** is explicitly the owner's, not this worker's, per
  the marker.
- **Also undone, by choice:** the Electron/pi-backend wiring above (recorded as a follow-up, not restructured).
