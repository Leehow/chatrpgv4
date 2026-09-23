Status: ready-for-agent
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
