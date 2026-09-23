# SL-00 baseline record — the control arm

Ticket: `00-inventory.md`. Spec: `docs/specs/pi-native-single-loop.md`. Recorded 2026-09-23 on branch
`claude/sl00-inventory-20260923` at the 0.9.5a commit below. Everything here was read, not run: no table,
no model call, no measurement. Where a value comes from a live artifact the artifact is named; Application
Support was read only.

## 1. Product

| item | value | source |
| --- | --- | --- |
| Product commit (control arm) | `0b729e8fb363155b9efe78f08c2b02324241e5c6` (0.9.5a HEAD) | `git rev-parse 0.9.5a` |
| Installed App (not the control arm) | commit `fc884d7ed52a07708e65756dde5eb1f99e997f5f`, packaged 2026-09-23T05:20:25Z | `~/leehow/code/pipicoc-build/pipicoc-package.json` |
| Build the retained live session ran on | `67a281c3e` (per the prototype's results) | `experiments/single-loop-routing/RESULTS-20260923.md` |

The three are different commits. The control arm is 0.9.5a: a paired run must package or source-launch
exactly this commit (or the SL stage's base) on both arms, never compare against whatever App happens to be
installed.

## 2. Pi

| package | version | lock integrity | upstream directory | license |
| --- | --- | --- | --- | --- |
| `@earendil-works/pi-coding-agent` | 0.87.0 | `sha512-S9JJVGHya/h0e0M+zwPTB6RkPe7PmLLqfBUTssFYW5mxAti6oZEILn4jvaUImENRC3U9RwXAB6H4gw8xj2J0GQ==` | `packages/coding-agent` | MIT |
| `@earendil-works/pi-agent-core` | 0.87.0 | `sha512-c5b2FMdJ7C++HBa6AyBmusdf96gdgRqpF7J+UCq2yVGB28UETJvJ190HkgDWUaLPnOQQPbanjKMAm/TgRmFE2w==` | `packages/agent` | MIT |
| `@earendil-works/pi-ai` | 0.87.0 | `sha512-lbRm+EMY6Jx3l+HLpbqbm9Yrhkc5u7EffLk2id+zJQEoBuR5I+tijGiZU8zlnuuCclmQOgH0PVjL9PLbeqJ9MQ==` | `packages/ai` | MIT |
| transitive: `pi-tui`, `chord`, `pi-telemetry` | 0.87.0 each | in `package-lock.json` | `packages/tui`, `packages/chord`, `packages/telemetry` | MIT |

- Pinning: root `package.json` `dependencies` pins `pi-coding-agent` 0.87.0 and declares the three as
  `peerDependencies: "*"`; `pipicoc/runtime-dependencies.json` `production` pins `pi-coding-agent` 0.87.0
  (agent-core and ai arrive as its dependencies); `deployment.pi` is
  `node_modules/@earendil-works/pi-coding-agent/dist/cli.js`. `Electron/packages/pi-backend/package.json` pins its
  own `pi-coding-agent` 0.87.0 copy, which the backend loads in-process for `SessionManager` (history reads) and
  `ModelRuntime` (auth/catalog) — a second consumer of the session format.
- The installed App bundles the same three at 0.87.0 (`/Applications/PipiCOC.app/Contents/Resources/pi-coc/node_modules`).
- Upstream: `github.com/earendil-works/pi`, tag `v0.87.0` → `16787ad5b2dc748047f314ca1bfe7708f30f54f3`
  (lightweight tag; `git ls-remote --tags`, 2026-09-23). `v0.87.1` → `f07218c4…` already exists.
- What npm ships: `files` is `dist` (plus docs/README), no `src/`. Every `dist/*.js` carries a source map whose
  `sourcesContent` embeds the full TypeScript source (`../src/agent-loop.ts`, `../../src/core/agent-session.ts`,
  …). The line ranges in `inventory-SL-00.md` §8 are read from that embedded source.
- Digests (first 16 hex of sha256) of the shipped files the design cites:

| file | sha256 |
| --- | --- |
| `pi-agent-core/dist/agent-loop.js` | `75da7290cd348c07` |
| `pi-agent-core/dist/agent.js` | `3a890712a7a02fc2` |
| `pi-agent-core/dist/types.js` | `01ae2a5b120382f9` |
| `pi-coding-agent/dist/core/agent-session.js` | `5ebfae51db5a9005` |
| `pi-coding-agent/dist/core/sdk.js` | `b49c2843197166bb` |
| `pi-coding-agent/dist/core/agent-session-services.js` | `3a4ee476b0596f34` |

## 3. Emitted kernel

| entry | sha256 (built by `npm run build:runtime` at `0b729e8fb` in this worktree) |
| --- | --- |
| `build/kernel/rpc.mjs` | `60b34155bddda5ba0f4438b8f68f0ef675365cca09a75dca3b49e2d11de6a9a6` |
| `build/kernel/check.mjs` | `07f59004ca738581113a33a5c8b31eda3acb6030c3c06801f00bab633f82ec42` |

The launch entries the App runs are `build/pipicoc/rpc.mjs` → `build/runtime/launch.mjs` → Pi `dist/cli.js --mode rpc`
(`pipicoc/runtime-dependencies.json` `requiredEntries`). Whether the emit is byte-reproducible across machines is not
asserted here; the control arm is the commit, and a paired run records the digest it actually launched. (The
installed App's `rpc.mjs`, from `fc884d7ed`, is `72d17121…`.)

## 4. Mod lock

Source packages at `0b729e8fb`, digests computed with the kernel's own `packageDigest` (`kernel-ts/read/mods.ts`):

| Mod | version | default | package digest |
| --- | --- | --- | --- |
| `enhanced-items` | 1.2.2 | on | `7714ce10e86032ebf427e45c63e61d38a4dabb8f75dabb2d6182f7d3638f54af` |
| `guided-creation` | 1.2.1 | on | `b734a1c48475fcb3ec791760c5a92a2966e03095e7bad1914650317dd041a2e4` |
| `keeper-context` | 1.1.0 | off | `cbaddb426c04dcdb2ea1467a7be5f60d965d9065c9a0f9646bc60c29006ea386` |
| `keeper-pacing` | 1.3.0 | on | `41f2781b4eeb113cdb1883ed8ae6c97f437f27af874aca17989e1f2201bbd580` |
| `narration-audit` | 1.2.31 | on | `219eac97778de041efb4476c1c3485575557e7d14f13b14b5976a968143144e8` |
| `narration-craft` | 1.3.1 | on | `c80216c51993615d705a396405d0dbc96323644a4937b9d6d1d56ac2c6d92459` |
| `natural-npc` | 1.4.2 | on | `623c126fb89a72c03275dad4bcc900c9db7376596b0b6d7a9bb258e3ce2e25b2` |
| `npc-voice` | 1.2.0 | on | `3fc0e8b01d08e3053d9a9f8dca4b20c6ff6b33a4754ee484ac25431fec3d00b3` |
| `story-thread` | 1.2.10 | on | `d5c6b1b051b434d757dd21a169fe5c586070266093661795a1d1bdb3e18805cf` |

The live haunting campaign (`game-9456da03-779d-4dc3-acc2-ebf4bb7c06b9`, `world.json` `mods.active`) locks the same
bytes for eight of nine; it locks **`narration-audit` 1.2.30** (`c0471cee…`), not 1.2.31. The installed App ships
1.2.31. The `npc-voice` digest is corroborated by the live session's voice job id
(`voice:…:steven-knott@3fc0e8b0…`). A fixture replayed from that campaign therefore runs the 1.2.30 audit unless
it is re-locked, and both arms must run the same lock.

## 5. Models in play on the live table

| role | model | thinking | evidence |
| --- | --- | --- | --- |
| Keeper | `grok-build/grok-4.7-build-fast` | `low` for the first request of an input; continuations after a non-delivery tool batch drop to the model's lowest level (`thinking-schedule`, host contract §3.7) | `pipiui-settings.json` `manualModelSelection`/`manualThinkingLevel`; all 29 `provider-request` rows of the retained session are `grok-build/grok-4.7-build-fast` `reasoning_effort: low`; Agents.md ruling 2026-09-22 |
| Fast model (every quick lane) | `opencode-go/deepseek-v4.1-flash` | **`off` today** | `ext.coc-keeper.laneModel` / `ext.coc-keeper.laneThinking` in `pipiui-settings.json` (file modified after the retained session) |
| Jev | `jev-1.13.0` at `https://api.typesafe.ai/v1/systemone` | n/a | `runtime/jev/question-packing.ts` `JEV_MODEL`, `runtime/jev/decision-adapter.ts` `JEV_ENDPOINT` |

The retained session's 22 `lane-call` starts ran the fast model at **`low`** (`lane_thinking: "low"`,
`thinking_carried: true`), not `off`: the setting changed after that session, and it ran an older build. A
measurement that compares against that session is comparing a different lane thinking level. A transient
`model_change` to `google/gemini-3.1-pro-preview` (`medium`) appears at 02:21:57.630Z and is replaced by the Keeper
model 306 ms later; no provider request used it.

Lane model resolution (`runtime/fast-model.ts`): the lane's env var (`PI_COC_MOD_MODEL`, `PI_COC_VERIFIER_MODEL`,
`PI_COC_ADAPTATION_MODEL`, `PI_COC_ADMISSION_MODEL`, `PI_COC_MEMORY_MODEL`, `PI_COC_NPC_MODEL`, …) → the fast-model
setting → the table's model; thinking: env → setting → `LANE_THINKING_DEFAULT`, never the table's. Read when the lane
runs, never frozen into a spawn environment.

## 6. Switches that exist today

`PI_COC_LOOP_ENGINE` does **not** exist yet (the spec's proposed switch).

| switch | read at | effect | App today |
| --- | --- | --- | --- |
| `PI_COC_JEV_S0=1` | `runtime/launch.ts` `launchMain` | replaces the stock Pi CLI with `startS0Rpc` (SDK session + `runRpcMode`); `startS0Rpc` throws unless `PI_COC_LAYOUT=source` and mode play | off; impossible in the compiled layout |
| `PI_COC_TASK_RUNTIME=1` | `launch.ts`; `runtime/jev/fresh-source-navigator.ts` | in play: S0 task mode (TaskRuntime + `submit_plan_packet`), source only; with `PI_COC_JEV_SOURCE=1` also enables fresh-source navigation (a TaskRuntime) in the reading service | not set |
| `PI_COC_JEV_SOURCE`, `PI_COC_JEV_MEMORY`, `PI_COC_JEV_MEMORY_READ`, `PI_COC_JEV_RESOLVE`, `PI_COC_JEV_APPLY`, `PI_COC_TASK_DEADLINE_MS` | `s0-rpc.ts`, `fresh-source-navigator.ts` | task-mode families | not set |
| `PI_COC_ADMISSION_REVIEWER` (`lane`\|`jev`) | `extensions/kernel/admission.ts` | primary admission reviewer (§32.10); default `lane` | lane (trace: `reviewer: "lane"`) |
| `PI_COC_ADMISSION_MODEL`, `PI_COC_ADMISSION_TIMEOUT_MS`, `PI_COC_ADMISSION_JEV_TIMEOUT_MS`, `PI_COC_ADMISSION_JEV_MIN_CONFIDENCE` | same | lane model override, timeouts, Jev gate | defaults |
| `PI_COC_SPEECH_ATTRIBUTE` (`0` = off), `…_TIMEOUT_MS`, `…_MIN_CONFIDENCE` | `extensions/kernel/index.ts` | Jev speech attribution before a narrate commits (§128.3) | on (trace: 5 `speech` rows) |
| `PI_COC_SPEECH_STEER` (`0` = off) | same | host steer asking the Keeper to wrap speech (a `deliveryFix` of kind `speech`) | on (trace: `coc-host kind=speech`, turn 2) |
| `PI_COC_CONTINUITY_GATE` (`post`\|`pre`) | `extensions/mods/index.ts` | continuity review after (default) or before delivery | post |
| `PI_COC_JEV_VERIFIER=1` | `extensions/kernel/verifier.ts` | Jev post-delivery verifier first | off (trace: `route: "incumbent"`) |
| `PI_COC_NPC_ADVICE_AUTO` (`0` = off), `PI_COC_NPC_ADVICE_WAIT_MS`, `PI_COC_NPC_AUTHORS`, `PI_COC_NPC_BACKFILL` | `extensions/npc/*` | NPC advice (Jev) and authoring | on |
| `PI_COC_JEV_CONCURRENCY` | table/npc | Jev adapter concurrency (≤ 16) | default 16 |
| Jev key: vault `ext.jev.apiKey` → `EXT_JEV_APIKEY` | `extensions/jev/agent/config.js` `readJevApiKey` | gates every Jev path | configured |
| Jev preselect: setting `ext.jev.preselectEnabled`; CLI `PI_COC_JEV_PRESELECT` (source only; managed sessions obey the setting) | `readJevPreselectEnabled` | the per-input prescreen (Jev locate + evidence loop) | **`true`** |
| Jev preselect allowance: setting `ext.jev.preselectAllowanceMs`; CLI `PI_COC_JEV_PRESELECT_ALLOWANCE_MS` | `readJevPreselectAllowanceMs` | per-input allowance, default 12000 ms, clamped 2000–30000 | default (trace: `allowance_ms: 12000`) |
| `PI_COC_ADAPTATION_WAIT_MS` | `extensions/kernel/adaptation.ts` | foreground wait of `lookup kind=adaptation` | default |

## 7. Paired-measurement plan (pre-registered; no runs)

Written 2026-09-23, before any run. The thresholds below may not be revised after the first run of a series; a
revision is a new dated entry here, written before a new series, and the earlier series stays reported.

### 7.1 Arms

- **A (control, legacy):** product at `0b729e8fb` (or the SL stage's own base commit, recorded), stock Pi 0.87.0,
  every switch at the App values in §6. Once `PI_COC_LOOP_ENGINE` exists, `legacy`.
- **B (hybrid-v1):** the stage under test, patched Pi from the single build authority (ADR-0006),
  `PI_COC_LOOP_ENGINE=hybrid-v1`, every other setting, Mod lock and model identical to A.
- **C (hybrid + optional optimizations):** recorded separately (design §14.3); never used to judge B against A.

Both arms launch through the same entry (source-mode driver, `tests/play/driver.py` in RPC mode, or the packaged
App); the entry and the launched `rpc.mjs` digest are recorded per run.

### 7.2 Fixture tables

| id | table | source temperature | status |
| --- | --- | --- | --- |
| F1 | `experiments/single-loop-routing/fixtures/turn3` (`workspace.tar.gz`; campaign `game-9456da03…`, the-haunting starter, reset to sidecar commit `4891552` after turn 2; `baseline.json` holds the live Keeper's calls) | warm (starter graph, material already read) | exists |
| F2 | a PDF-module campaign positioned before its first player input, with the scene's source material still unread, so the input reaches a source read (`lookup kind=source` or `material_pending`) | cold | **to be recorded** (fixture script like `fixture.mjs`; source sha256 and module generation pinned) |
| F3 | a long session: ≥ 40 committed turns with the bounded-context fold active (a `fold` row with `raw_pressure: true`), positioned before a recorded input | warm | **to be recorded** (copy of App data, originals untouched) |

Every run extracts the fixture into a disposable workspace and resets it to the pinned commit, as the prototype
does. Nothing under Application Support is written.

### 7.3 Inputs

Each input is frozen in the fixture (`turn.json` or a sibling file) before the first run, with a **human-assigned**
label, `simple` or `complex`, recorded with it. `simple` = the player declares exactly one action the host can issue
as a candidate at that commit (a move to an exit whose kernel gate is met, a reveal of located material, a check a
Mod declares); `complex` = anything else. The label is written by the person recording the fixture; no classifier
assigns it.

| input | fixture | label | text |
| --- | --- | --- | --- |
| I1 | F1 | complex | the recorded turn-3 input, verbatim from `fixtures/turn3/turn.json` |
| I2 | F1 | simple | one sentence declaring only the move to an exit listed as met by `table.apply.options` at `4891552`; written in the campaign's play language and frozen before the first run |
| I3 | F2 | complex | recorded with F2 |
| I4 | F3 | simple | recorded with F3 |
| I5 | F3 | complex | recorded with F3 |

### 7.4 Models

Keeper `grok-build/grok-4.7-build-fast`, thinking `low` (continuations per `thinking-schedule`); fast model
`opencode-go/deepseek-v4.1-flash`, thinking `off`; Jev `jev-1.13.0`. Set identically on both arms and verified per
run from the `provider-request` and `lane-call` rows; a run whose actual Keeper or lane model/thinking differs is
**void**.

### 7.5 Schedule

N = 10 runs per (arm × input), interleaved A, B, A, B … within one session window to share provider conditions.
Dice come from the fixture's pinned state; where a different call order yields different rolls, the divergence is
recorded, never forced. Void runs (model mismatch, provider 5xx streak, fixture corruption) are listed with their
reason and replaced, at most 3 per cell; more than 3 voids makes the cell `inconclusive`.

### 7.6 Metrics (per run, from telemetry, not estimates)

| metric | definition |
| --- | --- |
| first visible prose | from the RPC `prompt` write to the first `message_update` `text_delta` shown to the player (display not false) in the run that is delivered, or to the first host-placed delivery |
| formal delivery | from the RPC `prompt` write to the committed `narrate`/`ask` (successful `tool_execution_end`, or the implicit-narrate telemetry row with `ok: true`) |
| provider calls and durations | Keeper: count of `provider-request` rows, each `provider-call.ms`, time-to-headers (`provider-response.at − provider-request.at`); lanes: `lane-call` rounds by `subsession`, each `end.ms`; Mod/reader children: `mod-agent`/`continuity-review`/reading rows with `ms` and child request counts |
| tokens and cost | Keeper assistant `usage` (input, output, cacheRead, cacheWrite, `cost.total`); lane and child usage where recorded; Jev adapter `usage` traces (`inputTokens`, `outputTokens`, `costUsd`); estimate and actual kept apart |
| retries | `auto_retry_start` events; lane attempts > 1; Jev adapter `retry` traces; Mod task attempt 2 |
| cancellations | provider calls ending `aborted`; watchdog abandonments; lane timeouts; `inputLifetime` aborts of preparation |
| Jev calls and ms | count of adapter attempts and summed ms, by family (prescreen, npc, speech, admission, route/decide/bind on B) |
| steps (B only) | LLM steps (infer), Jev steps (decide), host operations, with every route answer's distribution (`lane: "route"`) |

### 7.7 Grouping

Report every metric per cell — (warm | cold) × (simple | complex), i.e. I1/I2 (warm), I3 (cold), I4/I5 (warm, long) —
as the ten values, median and IQR. No pooled average across cells.

### 7.8 Pre-registered thresholds (B against A, same cell, paired by run index)

Speed (primary):

1. **I1 (warm, complex; the turn-3 replay):** median formal delivery of B ≤ median of A − 10 s, and B uses ≤ 5 Keeper
   provider calls in ≥ 8 of 10 runs (the prototype's replay reached 5 against the live 6).
2. **I2 (warm, simple):** B delivers with exactly one Keeper provider call (the compose) in ≥ 8 of 10 runs, and median
   formal delivery of B ≤ 0.6 × median of A.
3. **First visible prose, every cell:** median of B ≤ median of A + 5 s (non-inferiority); on I2 median of B ≤ median of A.
4. **I3 (cold) and I4/I5 (long):** non-inferiority only: median formal delivery of B ≤ 1.10 × median of A.
5. **Tail, every cell:** max formal delivery of B ≤ max of A + 15 s.
6. **Cost, every cell:** median total cost of B (Keeper + lanes + Jev) ≤ 1.10 × median of A.

Quality (non-inferiority; never traded for speed):

7. **Same receipts:** on I1, B's settled actions match the live turn's eight (the prototype's comparison) in at least
   (A's own match count − 1) of 10 runs; divergences listed per run.
8. **No new failure class in B:** zero runs with an undelivered turn, `admission_unavailable`, a re-rolled check or
   repeated payment after reconnect, a fabricated assistant message/usage/tool result, or `TaskRuntime.submit` on the
   hybrid path.
9. **Continuity review:** B's count of `contradicted` verdicts ≤ A's + 1 per cell.
10. **Blind read:** the owner reads the ten paired deliveries of I1 and I2 in random A/B order; B fails if marked worse
    in more than 3 of 10 pairs in either input.

A cell passes when every speed threshold that applies to it and every quality threshold hold. The stage's
performance claim is made only from cells that pass; a failed threshold is reported as failed.
