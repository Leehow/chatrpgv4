# SL-00 control-flow inventory

Ticket: `00-inventory.md`. Spec: `docs/specs/pi-native-single-loop.md`. Design: `docs/PiPiCoC_Pi原生单循环重构设计_v1.0.md`
(§2, §8.3, §9.1, §12, §13). Product commit `0b729e8fb` (0.9.5a). Machine-readable companion: `inventory-SL-00.json`,
guarded by `tests/extension/control-flow-inventory.test.mjs` through the scanner `tests/extension/control-flow-scan.mjs`.
Baselines and the measurement plan: `baseline-SL-00.md`.

## 1. Method

**Static.** An AST scan (TypeScript compiler API, TS and JS) of `extensions/`, `runtime/`, `pipicoc/` and
`Electron/packages/pi-backend/src/` reports every call of these kinds, keyed by file and the nearest named enclosing
symbol (a handler registered as `pi.on("agent_end", …)` is named `on(agent_end)`):

| kind | what counts |
| --- | --- |
| `agent-run` | `<agent\|session>.prompt(…)`, `.continue(…)` |
| `trigger-turn` | `pi.sendMessage(msg, opts)` unless `opts` is a literal with `triggerTurn: false`; every `sendUserMessage(…)`; every call of the kernel's `sendHost` wrapper. A send with no `triggerTurn` is recorded as `steer-when-streaming`: Pi 0.87 `AgentSession.sendCustomMessage` turns it into `agent.steer()` while a run streams, which buys another provider request |
| `rpc-run-command` | an object literal whose `type` is or can be `"prompt"`, `"steer"`, `"follow_up"` (the RPC commands that start or feed a Pi run) |
| `session-host` | `createAgentSession*`, `createAgentSessionRuntime`, `runRpcMode`, `runPrintMode` |
| `task-runtime` | `new TaskRuntime`, `.begin(…)`, `.submit(…)`, `this.#run(…)` |
| `reader-task` | `runReader(…)`, `runTask(…)` / `.runTask(…)` |
| `lane` | `runLane(…)` |
| `present-document` | `presentDocument(…)` |
| `jev-adapter` | `createDecisionAdapter(…)`, `createS0Decider(…)` |
| `jev-loop` | `runEvidenceAgent(…)`, `runPrescreenLoop(…)` — host-side Jev decision/read loops; not in the ticket's list, added because the trace shows one running on every player input |
| `provider-direct` | `.complete(…)` (incl. `ctx.modelRegistry.complete`), `completeSimple`, `streamSimple`, `streamFn`, `generateImage` |
| `network` | every value reference to the global `fetch` (a call, a default like `options.fetch ?? fetch`, `globalThis.fetch`) |
| `spawn` | `spawn(…)`, `.spawn(…)`, `.spawnImpl(…)` — child processes, Pi children among them |

No `agent.prompt`/`agent.continue` call exists in the scanned trees: the Keeper's own loop runs inside Pi's
`dist` (§8), started by the RPC `prompt` command. The scan is structural (names, literal flags), never a reading of
text; its self-test in the guard proves each kind is seen and that a `triggerTurn: false` send is not.

**Trace.** The retained live session
`…/ui-sessions/play/%2FUsers%2Fhaoli%2Fleehow%2Fplaytests%2Fjev-gui-20260922/2026-09-23T02-21-40-198Z_703d4d3a-….jsonl`
(read only; 480 entries, 371 `coc-telemetry` rows, build `67a281c3e`) decides which sites actually ran on a live
turn. Its `lane` tally: `provider-request`/`-response`/`-call` 29 each (all Keeper, `grok-build/grok-4.7-build-fast`
low), `lane-call` 22 rounds (verifier 4, memory 4, journal 4, voice 3, admission 7 — all
`opencode-go/deepseek-v4.1-flash`), `prescreen` 48 (`allowance_started` 3, `locate` 3, `loop_packing` 12,
`loop_decision` 6, `loop_operation` 3, `loop_cycle` 3, `prepared` 3, `delivered` 15), `admission` 8, `mod-agent` 11
(create 5, usage 6), `continuity-review` 12, `npc` 12 (decision 3, advice 3, personality 3, responses 3), `speech` 5,
`usage-prefetch` 9, `verifier` 4, `memory` 4, `journal` 4, `voice` 3, `context` 37, `fold` 3, `skills` 4,
`delivery` 1, `handout` 2, `prompt` 1; tool rows `look` 1, `lookup` 4, `resolve` 4, `apply` 8, `narrate` 8. No
TaskRuntime, S0, `keeper-support`, `map-words`, `workspace-rerank` or reading rows appear.

## 2. Counts

127 call sites under 121 inventory keys.

| role \ path | app-play | app-play-gated | child-process | app-setup | app-ui | settings-ui | source-only | no-caller | host-infra | total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| driver | 17 | 5 | 2 | 2 | – | – | 14 | 2 | – | 42 |
| leaf | 17 | 12 | – | 3 | 14 | 2 | 4 | – | – | 52 |
| infra | 16 | 3 | – | 1 | – | – | – | 1 | 12 | 33 |

- **On the installed App's play path today:** 22 driver sites (17 by default + 5 behind a gate), 29 leaf sites.
  Of the 5 gated drivers, the prescreen's Jev loop is **on** in the App (preselect `true`, Jev key configured); the
  Keeper `lookup kind=support` loop is reachable (Jev key) but was not observed; the three fresh-source TaskRuntime
  calls are off (env-only gate no App setting sets).
- **Source-only:** all of S0 and task mode — 14 driver sites, 4 leaf sites.
- Vocabulary: *driver* = starts or extends a model run, or holds a multi-round decision/operation loop that
  decides when its goal is done; *leaf* = one bounded model/Jev/network call (fixed retries at most) whose result
  returns to its caller; *infra* = no model in the call. Paths are defined in the JSON's `vocabulary`.

## 3. What a player turn runs on the App today

Chain, from the retained session and the code (turn 3 of the haunting table, 03:07:47–03:10:14Z):

1. UI → `PiHostBackend.dispatchQueuedMessage` writes RPC `{type: "prompt"}` to the Keeper child (`pipicoc/rpc.mjs`
   → `runtime/launch.ts` → Pi `dist/cli.js --mode rpc`). Pi: `AgentSession.prompt` → `_runAgentPrompt` →
   `agent.prompt` → `runLoop` (§8).
2. `before_agent_start` / request preparation, before the first provider request: kernel `table.player_input`;
   NPC advice (Jev fan-out, `coc-npc-advice`); **the prescreen** — Jev semantic locate, then `runEvidenceAgent`,
   a `while (steps < maxSteps)` loop of Jev decision → read/follow/discover operations → cycle, inside the 12 s
   allowance (turn 3: allowance 03:07:47.728, locate 1307 ms, prepared 3901 ms).
3. Keeper provider calls (turn 3: six, 13.2 / 16.5 / 10.1 / 63.9 / 4.7 / 14.0 s). Inside its tool calls:
   admission lane before each `resolve`/`apply`; `mods.prepare` → Mod definition child (foreground when a
   definition must exist first); `lookup kind=source` or `material_pending` → reader child with a foreground wait;
   `lookup kind=support` → the same Jev evidence loop; `lookup kind=adaptation` → the adaptation service's host
   loop of creator/reviewer children; speech attribution (Jev) before a narrate commits.
4. `agent_end`: the host's turn-close policy may `sendHost(…)` a steer (preparation wait, reading wait, delivery fix
   incl. the speech steer, pending choice, "turn not closed"), which `_handlePostAgentRun` turns into
   `agent.continue()` — another provider request in the same run. Turn 2 shows it: `coc-host kind=speech` at
   02:28:28.115, then two more Keeper calls, then a host-placed delivery.
5. `agent_settled`: `sendUserMessage` releases a held input as the next run.
6. After commit, background: verifier lane, memory extraction, NPC journal, voice check and voice author, NPC author,
   continuity review (post mode), usage prefetch, document warmup.

So today's play path has **three decision loops that are not Pi's**: the prescreen's Jev evidence loop (every input,
bounded), the host's `agent_end` steer policy (extends Pi's run), and the tool-enabled child agents that run inside
Keeper tools (Mod definitions, source reads, adaptation; continuity review when `pre`). TaskRuntime is not among them.

## 4. Inventory

Tables are generated from `inventory-SL-00.json` (lines are at `0b729e8fb`, informative only).

#### Drivers — app-play (17 sites)

| file | symbol | line(s) | call | owner | path | trace | note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `Electron/packages/pi-backend/src/index.ts` | `PiHostBackend.dispatchQueuedMessage` | 11146 | `{type: steer\|follow_up\|prompt}` | pipiui host input queue | app-play | observed: 7 user messages in the retained session | Entry of every player turn: writes the RPC prompt (or steer/follow_up) to the Keeper Pi child, which runs AgentSession.prompt -> _runAgentPrompt -> agent.prompt. Also retries an already-processing prompt as followUp. |
| `extensions/kernel/adaptation.ts` | `run` | 51 | `runtime.runTask` | kernel ext: adaptation service | app-play | not observed | Host `while (task)` loop over creator/reviewer children (2 passes each), started by the Keeper's `lookup kind=adaptation` tool; the tool waits PI_COC_ADAPTATION_WAIT_MS in the foreground, then the loop continues in the background. Each child is a tool-enabled Pi agent (read,write,edit,bash). |
| `extensions/kernel/index.ts` | `sendHost` | 1134 | `pi.sendMessage{triggerTurn}` | kernel ext | app-play | observed: coc-host kind=opening (turn 0), kind=speech (turn 2) | The wrapper: starts a Keeper run when idle, steers the live run when streaming (AgentSession.sendCustomMessage). Its callers are listed separately. |
| `extensions/kernel/index.ts` | `on(session_start)` | 3415, 3428 | `sendHost` | kernel ext: table open | app-play | observed: coc-host kind=opening at turn 0 | Host-started Keeper runs with no player input: crash recovery ("finish this turn") and the opening turn. |
| `extensions/kernel/index.ts` | `on(agent_settled)` | 3559 | `pi.sendUserMessage` | kernel ext: input queue | app-play | not observed | Releases a player input held while a turn was open as a new run (deferred by Pi 0.87 until settled handlers finish). |
| `extensions/kernel/index.ts` | `on(agent_end)` | 4582, 4589, 4597, 4605, 4612 | `sendHost` | kernel ext: turn-close policy | app-play | observed: coc-host kind=speech at turn 2 followed by two more Keeper provider calls | The host's own continuation policy: preparation wait, reading wait, kernel delivery fix (incl. the speech steer), pending choice, "turn not closed". Each steer is agent.steer on a streaming run, and _handlePostAgentRun continues the same run: one more provider request. |
| `extensions/mods/index.ts` | `runContinuityReview` | 284 | `owner.runTask` | mods ext: continuity review (narration-audit Mod) | app-play | observed: 12 continuity-review rows (post mode; 4 child runs) | Tool-enabled audit child whose verdict can pause review and strand turns (contract 38). Default mode post (after delivery); PI_COC_CONTINUITY_GATE=pre makes it gate delivery. Decision-bearing multi-round child loop. |
| `extensions/mods/index.ts` | `task` | 390 | `owner.runTask` | mods ext: Mod definition agents (create/usage/audit) | app-play | observed: mod-agent create x5, usage x6 | Up to two attempts (host repair round) of a tool-enabled child. Runs inside the Keeper's resolve/apply tool through mods.prepare when a definition must exist first (foreground), or deferred (129). Decision-bearing child loop in the current turn when foreground. |
| `extensions/module/reader.ts` | `runOwnedReader` | 280 | `spawn` | module ext: reader | app-play | observed indirectly (every mod-agent/continuity/npc/voice child) | THE Pi child spawn: `pi -p --no-session --no-context-files --no-extensions --no-skills --tools <list> --mode json`. Every reader/mod/presenter child is a stock Pi agent loop (multi-round model-tool). |
| `extensions/module/reading-service.ts` | `ReadingService.runJob.run` | 694 | `runtime.runTask` | module ext: source reader | app-play | not observed on the retained turns | Checked source reading (guidance/answer units with independent review). Foreground when a Keeper lookup kind=source or a material_pending read waits (up to 120 s), then background. |
| `extensions/module/reading-service.ts` | `ReadingService.runJob` | 709 | `runtime.runTask` | module ext: source reader | app-play | not observed on the retained turns | Source reader child for skeleton/opening/detail/index jobs; same foreground rule. |
| `runtime/tasks.ts` | `runTask` | 289 | `runReader` | runtime tasks | app-play | observed indirectly (every child row) | The one funnel for every tool-enabled Pi child (kind reader\|mod): resolves the child model, applies the provider budget, calls runReader. |

#### Drivers — app-play-gated (5 sites)

| file | symbol | line(s) | call | owner | path | trace | note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `extensions/table/keeper-support-lookup.ts` | `lookupKeeperSupport` | 30 | `createDecisionAdapter` | kernel/table: Keeper `lookup kind=support` tool | app-play-gated | not observed (no keeper-support rows) | Inside a Keeper tool: runs prepareKeeperSupport, i.e. the Jev evidence loop, bounded by the preselect allowance. Gate: Jev key. |
| `extensions/table/prescreen.ts` | `prepareKeeperSupport` | 558 | `runEvidenceAgent` | table ext: prescreen (keeper-preparation) | app-play-gated | observed: allowance_started x3, locate x3, loop_packing x12, loop_decision x6, loop_operation x3, loop_cycle x3 | Host-side Jev decision/read loop (`while (steps < maxSteps)`: decide -> execute read/follow/discover operations -> cycle) that runs before the Keeper's first provider request of each input, within the 12 s allowance. Gate: Jev key + ext.jev.preselectEnabled (true in the App). A decision loop beside Pi's own on today's play path. |
| `runtime/jev/fresh-source-navigator.ts` | `createFreshSourceNavigator` | 142 | `new TaskRuntime` | module reading: fresh-source navigation | app-play-gated | n/a | The only TaskRuntime not behind the source-mode check: env-gated, reachable from ReadingService (play) and the onboarding worker (setup) for a fresh skeleton job. |
| `runtime/jev/fresh-source-navigator.ts` | `createFreshSourceNavigator` | 146 | `tasks.begin` | module reading: fresh-source navigation | app-play-gated | n/a | Same gate. |
| `runtime/jev/fresh-source-navigator.ts` | `createFreshSourceNavigator` | 150 | `tasks.submit` | module reading: fresh-source navigation | app-play-gated | n/a | Same gate; TaskRuntime.#run drives Jev navigation decisions. |

#### Drivers — child-process (2 sites)

| file | symbol | line(s) | call | owner | path | trace | note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `extensions/kernel/adaptation-submit.ts` | `adaptationSubmit.on(agent_end)` | 22 | `pi.sendMessage{triggerTurn}` | adaptation child (reader subprocess) | child-process | not observed | Loaded only inside an adaptation creator/reviewer child Pi. Once per child, extends the child's own run (followUp) to force submit_adaptation. |
| `extensions/mods/audit-submit.ts` | `auditSubmit.on(agent_end)` | 61 | `pi.sendMessage{triggerTurn}` | continuity audit child (mod subprocess) | child-process | not observed | Loaded only inside the audit child Pi. Once per child, extends the child's own run to force submit_audit. |

#### Drivers — app-setup (2 sites)

| file | symbol | line(s) | call | owner | path | trace | note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `extensions/onboarding/index.ts` | `ensureGuidance` | 157 | `runtime.runTask` | onboarding ext | app-setup | n/a (setup) | Setup-mode guidance reader child. |
| `pipicoc/onboarding-worker.ts` | `runTask` | 46 | `runtime.runTask` | pipicoc onboarding worker | app-setup | n/a (setup) | Guidance reader children in the preparation worker process. |

#### Drivers — source-only (14 sites)

| file | symbol | line(s) | call | owner | path | trace | note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `runtime/jev/memory-read-owner.ts` | `registerMemoryReadOperations.execute` | 58 | `runtime.begin` | S0 task mode: memory.search owner | source-only | n/a | Recursive child task inside an owner operation (design 2.4). Registered only by task-host-session. |
| `runtime/jev/memory-read-owner.ts` | `registerMemoryReadOperations.execute` | 63 | `runtime.submit` | S0 task mode: memory.search owner | source-only | n/a | Same. |
| `runtime/jev/s0-rpc.ts` | `startS0Rpc` | 54 | `createAgentSessionRuntime` | S0 probe | source-only | n/a | Alternative Keeper host built on the Pi SDK instead of the stock CLI. |
| `runtime/jev/s0-rpc.ts` | `startS0Rpc` | 72 | `createAgentSessionFromServices` | S0 probe | source-only | n/a | Same host. |
| `runtime/jev/s0-rpc.ts` | `startS0Rpc` | 78 | `runRpcMode` | S0 probe | source-only | n/a | Same host. |
| `runtime/jev/source-owner-operations.ts` | `registerSourceOperations.register(source.consult)` | 141 | `runtime.begin` | S0 task mode: source.consult owner | source-only | n/a | Recursive child task inside an owner operation (design 2.4). Gate: PI_COC_JEV_SOURCE=1 in task mode. |
| `runtime/jev/source-owner-operations.ts` | `registerSourceOperations.register(source.consult)` | 145 | `runtime.submit` | S0 task mode: source.consult owner | source-only | n/a | Same. |
| `runtime/jev/task-host-session.ts` | `createTaskHostAdapter.ensureRuntime` | 138 | `new TaskRuntime` | S0 task mode | source-only | n/a | Gate: PI_COC_TASK_RUNTIME=1, play, source layout. |
| `runtime/jev/task-host-session.ts` | `createTaskHostAdapter.extension.runMemory` | 207 | `shared.begin` | S0 task mode: committed memory | source-only | n/a | Independent committed-memory root. Gate: PI_COC_JEV_MEMORY=1. |
| `runtime/jev/task-host-session.ts` | `createTaskHostAdapter.extension.runMemory` | 214 | `shared.submit` | S0 task mode: committed memory | source-only | n/a | Same. |
| `runtime/jev/task-host-session.ts` | `createTaskHostAdapter.extension.on(before_agent_start)` | 402 | `runtime.begin` | S0 task mode: table evidence | source-only | n/a | Binds the player input to a foreground task before the Keeper's first request. |
| `runtime/jev/task-host-session.ts` | `createTaskHostAdapter.extension.execute` | 568 | `runtime.submit` | S0 task mode: submit_plan_packet | source-only | n/a | The Keeper's submit_plan_packet tool awaits the whole TaskRuntime run (design 2.2). |
| `runtime/jev/task-runtime.ts` | `TaskRuntime.submit` | 182 | `#run` | TaskRuntime | source-only | n/a | The second loop: decision -> operation -> checkpoint -> replan -> completion. Reached from S0 task mode (source only) and fresh-source navigation (env-gated). |
| `runtime/jev/task-runtime.ts` | `TaskRuntime.resume` | 249 | `#run` | TaskRuntime | source-only | n/a | Resume of the same loop. |

#### Drivers — no-caller (2 sites)

| file | symbol | line(s) | call | owner | path | trace | note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `Electron/packages/pi-backend/src/session-title.ts` | `generateModelSessionTitle.sendPrompt` | 143 | `{type: prompt}` | pipiui session titles | no-caller | n/a | Would start a separate Pi child run for a title; no caller in pi-backend (startAutomaticSessionTitle uses a provisional title: "this product never starts another Keeper for it"). |
| `extensions/table/prescreen-loop.ts` | `runPrescreenLoop` | 8 | `runEvidenceAgent` | table ext | no-caller | n/a | Exported wrapper with no caller. |

#### Leaves (model-involving) — app-play (17 sites)

| file | symbol | line(s) | call | owner | path | trace | note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `extensions/kernel/admission.ts` | `reviewAdmission` | 417 | `runLane` | kernel ext: action admission (contract 32) | app-play | observed: 8 admission rows, 7 lane-call admission starts | One zero-tool completion per proposed resolve/apply, before the kernel; fast model. Default reviewer (PI_COC_ADMISSION_REVIEWER unset = lane). |
| `extensions/kernel/index.ts` | `ensureMapWords.runner` | 1470 | `owner.runTask` | kernel ext: map words presenter | app-play | not observed (no map-words rows) | Background presenter child (kind mod) projecting map words into the play language; not awaited by the turn. |
| `extensions/kernel/index.ts` | `emitProviderNotice` | 2233 | `pi.sendMessage{steer-when-streaming}` | kernel ext: service notices | app-play | not observed | Service notice scheduled on the next task after settle, so it appends without starting a run; were a run streaming, Pi would steer it (no triggerTurn:false). |
| `extensions/kernel/index.ts` | `emitCommitDownNotice` | 2262 | `pi.sendMessage{steer-when-streaming}` | kernel ext: service notices | app-play | not observed | Service notice scheduled on the next task after settle, so it appends without starting a run; were a run streaming, Pi would steer it (no triggerTurn:false). |
| `extensions/kernel/index.ts` | `emitTurnUnfinishedNotice` | 2467 | `pi.sendMessage{steer-when-streaming}` | kernel ext: service notices | app-play | not observed | Service notice scheduled on the next task after settle, so it appends without starting a run; were a run streaming, Pi would steer it (no triggerTurn:false). |
| `extensions/kernel/index.ts` | `emitInputRefusedNotice` | 2631 | `pi.sendMessage{steer-when-streaming}` | kernel ext: service notices | app-play | not observed | Service notice scheduled on the next task after settle, so it appends without starting a run; were a run streaming, Pi would steer it (no triggerTurn:false). |
| `extensions/kernel/index.ts` | `emitEmptyInputNotice` | 2664 | `pi.sendMessage{steer-when-streaming}` | kernel ext: service notices | app-play | not observed | Service notice scheduled on the next task after settle, so it appends without starting a run; were a run streaming, Pi would steer it (no triggerTurn:false). |
| `extensions/kernel/verifier.ts` | `budgetedVerifierContext.complete` | 208 | `original.complete` | kernel ext: verifier | app-play | observed (verifier lane) | Wraps ctx.modelRegistry.complete to charge the verifier lease; one completion. |
| `extensions/kernel/verifier.ts` | `incumbent` | 324 | `runLane` | kernel ext: post-delivery verifier | app-play | observed: 4 verifier rows | Advisory verifier lane after delivery; fast model. |
| `extensions/lanes/subsession.ts` | `runLaneAttempt` | 428 | `modelRegistry.complete` | lanes (shared) | app-play | observed: 22 lane-call rounds | The single provider call of every zero-tool lane (verifier, admission, memory, journal, voice). Outside the Keeper's streamFn: no before/after_provider_request hooks. |
| `extensions/memory/index.ts` | `attempt` | 280 | `runLane` | memory ext: extraction | app-play | observed: 4 memory rows | Committed-turn extraction; background root, runs after commit. |
| `extensions/mods/index.ts` | `warm` | 738 | `presentDocument` | mods ext: document presentation warmup | app-play | not observed | Background warmup when a paper is acquired; outlives the tool call; not awaited. |
| `extensions/mods/index.ts` | `warm.runner` | 739 | `owner.runTask` | mods ext: document presentation warmup | app-play | not observed | Runner handed to presentDocument (child kind mod). |
| `extensions/npc-journal/index.ts` | `attempt` | 240 | `runLane` | npc-journal ext | app-play | observed: 4 journal rows | Background journal lane after commit. |
| `extensions/npc-voice/index.ts` | `attempt` | 303 | `runLane` | npc-voice ext: voice check | app-play | observed: 3 voice lane-calls | Voice mask check lane; background. |
| `extensions/npc-voice/writer.ts` | `writeVoice` | 25 | `runtime.runTask` | npc-voice ext: voice mask author | app-play | observed: voice job rows | Background tool-enabled author child; not awaited by the turn. |
| `extensions/npc/writer.ts` | `authorNpc` | 14 | `runtime.runTask` | npc ext: NPC author | app-play | observed: npc personality/responses x3 | Background tool-enabled author child. |

#### Leaves (model-involving) — app-play-gated (12 sites)

| file | symbol | line(s) | call | owner | path | trace | note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `extensions/deepseek/agent/catalog-runtime.js` | `refreshDeepSeekCatalog` | 93 | `globalThis.fetch` | deepseek-extended provider | app-play-gated | not observed | Transport/catalog of the `deepseek-extended` provider registered with pi.registerProvider; used only when a deepseek-extended model is selected. Today's Keeper (grok-build) and fast model (opencode-go) do not use it. Requests are driven by Pi's stream path, not by this code. |
| `extensions/deepseek/agent/client.js` | `DeepSeekClient.constructor` | 279 | `fetch` | deepseek-extended provider | app-play-gated | not observed | Transport/catalog of the `deepseek-extended` provider registered with pi.registerProvider; used only when a deepseek-extended model is selected. Today's Keeper (grok-build) and fast model (opencode-go) do not use it. Requests are driven by Pi's stream path, not by this code. |
| `extensions/deepseek/agent/files/client.js` | `DeepSeekFilesClient.constructor` | 48 | `fetch` | deepseek-extended provider | app-play-gated | not observed | Transport/catalog of the `deepseek-extended` provider registered with pi.registerProvider; used only when a deepseek-extended model is selected. Today's Keeper (grok-build) and fast model (opencode-go) do not use it. Requests are driven by Pi's stream path, not by this code. |
| `extensions/kernel/admission.ts` | `reviewAdmissionPrimary` | 485 | `createDecisionAdapter` | kernel ext: action admission (contract 32.10) | app-play-gated | not observed (reviewer: lane) | Gate: PI_COC_ADMISSION_REVIEWER=jev; falls back to the lane on every non-verdict. |
| `extensions/kernel/index.ts` | `attributeUnwrappedSpeech` | 1781 | `createDecisionAdapter` | kernel ext: speech attribution (128.3) | app-play-gated | observed: 5 speech rows | Gate: PI_COC_SPEECH_ATTRIBUTE != 0 (default on) and a Jev key. Bounded Jev fan-out before an implicit/explicit narrate commits; never refuses. |
| `extensions/kernel/verifier.ts` | `runVerifierLane` | 287 | `createDecisionAdapter` | kernel ext: post-delivery verifier | app-play-gated | not observed (route: incumbent) | Gate: PI_COC_JEV_VERIFIER=1. |
| `extensions/npc/index.ts` | `npcExtension.on(session_start)` | 63 | `createDecisionAdapter` | npc ext: NPC advice | app-play-gated | observed: npc decision x3, advice x3, coc-npc-advice messages | Gate: Jev key, not the preparation owner, PI_COC_NPC_ADVICE_AUTO != 0. Bounded Jev fan-out prepared before the Keeper's first request. |
| `extensions/rerank/agent/vendors.js` | `rerankDocuments` | 250 | `fetch` | rerank (table workspace) | app-play-gated | not observed (no workspace-rerank rows) | Rerank model host. Reached from extensions/table/workspace/reranker.ts rankWorkspaceCandidates when the workspace mode is on, the rerank setting is on and remote use is permitted. |
| `extensions/table/context-runtime.ts` | `installContextPolicy.decision` | 61 | `createDecisionAdapter` | table ext: preparation (prescreen + NPC preparation owner) | app-play-gated | observed (prescreen rows) | Shared adapter factory for the per-input preparation. Gate: Jev key; the prescreen also needs ext.jev.preselectEnabled (true in the App). |
| `extensions/table/prescreen.ts` | `prepareKeeperSupport` | 295 | `createDecisionAdapter` | table ext: prescreen | app-play-gated | observed | Adapter used when no shared one is passed. |
| `runtime/jev/decision-adapter.ts` | `createDecisionAdapter` | 215 | `fetch` | Jev decision port | app-play-gated | observed: prescreen loop_decision, npc decision, speech rows | The one transport of every typed Jev decision (POST https://api.typesafe.ai/v1/systemone). Gate: a Jev key in the vault (configured in the App). |
| `runtime/jev/fresh-source-navigator.ts` | `createFreshSourceNavigator` | 119 | `createDecisionAdapter` | module reading: fresh-source navigation | app-play-gated | n/a | Gate: PI_COC_TASK_RUNTIME=1 and PI_COC_JEV_SOURCE=1 and a Jev key (no App setting sets the env vars). |

#### Leaves (model-involving) — app-setup (3 sites)

| file | symbol | line(s) | call | owner | path | trace | note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `extensions/onboarding/index.ts` | `presentDraft` | 444 | `pi.sendMessage{steer-when-streaming}` | onboarding ext | app-setup | n/a (setup) | Card preview sent from inside the setup tool; rides the live setup run as a steering message (no triggerTurn:false). Skipped under PI_COC_SETUP_AUTOSTART=1. |
| `extensions/onboarding/index.ts` | `on(session_start)` | 867 | `pi.sendMessage{steer-when-streaming}` | onboarding ext | app-setup | observed: coc-setup-opening | Setup opening message at session start; appended while idle, no run. |
| `pipicoc/onboarding-worker.ts` | `main` | 102 | `presentDocument` | pipicoc onboarding worker | app-setup | n/a (setup) | Guidance presenter child. |

#### Leaves (model-involving) — app-ui (14 sites)

| file | symbol | line(s) | call | owner | path | trace | note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `extensions/image-gen/agent/grok.js` | `grokGenerate` | 40 | `hostLibrary.generateImage` | image-gen (grok vendor) | app-ui | not observed | Grok image generation through the grok-build-oauth host library. |
| `extensions/image-gen/agent/index.js` | `dispatchImageOp` | 96 | `fetch` | image-gen | app-ui | not observed | Image model call; reached from PipiCOC portrait/illustration (pipicoc/sheet.ts, pipicoc/illustration.ts). image_gen/image_edit tools are registered but not in the Keeper's active set (kernel setActiveTools limits it to the COC verbs). |
| `extensions/image-gen/agent/vendors.js` | `openaiAdapter` | 177 | `fetch` | image-gen | app-ui | not observed | Per-vendor image model transport (one request, or create+poll for DashScope async). |
| `extensions/image-gen/agent/vendors.js` | `xaiAdapter` | 210 | `fetch` | image-gen | app-ui | not observed | Per-vendor image model transport (one request, or create+poll for DashScope async). |
| `extensions/image-gen/agent/vendors.js` | `arkAdapter` | 230 | `fetch` | image-gen | app-ui | not observed | Per-vendor image model transport (one request, or create+poll for DashScope async). |
| `extensions/image-gen/agent/vendors.js` | `geminiAdapter` | 252 | `fetch` | image-gen | app-ui | not observed | Per-vendor image model transport (one request, or create+poll for DashScope async). |
| `extensions/image-gen/agent/vendors.js` | `dashScopeSyncAdapter` | 288 | `fetch` | image-gen | app-ui | not observed | Per-vendor image model transport (one request, or create+poll for DashScope async). |
| `extensions/image-gen/agent/vendors.js` | `dashScopeAsyncAdapter` | 321 | `fetch` | image-gen | app-ui | not observed | Per-vendor image model transport (one request, or create+poll for DashScope async). |
| `extensions/mods/document-presentation.ts` | `documentPresentationStatus` | 40 | `presentDocument` | mods ext: document presentation | app-ui | not observed | Opens a paper's reading (presenter child, tool-enabled) on demand; not part of a turn. |
| `pipicoc/illustration.ts` | `defaultImageGenerator` | 81 | `generateImage` | pipicoc illustration | app-ui | not observed | Image model call. |
| `pipicoc/illustration.ts` | `writePrompt` | 176 | `runtime.runTask` | pipicoc illustration | app-ui | not observed | Two-round prompt-writer child for an illustration. |
| `pipicoc/mods.ts` | `invoke.runner` | 77 | `owner.runTask` | pipicoc Mods panel | app-ui | not observed | Document presentation child from the Mods panel. |
| `pipicoc/sheet.ts` | `defaultPortraitGenerator` | 105 | `generateImage` | pipicoc sheet | app-ui | not observed | Portrait image model call. |
| `pipicoc/ui-words.ts` | `uiWordsSurface.words.runner` | 70 | `runtime.runTask` | pipicoc UI words lane | app-ui | not observed | Presenter child projecting UI words. |

#### Leaves (model-involving) — settings-ui (2 sites)

| file | symbol | line(s) | call | owner | path | trace | note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `Electron/packages/pi-backend/src/index.ts` | `fetchCompatModelsCatalogStrict` | 2090 | `fetch` | pipiui settings (compatible provider) | settings-ui | n/a | Lists models of an operator-entered OpenAI-compatible host; settings only. |
| `Electron/packages/pi-backend/src/index.ts` | `runCompatModelTest` | 2176 | `fetch` | pipiui settings (compatible provider) | settings-ui | n/a | One test completion against an operator-entered host; settings only. |

#### Leaves (model-involving) — source-only (4 sites)

| file | symbol | line(s) | call | owner | path | trace | note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `runtime/jev/s0-decision.ts` | `createS0Decider` | 9 | `fetch` | S0 probe | source-only | n/a | S0 decider transport; only constructed by startS0Rpc. |
| `runtime/jev/s0-rpc.ts` | `startS0Rpc` | 42 | `createS0Decider` | S0 probe | source-only | n/a | Gate: PI_COC_JEV_S0=1 (or PI_COC_TASK_RUNTIME=1 in play), and startS0Rpc throws unless PI_COC_LAYOUT=source. |
| `runtime/jev/s0-rpc.ts` | `startS0Rpc` | 58 | `createDecisionAdapter` | S0 task mode | source-only | n/a | Adapter for the task host. |
| `runtime/jev/task-host-session.ts` | `createTaskHostAdapter.extension.on(tool_result)` | 481 | `incumbent.complete` | S0 task mode | source-only | n/a | Not a provider call: completes the incumbent (a scanner false positive kept so the key is stable). |

#### Infrastructure (no model) — app-play (16 sites)

| file | symbol | line(s) | call | owner | path | trace | note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `extensions/grok-build-oauth/agent/catalog.js` | `loadGrokBuildCatalog` | 116 | `fetch` | grok-build-oauth provider (Keeper model provider) | app-play | n/a | Model catalog of the Keeper's provider. |
| `extensions/grok-build-oauth/agent/files/client.js` | `FilesClient.constructor` | 59 | `fetch` | grok-build-oauth provider (Keeper model provider) | app-play | n/a | Files API client (input files); not a completion. |
| `extensions/grok-build-oauth/agent/files/service.js` | `createInputFilesService` | 8 | `fetch` | grok-build-oauth provider (Keeper model provider) | app-play | n/a | Files API service default fetch. |
| `extensions/grok-build-oauth/agent/host.js` | `createGrokBuildHostLibrary` | 51 | `fetch` | grok-build-oauth provider (Keeper model provider) | app-play | n/a | Host library default fetch (OAuth/relay plumbing). |
| `extensions/grok-build-oauth/agent/index.js` | `emit` | 33 | `fetch` | grok-build-oauth provider (Keeper model provider) | app-play | n/a | UI hint to the local host bridge (127.0.0.1). |
| `extensions/grok-build-oauth/agent/index.js` | `getBroker` | 63 | `fetch` | grok-build-oauth provider (Keeper model provider) | app-play | n/a | Credential broker default fetch. |
| `extensions/grok-build-oauth/agent/oauth/broker.js` | `GrokCredentialBroker.constructor` | 130 | `fetch` | grok-build-oauth provider (Keeper model provider) | app-play | n/a | OAuth credential broker. |
| `extensions/grok-build-oauth/agent/oauth/device.js` | `requestDeviceCode` | 71 | `fetch` | grok-build-oauth provider (Keeper model provider) | app-play | n/a | OAuth device flow. |
| `extensions/grok-build-oauth/agent/oauth/device.js` | `pollDeviceToken` | 120 | `fetch` | grok-build-oauth provider (Keeper model provider) | app-play | n/a | OAuth device flow. |
| `extensions/grok-build-oauth/agent/oauth/device.js` | `refreshAccessToken` | 201 | `fetch` | grok-build-oauth provider (Keeper model provider) | app-play | n/a | OAuth token refresh (runs on the Keeper path when the token expires). |
| `extensions/grok-build-oauth/agent/oauth/refresh.js` | `refreshCredentialUnlocked` | 65 | `fetch` | grok-build-oauth provider (Keeper model provider) | app-play | n/a | OAuth token refresh. |
| `extensions/grok-build-oauth/agent/structured-output-hooks.js` | `takeStructuredOutputViaBridge` | 25 | `fetch` | grok-build-oauth provider (Keeper model provider) | app-play | n/a | Local bridge for structured output hooks. |
| `extensions/kernel/client.ts` | `KernelClient.spawnChild` | 189 | `spawn` | kernel ext: kernel client | app-play | n/a | The kernel subprocess (build/kernel/rpc.mjs). JSON-RPC, no model. Pure parser/transaction process. |
| `pipicoc/rpc.mjs` | `launch` | 41 | `spawn` | pipicoc launcher | app-play | n/a | App: spawns launch.mjs (compiled) or bin/pi-coc (source) for play/setup. |
| `runtime/launch.ts` | `launchMain` | 111 | `spawn` | runtime launcher | app-play | n/a | Spawns the stock Pi CLI (`dist/cli.js --mode rpc`): the Keeper process whose AgentSession/agent loop is what the App runs. Replaced by startS0Rpc only under the S0 gates. |
| `runtime/process.ts` | `runHostProcess` | 9 | `spawn` | runtime tasks | app-play | n/a | Pure-parser subprocesses: the deterministic checker (build/kernel/check.mjs) and the PDF.js source worker (runtime/source-worker.ts). No model. |

#### Infrastructure (no model) — app-play-gated (3 sites)

| file | symbol | line(s) | call | owner | path | trace | note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `extensions/grok-build-oauth/agent/images/client.js` | `ImagesClient.constructor` | 131 | `fetch` | grok-build-oauth provider (Keeper model provider) | app-play-gated | n/a | Image API client; the grok image tools are disabled in Keeper sessions (PI_GROK_BUILD_IMAGE_TOOLS=0). |
| `extensions/grok-build-oauth/agent/index.js` | `runImageOp` | 251 | `fetch` | grok-build-oauth provider (Keeper model provider) | app-play-gated | n/a | Image op; tools disabled in Keeper sessions. |
| `extensions/grok-build-oauth/agent/index.js` | `runLegacyRelay` | 304 | `fetch` | grok-build-oauth provider (Keeper model provider) | app-play-gated | n/a | Image op via local relay; tools disabled in Keeper sessions. |

#### Infrastructure (no model) — app-setup (1 site)

| file | symbol | line(s) | call | owner | path | trace | note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `runtime/preparation.ts` | `createPreparationHost.start` | 29 | `spawn` | runtime preparation host | app-setup | n/a | Spawns the onboarding worker (pipicoc/onboarding-worker) for setup preparation. |

#### Infrastructure (no model) — no-caller (1 site)

| file | symbol | line(s) | call | owner | path | trace | note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `Electron/packages/pi-backend/src/session-title.ts` | `generateModelSessionTitle` | 148 | `options.spawn` | pipiui session titles | no-caller | n/a | Spawn half of the dead title generator. |

#### Infrastructure (no model) — host-infra (12 sites)

| file | symbol | line(s) | call | owner | path | trace | note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `Electron/packages/pi-backend/src/browser-watch-bridge.ts` | `BrowserWatchCallbackRegistry.deliver` | 86 | `fetch` | pipiui browser pane | host-infra | n/a | Local browser-watch callback; no model host. |
| `Electron/packages/pi-backend/src/browser-watch-bridge.ts` | `postBrowserWatchTrigger` | 264 | `fetch` | pipiui browser pane | host-infra | n/a | Local browser-watch trigger; no model host. |
| `Electron/packages/pi-backend/src/extension-host-workers.ts` | `ExtensionHostWorkers.start` | 131 | `this.spawnImpl` | pipiui extension host | host-infra | n/a | Extension host worker processes; no model loop. |
| `Electron/packages/pi-backend/src/extension-update-engine.ts` | `checkExtensionUpdate` | 927 | `globalThis.fetch` | pipiui update center | host-infra | n/a | Update manifest fetch. |
| `Electron/packages/pi-backend/src/extension-update-engine.ts` | `applyExtensionUpdate` | 1091 | `globalThis.fetch` | pipiui update center | host-infra | n/a | Update archive fetch. |
| `Electron/packages/pi-backend/src/external-auth-runtime.ts` | `spawnWorker` | 71 | `spawn` | pipiui auth | host-infra | n/a | Resident auth helper process. |
| `Electron/packages/pi-backend/src/external-auth-runtime.ts` | `ExternalAuthRuntime.login` | 282 | `spawn` | pipiui auth | host-infra | n/a | Interactive login helper process. |
| `Electron/packages/pi-backend/src/index.ts` | `PiHostBackend.sweepSessionAgents` | 12270 | `{type: prompt}` | pipiui subagent panel | host-infra | n/a | `/subagent_abort_all` slash command; commands are dispatched before any run starts (host contract 3.5). No subagent extension is mounted in coc-keeper sessions. |
| `Electron/packages/pi-backend/src/index.ts` | `PiHostBackend.agentCommand` | 12307, 12342 | `{type: prompt}` | pipiui subagent panel | host-infra | n/a | `/subagent_abort\|resolve` slash commands; not a run. Not mounted in coc-keeper sessions. |
| `Electron/packages/pi-backend/src/managed-npm.ts` | `runNpm` | 46 | `spawn` | pipiui extension installer | host-infra | n/a | npm for managed extensions. |
| `pipicoc/host-bridge.ts` | `emitToPanel` | 57 | `fetch` | pipicoc panels | host-infra | n/a | Local panel bridge (127.0.0.1). |

## 5. Reader and Mod subprocesses (design §8.3)

Every model-bearing child goes through one funnel, `runtime/tasks.ts` `runTask` → `extensions/module/reader.ts`
`runReader`/`runOwnedReader`, which spawns a **stock Pi agent**: `pi -p --no-session --no-context-files
--no-extensions --no-skills --tools <list> --mode json` (plus, for some roles, one explicitly loaded private extension:
`reader-context`, `reader-submit`, `adaptation-submit`, `audit-submit`). Each is therefore a multi-round model↔tool
loop by construction; the question for the single loop is which of them decide inside the current player turn.

| child (runTask kind) | started from | tools | in the current turn? | classification |
| --- | --- | --- | --- | --- |
| Mod definition agent (`mod`, roles create/usage/audit) | `extensions/mods/index.ts` `task`, via `mods.prepare` inside `resolve`/`apply` | read,write,edit(,bash) | **yes** when the definition must exist before the operation (`materialize`); deferred otherwise (§129) | decision-bearing loop; flatten into scope/steps when foreground |
| Continuity review (`mod`, narration-audit) | `runContinuityReview` | read,write,edit,bash + `audit-submit` | post mode (default): after delivery, but its verdict can pause review and strand later turns (§38); pre mode: **gates delivery** | decision-bearing loop |
| Source reader (`reader`: skeleton/opening/detail/answer/guidance/index) | `ReadingService.runJob(.run)` from `lookup kind=source`, `material_pending`, table open | read,write,edit,bash + `reader-context`/`reader-submit` | **yes** while the Keeper tool waits (up to 120 s), then background | decision-bearing loop (reads, drafts, self-checks, submits) |
| Adaptation creator/reviewer (`reader`) | `adaptation.ts` `run` (a host `while (task)` loop) from `lookup kind=adaptation` | read,write,edit,bash + `adaptation-submit` | **yes** for `PI_COC_ADAPTATION_WAIT_MS`, then background | decision-bearing loop, inside a host loop |
| NPC author, voice author, usage prefetch (`mod`) | `npc/writer.ts`, `npc-voice/writer.ts`, mods | read,write,edit,bash | no (background) | loop, independent root |
| Presenters: document reading, map words, UI words, illustration prompt, guidance (`mod`/`reader`) | `presentDocument`, `ensureMapWords`, `pipicoc/ui-words.ts`, `pipicoc/illustration.ts`, onboarding | read,write,edit(,bash) | no | loop, projection only |

Pure parsers — no model, keep as they are: the kernel (`KernelClient.spawnChild` → `build/kernel/rpc.mjs`, JSON-RPC
transactions), the deterministic checker and the PDF.js source worker (both through `runtime/process.ts`
`runHostProcess`: `build/kernel/check.mjs`, `runtime/source-worker.ts` info/page/search/text). The preparation host
(`runtime/preparation.ts`) is not a parser: it spawns the onboarding worker, which itself runs reader and presenter
children (setup only).

## 6. Consumers of new run/step events (design §9.1)

| consumer | location | consumes today | status | what a hybrid run breaks |
| --- | --- | --- | --- | --- |
| Pi RPC forwarder | Pi `dist/modes/rpc/rpc-mode.js` (`src/modes/rpc/rpc-mode.ts` L355–356: `session.subscribe(event => output(toJsonEvent(event)))`) | every `AgentSessionEvent` | located; part of the Pi patch | new events are forwarded only if `AgentSession` emits them to its subscribers |
| pi-backend event intake | `Electron/packages/pi-backend/src/index.ts` `PiHostBackend.lines` L6269 → `rpcEvent` L6284 | `entry_appended`, `message_*`, `agent_start`, `agent_settled`, `agent_stopped`/`agent_error`, `auto_retry_*`, `compaction_*`, `queue_update`, `tool_execution_*` | **audited** (lifecycle part) | `agent_start` marks the queue busy and `agent_settled` releases it — fine; but the turn watchdog's activity clock (`touchTurnActivity`, L7083) is touched only by `message_update` (L6575), `message_end` (L6673) and `tool_execution_end` (L6827), and `checkTurnWatchdogs` (L7228) aborts after `TURN_WATCHDOG_TIMEOUT_MS` = 120 s of no activity. A hybrid run that spends > 120 s in Jev/host steps before a model message is killed. `assistantMessageStartedAt` (L6369) is "the only event that says a provider call has gone in flight" |
| pi-backend telemetry | `turn-telemetry.ts` L528–563, `tool-batch-telemetry.ts` L343–370, `compaction-diagnostics.ts` | `agent_start`, `message_update`, `message_end`, `tool_execution_*`, compaction | not yet audited | first-token and batch timings are defined on model messages only |
| Host → UI stream | `Electron/packages/host-api/src/index.ts` `StreamEvent` L886–976 | `status` (started/streaming/settled/stopped), `text`, `thinking`, `tool_call`, `tool_result`, `presentation`, `auto_retry`, `compaction`, `queue_update` | located, not yet audited | no event type for a step, scope or Jev decision |
| UI transcript and busy state | `Electron/packages/ui/src/App.tsx` session stream handler L1804–1970 (`status`, waiting phase from `thinking`/`tool_call`/`tool_result`); `Transcript.tsx`, `transcript-model.ts`, `useSessionQueue.ts` | host `StreamEvent` | located, not yet audited | the waiting indicator has phases thinking/tool only |
| Remote web | `Electron/apps/server/src/index.ts` (relays the host protocol) | host protocol frames | not yet audited | same as the UI; deployed separately |
| Session history reader | pi-backend `readHistory` via in-process `SessionManager` from its own `pi-coding-agent` copy (L1732–1745), `visibleHistoryEntry`, `projectHostDeliveries` | session JSONL entries | not yet audited | new session entry types must be readable by the backend's Pi copy — the patched build must be the one pi-backend loads too |
| Play driver | `tests/play/driver.py` `_run_turn` L555–651 | `agent_start` (clears draft text), `message_update`, `message_end`, `tool_execution_*`, `entry_appended`, `agent_end` (`willRetry`), `agent_settled` (turn end) | **audited** | `saw_work` is set only by message/tool events (L566–571); an `agent_settled` before any of them is counted as the previous run's settle (`stale_settles`) and the driver keeps waiting. A hybrid run whose host steps precede the first model message still ends in `agent_settled`, so it is survivable, but step events are invisible to its evidence (`turn-<n>.json`) |
| KPI | `tests/play/kpi.py` | campaign telemetry and turn records | not yet audited | reads `provider-*` and lane rows; step rows are new |
| Kernel extension's own run bookkeeping | `extensions/kernel/index.ts` handlers `agent_start`/`agent_end`/`agent_settled`/`turn_end`/`message_end` | Pi extension events | not yet audited | `steeredThisTurn`, `runAbandoned`, implicit narrate at `message_end`, input release at `agent_settled` all assume Pi's run shape |
| thinking-schedule | `extensions/thinking-schedule` | `before_agent_start`, `turn_end`, `agent_settled` | not yet audited | continuation thinking is keyed on `turn_end` of a tool batch |

## 7. Not classified, and limits of the scan

- **Calls reached through a callback parameter** are keyed where the callback is built, not where it is invoked:
  `presentDocument(…, runner)`, `prepareMapWords(options)` with `options.runner`, the illustration `runner`, the
  `navigateFresh` dependency. The owner rows name both ends.
- **Provider requests inside Pi `dist`** (the Keeper's `streamFn` → `modelRuntime.streamSimple`, retries,
  compaction summaries) are outside the scanned trees by design; §8 records them.
- **`rerank`**: the call chain `rankWorkspaceCandidates` → `rerank` (imported as `rerankClient`) → `rerankDocuments`
  is only caught at the `fetch`; a new caller of `rerank` would not be flagged.
- **`sendMessage` with a non-literal options object** is recorded as `dynamic` (none exists today).
- **Callers of an inventoried owner function** (e.g. who calls `lookupKeeperSupport` or `reviewAdmission`) are not
  keys; only the call sites of the listed primitives are.
- **`runtime/jev/task-host-session.ts` `incumbent.complete`** is not a provider call (it completes the task
  incumbent); it is kept as a keyed entry so the guard stays stable.
- **`extensions/table/prescreen-loop.ts` `runPrescreenLoop`** has no caller.
- **`Electron/packages/pi-backend/src/session-title.ts` `generateModelSessionTitle`** has no caller in pi-backend;
  whether Electron's app layer calls it was not traced (the app tree is outside the ticket's four trees).
- `tests/play/driver.py` issues RPC `prompt` commands itself; it is outside the scanned trees (a test harness).
- Nothing was left without a classification.

## 8. Pi citations re-read against 0.87.0

Lines are in the TypeScript source embedded in each `dist/*.js.map` (`sourcesContent`); the shipped JS line is given
where it helps. The proposal cites `earendil-works/pi@v0.85.1`; the product runs 0.87.0 (upstream tag `v0.87.0` →
`16787ad5b2dc748047f314ca1bfe7708f30f54f3`).

| proposal citation | shipped equivalent (0.87.0) | lines | differs from the proposal |
| --- | --- | --- | --- |
| C03 `packages/agent/src/agent-loop.ts` `runLoop()`: stream the assistant response first, then execute tool calls; continue/stop around tool calls, steering and follow-up; `prepareNextTurn` updates context/model/thinking | `pi-agent-core/dist/agent-loop.js` `runLoop` (JS L79); `agentLoop` 37–60, `agentLoopContinue` 70–99, `runAgentLoop` 101–125, `runAgentLoopContinue` 127–150, `streamAssistantResponse` 380–466, `executeToolCalls` 505–520 (sequential 527–581, parallel 583–657), `shouldTerminateToolBatch` 685–687 | `runLoop` 162–320 | Still model-first: every inner iteration calls `streamAssistantResponse` (L241). New in 0.86/0.87: **`prepareRequest`** runs before every request and may replace context, model and thinking (L218–237); **`finishTurn`** replaces the removed `shouldStopAfterTurn` and may return `{action: "end"}` or `{action: "continue"}` — `continue` with nothing queued buys **one context-only request** (`explicitContinuation`, L293–313); a tool result with `terminate` ends the batch (`shouldTerminateToolBatch`). Errors/aborts end the loop immediately after `finishTurn` (L244–255) |
| C18 `packages/agent/src/agent.ts`: AgentOptions, queues, state | `pi-agent-core/dist/agent.js`; `AgentOptions` 114–140; `class Agent` 187–609; `prompt` 368–378 (JS L241); `continue` 381–408 (JS L249); `runPromptMessages` 429–443; `runContinuation` 445–455; `createLoopConfig` 464–501 (JS L301); `runWithLifecycle` 503–526 (JS L338); `handleRunFailure` 528–544; `finishRun` 546–552; `processEvents` 561–608; `steer` 296–298; `followUp` 301–303; `abort` 338–340 | — | `AgentOptions` now carries `finishTurn`, `prepareRequest`, `prepareNextTurnWithContext`. `prompt()` throws while `activeRun` is set; `continue()` from an assistant message drains steering then follow-up queues and otherwise throws. Busy is `activeRun` + `state.isStreaming` (set for the whole run in `runWithLifecycle`, not only while tokens stream) |
| C18 `packages/agent/src/types.ts`: StreamFn, loop config | `pi-agent-core/dist/types.d.ts`; `StreamFn` 33–37; `AgentTurnDecision` 143; `FinishTurn` 151–154; `AgentLoopTurnUpdate` 157–166; `PrepareRequest` 182–185; `PrepareNextTurnContext` 187; `AgentLoopConfig` 189–338; `AgentState` 378–417; `AgentToolResult` 420–432; `AgentTool` 443–468; `AgentContext` 471–476; `AgentEvent` 485–500 | — | `AgentEvent` is still only agent/turn/message/tool_execution events — no run or step identity. `AgentLoopConfig` gained `finishTurn` and `prepareRequest` |
| C06 `packages/coding-agent/src/core/agent-session.ts` L990–1160: `_runAgentPrompt` = `await agent.prompt(); while (await _handlePostAgentRun()) await agent.continue()` | `pi-coding-agent/dist/core/agent-session.js`; `_runAgentPrompt` (JS L1078); `_handlePostAgentRun` (JS L1106); `_runBeforeSettleBoundary` (JS L1142); `_emitAgentSettled` 870–891 | `_runAgentPrompt` **1468–1490**; `_handlePostAgentRun` **1492–1529**; `_runBeforeSettleBoundary` **1531–1553** | The post-run loop is still there and has **two** `agent.continue()` sites: after `_handlePostAgentRun()` returns true (retryable error after `_prepareRetry` 3379–3419, overflow compaction via `_checkCompaction` 2599–2735, or messages queued by `agent_end` handlers), and after the new **`agent_before_settle`** extension boundary returns `continue: true` or finds queued messages. Both are guarded by `_agentRunAbortRequested`. `agent_settled` is emitted in the `finally`; actions requested during it are deferred (`_deferredSettledActions`) and run after the handlers — themselves new `_runAgentPrompt` calls. So a hybrid run must stop **both** continuation sites, not one |
| C19 agent-session.ts L500–810: tool hooks, next-turn refresh, event forwarding, message persistence | `_installAgentToolHooks` 529–585; `_compactBeforeNextAssistantResponse` 587–606; `_installAgentRequestProjection` 608–633; `_dispatchTurnEndBoundary` 635–673; `_installAgentBoundaryHooks` 675–685; `_installAgentNextTurnRefresh` 687–724; `_handleAgentEvent` 894–974 (JS L556); `_emitExtensionEvent` 1062–1139 | — | Persistence is as described (`message_end` appends, `turn_end` flushes deferred custom messages, retry state keyed on assistant messages). New: **`SessionManager` is canonical for request context** — `_installAgentRequestProjection` rebuilds `context.messages` from `sessionManager.buildSessionProjection()` before every request, so what the provider sees is what was persisted, not `agent.state.messages`; `turn_end` is now an actionable boundary whose handlers can append entries and request continuation (`_dispatchTurnEndBoundary` → `finishTurn`). A step that is not persisted is invisible to the next request |
| C13 `sdk.ts`, `agent-session-services.ts`: `createAgentSessionFromServices → createAgentSession` passes options one by one | `pi-coding-agent/dist/core/sdk.js` `createAgentSession` 175–439 (JS L67; `CreateAgentSessionOptions` 41–90); the `Agent` is built at 366–399 (JS L224) with `streamFn` → `modelRuntime.streamSimple` (after `mergeProviderAttributionHeaders` in `buildRequestOptions` 311–337), `onPayload`/`onResponse` → `before_provider_request`/`after_provider_response`, `transformContext` → `context` handlers; `new AgentSession` 415–430. `agent-session-services.js` `createAgentSessionServices` 135–193, `createAgentSessionFromServices` 202–221 (JS L116) | — | As described: `createAgentSessionFromServices` forwards fourteen named fields and nothing else, so any new option (policy/execution ports) must be threaded through both functions and `CreateAgentSessionOptions`. `finishTurn`/`prepareRequest` are not SDK options: `AgentSession` installs them on the agent itself (`_installAgentBoundaryHooks`, `_installAgentRequestProjection`), wrapping any pre-existing value |
| §2.2 C04/C05 product `task-host-session.ts`, `task-runtime.ts` | `runtime/jev/task-host-session.ts` `on(before_agent_start)` → `runtime.begin` L402; tool `submit_plan_packet` → `runtime.submit` L568; `TaskRuntime.submit`/`resume` → `#run` L182/L249, `#run` L354 | — | Accurate; gated source-only (`startS0Rpc`) |
| §2.4 C07/C08 `source.consult`, `memory.search` recursive submit | `source-owner-operations.ts` `register('source.consult')` L138 → `begin({parentId})` L141, `submit` L145; `memory-read-owner.ts` `registerOwned('memory.search')` L48 → `begin` L58, `submit` L63 | — | Accurate; both registered only by task-host-session (source-only) |
| §8.3 C17 `runtime/tasks.ts` `runTask → runReader` | `runtime/tasks.ts` `runTask` L250, `runReader` call L289 | — | Accurate; also the only child funnel (§5) |
| §12.2 C01 `startS0Rpc` limits source-mode play RPC | `runtime/jev/s0-rpc.ts` L11–13 | — | Accurate |

Citations that were wrong or stale:

1. **Pi baseline** v0.85.1 (`d981de12…`) → the product runs 0.87.0 (`16787ad5…`); `pipicoc/runtime-dependencies.json`
   pins 0.87.0, not 0.85.1 (C02).
2. **Product baseline** `0.9.4a@86078fd` → `0.9.5a@0b729e8fb`.
3. **C06** line window L990–1160 → `_runAgentPrompt`/`_handlePostAgentRun` are at 1468–1529, and the loop now has a
   second `agent.continue()` site (`agent_before_settle`) the proposal does not mention.
4. **C19** L500–810 → spread over 529–1139; the proposal's "message persistence" description is right, but it misses
   that persistence is now the request context (`SessionManager` canonical).
5. **C03** — the model-first description holds, but `finishTurn: {action: "continue"}` and `prepareRequest` are new
   levers the proposal's "prepareNextTurn is not a non-model step protocol" paragraph does not account for.
6. **Design §2 framing** — "dismantle the second loop" names TaskRuntime; on the App, TaskRuntime never runs. The
   non-Pi loops on the App's play path are the prescreen's Jev evidence loop, the `agent_end` steer policy and the
   tool-enabled children inside Keeper tools (§3). (The spec's Further Notes already correct the TaskRuntime part.)
