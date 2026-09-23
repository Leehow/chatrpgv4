Status: ready-for-human
Stage: SL-00
Spec: docs/specs/pi-native-single-loop.md

# SL-00 — Freeze the baseline and inventory every driver of control

Fix the control arm and list, from traces and call sites, everything that today can start or continue a run.

## Depends on

- Nothing. Runs on `0.9.5a` as branched.

## Scope

- Pin the baselines the spec names: product commit on 0.9.5a, Pi 0.87.0 (`@earendil-works/pi-agent-core`, `pi-coding-agent`, `pi-ai`), the emitted kernel, the Mod lock, models and thinking levels, the fast-model setting. Record them in the ticket's evidence file.
- Inventory, with file and line, every path that calls `agent.prompt`/`agent.continue`, `runtime.submit`/`TaskRuntime.#run`, `runReader`, `runTask`, `runLane`, `presentDocument`, and every provider call outside them; for each, its owner, whether it runs on the installed App's play path, and whether it carries semantic decisions (a loop) or only parses. Output: `docs/specs/pi-native-single-loop-tickets/inventory-SL-00.md`.
- Re-read the design proposal's Pi citations against 0.87.0 (`agent-loop.ts` runLoop, `agent-session.ts` `_runAgentPrompt`/`_handlePostAgentRun`, `sdk.ts`, `agent-session-services.ts`, `types.ts`, `agent.ts`) and write the corrected line ranges into the inventory.
- Write the superseding ADR (`docs/adr/0006-pi-native-single-loop.md`): Pi is consumed from a reviewable source snapshot and patched; supersedes ADR-0002's consequence and the "no fork" clause of `docs/pi-host-contract.md`; states the one build authority (`vendor/pi/` or a controlled fork at a fixed commit) and the upgrade procedure.
- Record the paired-measurement plan: fixture tables, inputs, models, metrics (first visible prose, formal delivery, provider calls, tokens, cost, retries, cancellations), and pre-registered thresholds. No runs yet.

## Not in scope

- Any code change to Pi or the product loop.

## Acceptance

- The inventory names every entry point with a trace-backed classification (loop vs parser; on the App path or not), and a test (`tests/extension/control-flow-inventory.test.mjs`) fails if a new call to one of the listed functions appears outside the inventory.
- The ADR is committed and linked from `docs/pi-host-contract.md`.
- `npm run test:ext` green.

## Comments

**2026-09-23, SL-00 worker (Claude, branch `claude/sl00-inventory-20260923` at `0b729e8fb`).** Delivered: `baseline-SL-00.md`
(baselines + pre-registered paired-measurement plan, no runs), `inventory-SL-00.md` + `inventory-SL-00.json` (127 call sites
under 121 keys), `docs/adr/0006-pi-native-single-loop.md` (Proposed) with a pointer in `docs/pi-host-contract.md`, and the
guard `tests/extension/control-flow-inventory.test.mjs` (scanner `control-flow-scan.mjs`; shown failing on a scratch
`runLane` call, then passing without it). Ready for the owner's review of the classification and the ADR choice.

What I found:

- The App's play path has 22 driver sites (17 by default, 5 behind a gate) and 29 model leaves. TaskRuntime is not one
  of them: every TaskRuntime/S0 site is source-only, except fresh-source navigation, which is env-gated
  (`PI_COC_TASK_RUNTIME=1` + `PI_COC_JEV_SOURCE=1`) outside the source-mode check and set by no App setting.
- The loops that do run beside Pi's on a live turn are (a) the prescreen's Jev evidence loop (`runEvidenceAgent`, a
  `while` of decide → read → cycle, before the first Keeper request of every input — trace: `loop_decision`/`loop_cycle`
  rows), (b) the kernel's `agent_end` steer policy, which `_handlePostAgentRun` turns into `agent.continue()` (trace: the
  speech steer at turn 2 bought two more Keeper calls), and (c) tool-enabled Pi children inside Keeper tools (Mod
  definition agents, source reads, adaptation). None of these is in the ticket's function list; `runEvidenceAgent` was
  added to the scan as `jev-loop`.
- Pi 0.87.0 still has the session-layer continue loop, now with a second `agent.continue()` site (`agent_before_settle`),
  and makes `SessionManager` the request context. The proposal's C06/C19 line windows and its 0.85.1/0.9.4a baselines
  are stale; details in inventory §8.
- The npm packages ship `dist` only, but their source maps embed the full TypeScript source, and tag `v0.87.0`
  (`16787ad5…`) is reachable — so the ADR recommends `vendor/pi/` from the tag, with the source maps as the admission
  check, over a fork.

What surprised me:

- A `pi.sendMessage` without `triggerTurn: false` is a steer while a run streams; seven of the 18 trigger-turn sites
  (five service notices, two onboarding messages) are of this kind and rely on being sent while idle.
- pi-backend's turn watchdog counts activity only on model message and tool-end events; a hybrid run that spends 120 s
  in host/Jev steps before its first model message would be aborted.
- pi-backend loads its own `pi-coding-agent` in-process (SessionManager, ModelRuntime), so the patched build must reach it too.
- The retained live session ran the fast model at `low`; the App setting today is `off`. The live campaign locks
  `narration-audit` 1.2.30, the source is 1.2.31.
