Status: ready-for-agent
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
