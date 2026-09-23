Status: ready-for-human
Stage: SL-01
Spec: docs/specs/pi-native-single-loop.md

# SL-01 — Pi-native RunDriver with non-model steps, behind PI_COC_LOOP_ENGINE=hybrid-v1

Implement StepRequest, RunView, the RunDriver and the injected ports in Pi agent-core (from the vendored snapshot SL-00 fixed), thread the options through coding-agent's SDK and session services, and prove that a policy-origin read runs before the first model message.

## Depends on

- SL-00 accepted (baseline, inventory, ADR, vendored Pi).

## Scope

- agent-core: `StepRequest` (`decide` | `infer` | `operate` | `scope` | `wait` | `finish`), `RunPolicy.next(view)` (pure), `RunView`, `ObservationView`, run/step/scope/operation/delivery events with run id, step id, sequence, scope id, origin, visibility, schema version; the driver loop of the design's §4.3 with step identity separated from provider attempt identity; abort that revokes permission at once during a Jev or tool wait.
- The policy port ships with the prototype's `next`/`interpretRoute`/gates/guards moved into the product (`runtime/jev/`), and `experiments/single-loop-routing/loop.test.mjs` re-pointed at it and green.
- coding-agent: SDK and `agent-session-services` pass the ports; `agent-session` on the hybrid path awaits one driver run and does not enter the post-run `continue()` loop; retry and compaction become steps.
- The product's launch selects `hybrid-v1` or `legacy` by `PI_COC_LOOP_ENGINE`; the startup record carries the engine, protocol version, Pi base and patch digest.
- A test DecisionPort (stub) drives a real read-only operation and then one real model output through the real provider path.

## Rulings that bind this ticket (spec, "Rulings")

- Pi 0.87.0 vendored under `vendor/pi/` per ADR-0006 (source recovered from the packages' `.js.map`, verified byte for byte against upstream tag `v0.87.0`); one patched build reaches both the session runtime and pi-backend's in-process copy; stock and patched agent-core never both load.
- Stop both `continue()` sites in `_handlePostAgentRun` on the hybrid path; account for `prepareRequest` and `finishTurn`.
- The driver reports activity to pi-backend's turn watchdog during host and Jev steps.
- Run/step events carry the clerk's steps so the UI can draw cards as they land; the compose step streams raw prose (the UI's replacement-by-card is SL-02's).
- Play mode only; `PI_COC_LOOP_ENGINE=legacy` unchanged as the control arm.

## Acceptance (design §13 SL-01 gate + SL-A01/A02/A05/A08/A09)

- A policy-origin read executes before the first LLM response; `TaskRuntime.#run` is never called on the hybrid path; events are complete; abort during a Jev/tool wait revokes at once; no fabricated assistant message, usage or tool result; no `agent.continue()` second loop.
- `npm run test:ext` and the kernel pytest green; the legacy engine unchanged when selected.

## Comments

### 2026-09-23 — implemented on `claude/sl01-run-driver-20260923` (from 0.9.5a `d29fba981`)

Commits: stage A `3f1dd60cd` (vendored Pi, one copy), stage B `d0477d6b9` (RunDriver in agent-core), stage C
`b07806957` (session layer, hybrid engine, `PI_COC_LOOP_ENGINE`, watchdog), stage D is the commit that carries this
comment (the gate test).

**Vendored Pi (ADR-0006).** `vendor/pi/` = `packages/agent` + `packages/coding-agent` of tag `v0.87.0`
(`16787ad5`), fetched with a shallow blobless fetch of that one tag. All 116 + 216 `sourcesContent` of the installed
0.87.0 maps equal the tag's files, and `scripts/build-pi.mjs` (run first by `npm run build:runtime`) rebuilds all 335
published `.js` modules byte for byte (tsgo emitted define-semantics class fields despite
`useDefineForClassFields: false`; the build follows what shipped). `vendor/pi/VENDOR.md` records it; the series is
`vendor/pi/patches/0001-agent-core-run-driver.patch`, `0002-session-run-driver.patch`, one line per patched file in
`vendor/pi/PATCHES.md`: agent-core `run-driver.ts` (added), `agent-loop.ts` (export keywords only), `agent.ts`
(`runDriven`), `types.ts` (`AgentEvent | RunEvent`), `index.ts`; coding-agent `agent-session.ts`, `sdk.ts`,
`agent-session-services.ts`, `main.ts`, `index.ts`.

**Exactly one copy.** The build lands in `build/node_modules/@earendil-works/`, the first `node_modules` every emitted
module under `build/` resolves through. `runtimeEntrypoints().pi` (Keeper launch, every reader/Mod child) and
`deployment.pi` point at its `dist/cli.js`; `.piModule` at its `dist/index.js`, which the Electron main passes to
pi-backend (`PiBackendOptions.piModule`) for its in-process `SessionManager`/`ModelRuntime`; the auth helper finds the
package from `PIPIUI_PI_PATH`; the standalone manifest ships `build/node_modules`. The extension test seam imports Pi
through `tests/extension/pi.mjs`, so the whole suite runs on the vendored build. `tests/extension/vendored-pi.test.mjs`
re-checks the admission and the byte-identical emit for every file the series does not touch, the series/PATCHES/digest
agreement, and single-copy loading: a child process with a module load hook imports pi-backend's entry, the Keeper
CLI's `main.js` graph and an emitted extension, sees exactly one agent-core root and one coding-agent root (both under
`build/node_modules`), and a session built through pi-backend's import has an `agent` that is an instance of the
vendored agent-core `Agent`. `Electron/packages/pi-backend/test/vendored-pi-module.test.ts` pins the backend loader.

**The two `continue()` sites.** With a `SessionRunDriver`, `_runAgentPrompt` goes to `_runDrivenPrompt`, which awaits
one `agent.runDriven` and reaches neither the `_handlePostAgentRun` → `continue()` loop nor the `agent_before_settle` →
`continue()`; the before-settle boundary is still dispatched to extensions when they have handlers, and a continuation
it asks for is not taken. Retry (`_prepareRetry`) and overflow compaction (`_checkCompaction`) become further provider
attempts of the same infer step (`_recoverDrivenAttempt`; `step_attempt` events, attempt ids `<stepId>#aN`). The gate
test counts calls of the live session's `agent.continue`: zero.

**`prepareRequest` / `prepareNextTurn` / `finishTurn`.** `prepareRequest` (the SessionManager request projection and
the forced-prompt wrapper) runs before every provider attempt of every infer step, as before every request today; no
decide/operate step makes a request, so it never runs for them. `prepareNextTurn` (threshold compaction, prompt/tool
loadout refresh) runs before every infer step after the run's first. `finishTurn` runs when a model turn closes -- the
response and all its tool results in, or at once for a tool-less response -- and `turn_end` follows, so extensions keep
the same turn meaning (one model response + its results); a `{action: "continue"}` it returns never buys a request: it
is put in the run view as the `turn_boundary_continue` requirement for the policy (the SL-01 policy does not act on it),
and `{action: "end"}` is not honoured either (the policy ends runs). Steering messages are taken before every infer;
follow-ups queued behind a run by the first infer of the next run (a driven run never continues after it ends).

**Watchdog.** `RUN_ACTIVITY_EVENTS` in pi-backend: every run/step/scope/operation/delivery event touches the turn
activity clock like `message_update` and `tool_execution_end`; `turn-watchdog.test.ts` shows a non-activity event
leaves the silence standing, each run event resets it, and a run whose last event was a step is not aborted.

**Engine switch and startup record.** `runtime/loop-engine.ts`: `PI_COC_LOOP_ENGINE=hybrid-v1|legacy` (default
legacy; setup always legacy; anything else refused). `runtime/launch.ts` starts the same Pi arguments through
`build/runtime/pi-hybrid.mjs` for hybrid-v1, which runs the vendored Pi's own `main` with the engine's
`SessionRunDriver` and inline extension; the child gets the resolved engine. The kernel extension writes a
`lane: "startup"` row at table open: `loop_engine`, `loop_protocol_version` (`hybrid-v1/events-1` or `legacy`), Pi
version, base tag and commit, patch-series digest, layout. (There was no startup record before; this is the first.)

**Policy.** `runtime/jev/step-policy.ts` holds the prototype's `next`, `interpretRoute`, `routeBatch`, `bindBatch`,
`interpretBind`, gates, guards and precedence under their names, plus the transitions (`startStep`, `settle*`) that both
the prototype's `runTurn` and `createStepPolicy` (the Pi `RunPolicy`) fold steps with. `loop.test.mjs` imports the
policy from there and stays 10/10; `run-entry.ts` too.

**Tests.** `npm run test:ext` 2582/2582 at stage D (0.9.5a baseline 2563; +5 vendored-pi, +8 run-driver-core, +4
gate, +2 launch engine). `tests/play` (driver tests incl. the real-Pi RPC smoke, now on the vendored CLI) 141 passed, 1
skipped (no local `haunting-s0` telemetry). No kernel pytest file was touched. pi-backend vitest judged by failing
names against a baseline run of `d29fba981` in a clean worktree: no new failure that reproduces; the names that differed
between full runs (`agent-aging` benchmark timeout, `subagent-dispatch-model`, `turn-telemetry-backend`,
`project-pi-isolation`, `terminal-projection`) pass when run alone, and a second full run of the baseline itself failed `agent-aging` and `queue-backend` the same
way (timing under load; baseline full runs: 185 and 187 failing names).
Replay `node experiments/single-loop-routing/run.mjs --fixture turn3 --runs 1 --llm replay` (Jev key read from the
App's vault, read-only): 8/8 live actions matched, 5 LLM steps, 20 Jev calls / 6.4 s, no misses.

**Gate (`tests/extension/single-loop-run-driver.test.mjs`).** Hybrid session on the vendored build, product engine,
stub Jev `DecisionPort`, fake kernel, faux provider through Pi's provider path: read-only `table.capsule` +
`table.status` (policy origin) → one Jev route decision (a real packed batch over the capsule's binding) → one provider
request → one assistant message whose `narrate` call executes once with a paired result → `delivery_accepted` →
`run_end delivered`; steps `operate, decide, infer, operate, finish`; every run event carries run id, sequence, scope,
origin, visibility, schema version, in order; one run_start/run_end (SL-A01); the read and Jev step precede the first
model message (SL-A02); the same run after the infer (SL-A05); no synthetic assistant message, no decision in any
message, one tool result per real call (SL-A08); zero `agent.continue` (SL-A09); no task store anywhere in the
workspace (TaskRuntime never began a task). Abort during the Jev wait: `run_end aborted` within the same tick, the Jev
lease is revoked, no provider request, no assistant message or tool result, no kernel write, no operation prepared
after the decide. Without a Jev key every decide degrades to the Keeper inside the same run; with the switch unset the
session is legacy and emits no run events.

**Left out, deliberately (later stages).** Host-issued candidates (SL-02): a route asks only its exit; policy-origin
writes are refused (`policy_write_not_in_sl01`); locate and ordinary-bind deciders answer `unavailable` (Keeper). The
prescreen still runs in `before_agent_start` (not yet the read/decide steps, SL-02). The kernel's `agent_end`
turn-close steers are not continued on hybrid; they stay queued and reach the next run's first model step (the
turn-close policy becomes the driver's, SL-03). A prose-only answer delivered by the kernel's implicit narrate is not
seen by the driver, so such a run ends `undelivered` in the run events although the table delivered (SL-03 delivery).
No projection port yet (the capsule's "clerk did" section, SL-02). Retry/compaction are attempts, not separate steps.
No service notice on a driver failure (only `run_end failed`). UI/host-api consumers of run events are not audited
beyond the watchdog (pi-backend passes unknown event types through); the busy-state split of design §9.3 is not added;
scope frames exist in the core only. No live table (the stage gate is at SL-02), no packaging. ADR-0006's
re-derivation script is not written: the admission test checks every untouched file against the published maps instead.

