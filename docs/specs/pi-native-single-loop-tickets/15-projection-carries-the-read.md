Status: ready-for-agent
Stage: SL-15 (extends SL-11; independent of SL-13/SL-14)
Spec: docs/specs/pi-native-single-loop.md (Ruling: "The Keeper is shown what the run has read"; SL-11 §135.20–24)

# SL-15 — The clerk projection carries what the Keeper would otherwise look up

## Evidence (live gate #3, campaign `gate3-haunting-2329`, turn 3; driver evidence `.coc/playtests/gate3-haunting-2329-20260924T032940Z/turn-3.json`)

- Three `look` calls, each its own model round: `{focus: "scene"}` right after the clerk executed `apply:move:commission-briefing` (the model step before it took 15.4 s and produced only that look); `{focus: "npc", name: "Steven Knott"}` before the attack; `{focus: "session"}` after `session:combat-start`.
- Kernel time for the three: 7, 4 and 6 ms. Model time around them: 15.4 + 5.6 + 3.4 s.
- The run's own read step ran after the move (s4, 102 ms) and after the combat start (s15, 216 ms); the Keeper never sees the read, only the `coc-clerk` projection of what the clerk did.
- Telemetry records the look with `call_id: null` and no arguments; the turn record keeps only `params_sha256`.

## Scope

1. **Projection.** Before each model step the `coc-clerk` message (runtime/jev/hybrid-engine.ts, SL-11's issued section) also carries, from the run's fresh read: the scene view when the active scene changed during this run; the card of each person that an executed or pending candidate targets or names (attack target, pending defence actor, obligation meeting); the session view whenever a session is active. Same shapes the `look` tool returns, so nothing new is invented; budgeted by SL-11's ceilings and truncated the same way.
2. **Telemetry.** A model-origin `look`/`lookup` row records its arguments (`focus`, `name`, …) and the step it came from. The turn record keeps the arguments beside the hash for read-only calls.
3. **Contract.** §135.31 in docs/kernel-rpc.md, contract first (what is carried, when, its ceiling, the telemetry fields).

## Acceptance

- Driver tests (fake model engine) asserting the projection content after a clerk move, at a pending defence, and with an active session; ceiling respected; mutation-killable (scene omitted after move, person omitted, session omitted, ceiling ignored).
- Replay `fight-round` and a fixture from the gate-3 turn-3 state, live Keeper, 3 runs each: report `look` count per run before and after (before = this branch's parent). Not a pass line, a measurement; the pass line is the projection tests.
- `test:ext`, loop suites, pytest green on the branch and after merging 0.9.5a.

## Comments
