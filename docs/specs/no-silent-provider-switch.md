# The model changes only when the owner chooses

Status: integration-in-progress (NS-01..NS-03 copied from `claude/ui-provider-flip-20261008`; awaiting full verification, a repack
and NS-04 on the installed App)

Owner rule (standing, 2026-09-29 and 2026-10-03): never switch a model or provider without the owner's explicit choice
(memory `never-switch-models-without-asking`). Contract `docs/kernel-rpc.md` §206.

## Evidence

Every new table on 2026-10-08 (App home `~/Library/Application Support/Pipi/pipicoc/pi-coc/agent/`, read only):

| session | rows (provider/model, id shape, time) |
| --- | --- |
| `2026-10-08T12-52-28-304Z_3fc2f27a…` | openai-codex (UUID) 12:52:46.248, openai-codex (UUID) 12:52:49.010, **flapcode (8-hex) 12:52:50.545**, openai-codex (8-hex) 12:52:50.877 |
| `2026-10-08T14-19-49-867Z_58c7e45e…` | openai-codex (UUID) 14:20:17.536, 14:20:44.190, 14:20:47.010, **flapcode (8-hex) 14:20:48.181**, openai-codex (8-hex) 14:20:48.533 |
| `2026-10-08T14-51-49-179Z_e8f5cec8…` | openai-codex (UUID) 14:52:09.139, 14:52:12.070, **flapcode (8-hex) 14:52:13.947**, openai-codex (8-hex) 14:52:14.381 |

The same shape is in 10-03 `15-58-49-665Z_b98b5290…` (flapcode 15:59:03.272, openai-codex 15:59:03.546) and 10-04
`02-01-45-438Z_20698f54…` (flapcode 02:02:12.095, openai-codex 02:02:12.412), the "ghost house" the 10-03 memory note
attributed to the onboarding.

Settings at the time: the agent home's `settings.json` has `defaultProvider: flapcode`, `defaultModel: gpt-6-luna`;
`pipiui-settings.json` has `manualModelSelection: openai-codex/gpt-6-luna`.

## Who writes which row

The id shape names the writer. The host's own rows (`persistColdSessionRow`, `newSession`) carry `crypto.randomUUID()`;
Pi's `SessionManager` mints 8 hex characters (`generateId`, `vendor/pi/packages/coding-agent/src/core/session-manager.ts`).

1. **The flapcode row is written by Pi itself, at start.** `createAgentSession`
   (`vendor/pi/packages/coding-agent/src/core/sdk.ts`, unpatched lines) restores a session's recorded model only when
   the session has messages (`hasExistingSession = messages.length > 0`). A new table has none yet, so Pi resolves the
   agent home's settings default and appends `model_change` + `thinking_level_change` for it ("Save initial model and
   thinking level for new sessions"). The host started Pi without saying which model (`assemblePiSpawn` passed no
   `--provider/--model`). Timing: the row follows the host's `pipiui_product_profile` row (written by `spawnLive` just
   before the child starts), its thinking row is the same millisecond, and it precedes `kernel.hello` (the extension's
   `session_start`). Reproduced with the real Pi 1.0 CLI: a session whose only `model_change` is `relay/gpt-6-luna`
   and no messages gains `flapcode/gpt-6-luna` from the settings default.
2. **The openai-codex row 0.33 s later is the host correcting it.** `spawnLive` then sends
   `selectExactModel(live, desired)` → `set_model openai-codex/gpt-6-luna`; Pi appends a row for every `set_model`. Pi
   reads commands only after the extensions' `session_start`, so the row lands right after `coc-setup-opening`
   (14:20:48.531 → .533). For those 0.33 s the table's model was flapcode, and the COC extension's `session_start`
   (kernel hello, setup prologue, opening) ran under it.
3. **Neither recorded suspect wrote today's flip**, but both are the same class and both were live:
   - *The UI catalog fallback* (`Electron/packages/ui/src/App.tsx` `fallbackModelIfMissing` + `announceCatalogFallback`)
     switched to `catalog[0]` through `host.setModel`, which the host stores as the manual choice. It is the writer of the
     10-03 mid-turn switch: `model_change openai-codex` at 16:24:28.958 has an 8-hex id (a live `set_model`), comes during
     the second play turn with no `coc-runtime` row before it (no respawn), the owner had picked flapcode at 16:19:20, and
     `manualModelSelection` was openai-codex afterwards. Only `setModel` remembers a manual choice; the onboarding does not
     run mid-play.
   - *The onboarding re-apply* (`Electron/packages/pi-backend/src/index.ts`, after `cocOnboarding.invoke` for
     begin/select/converse) wrote today's UUID rows at 14:20:44.190 and 14:20:47.010 (each with a thinking row and a
     `session_info` rename in the same 5 ms). It re-applied the state read *before* the worker ran and called
     `rememberManualModelSelection` and `rememberManualThinkingLevel` each time. Today it wrote openai-codex over
     openai-codex; a pick made while the worker read the book would have been undone and stored as the old choice.
   - The 14:20:17.536 row (model only, no thinking row) is a composer `setModel` (quick menu or the catalog fallback);
     the file cannot tell which, and it named the model the session already had.

## Decisions

- **Pi is told the session's model at start.** `spawnLive` hands `--provider <p> --model <id> --thinking <level>` (Pi's
  own CLI port; no Pi patch: `vendor/pi/PATCHES.md` admits a patch only where a port cannot do it). Pi's record of a new
  session's model then restates the session's own model.
- **Exact registration is checked before the child starts.** The existing configured/auth-aware catalog must contain
  the requested provider/id pair; an unavailable catalog may retain configured rows but cannot authorize a guessed
  sibling. An absent exact pair refuses startup before Pi can append a fallback row or run session-start hooks. This
  closes the stopped worker's remaining prefix-match boundary without patching Pi or changing a default setting.
- **The post-spawn check writes nothing when Pi is already right.** `selectExactModel` asks `get_state` first and sends
  `set_model` only on a mismatch. It still refuses a sibling: a model Pi cannot find exactly fails the spawn.
- **The onboarding writes no model.** The worker still gets the model read when the step began; nothing is applied
  afterwards. A brand-new session's model is recorded by Pi at its first spawn (from the host's in-memory snapshot of the
  read, or the remembered pick).
- **A missing catalog entry is a visible state.** The composer keeps the session's model, marks the chip
  (`data-catalog-missing`, warning colour, `!`), and explains in a dismissible notice that the session still has it and
  nothing was switched. No `setModel`. The state is derived from the catalog, so it clears itself when the model is listed
  again; dismissing the notice leaves the chip mark.
- **Only `setModel` from the composer's own pick (or `/coc model`) changes a model**, and only that path remembers a
  manual choice.

## Tickets

### NS-01 Pi starts on the session's model; a correct start writes no row
Status: ready-for-human (implemented: `spawn-assembly.ts` `startModel`, `index.ts` `spawnLive` and `selectExactModel`)

### NS-02 The onboarding does not write back a stale read
Status: ready-for-human (implemented: `index.ts` onboarding route)

### NS-03 A catalog miss shows a state and never swaps
Status: ready-for-human (implemented: `App.tsx` `catalogLacksModel`, composer chip and notice; `app.css`)

### NS-04 Installed App check
Status: ready-for-human. After a repack: open a new table on the App; its JSONL has no `model_change` naming a provider
other than the chosen one, and the rows after `pipiui_product_profile` name the chosen model once.

## Boundaries and open questions (for the owner)

- **A model Pi's registry lacks.** `--model` can fall back to a substring match inside the given provider
  (`resolveCliModel`). The integration now refuses an absent exact registration before spawning, so the sibling never
  enters the session file or runs a session-start hook. The host's post-spawn exact check remains.
- **New sessions when the remembered pick is unavailable** still start on the configured default (`settings.json`), as
  `session-model.test.ts` "falls back to the configured default" decides; after an extension provider is removed the
  host's default becomes the catalog's first model (`fallbackModelIfMissing` in the backend). Neither changes an existing
  session's model, but the owner is not told the remembered pick was skipped. Not changed here: should a new table start
  on the missing remembered pick and show the missing state instead?
- The backend's global model list is whatever the last spawned child reported (`refreshState`); a catalog that briefly
  lacks a model now shows the mark for that moment instead of switching.

## Tests

Codex continuation: stopped worker WIP copied without changing the original checkout. Added exact pre-spawn registration
check and closed the prefix-match boundary; new notices use English source text. Local backend file 7/7; UI catalog-miss
cases 2/2 (223 unrelated cases skipped). Full regression and installed-App checks remain pending. Dependencies reuse the
existing main checkout's Electron node_modules without installation or mutation; no App was launched or packaged.

- `Electron/packages/pi-backend/test/no-silent-provider-switch.test.ts`: the real host spawning the real Pi CLI (vendored
  build when built, else the installed 1.0 package) with the App's arrangement (Pi default flapcode, remembered relay):
  an owner-picked table records only relay (was relay, flapcode, relay); a brand-new table records relay once (was
  flapcode, relay); a played table's resume records nothing (was one redundant row); the boundary above. The onboarding
  route with a stub worker for begin, select and converse: a pick made while the worker runs stands in the session and as
  the remembered pick.
- `Electron/packages/ui/src/App.test.tsx` "model catalog miss (§206)": the chip keeps grok, is marked, the notice names
  it, `setModel` and `stop` are not called, the mark survives a dismissed notice and clears when the catalog lists the
  model again; `catalogLacksModel` claims nothing for an empty catalog or the unread placeholder.

## Comments
