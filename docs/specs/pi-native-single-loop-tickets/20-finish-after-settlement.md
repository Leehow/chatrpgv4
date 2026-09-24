Status: ready-for-agent
Stage: SL-20 (measure first, then rule; after SL-13 follow-up)
Spec: docs/specs/pi-native-single-loop.md (Ruling: "Once the clerk has settled the player's declaration, the run leans to finish")

# SL-20 — After the clerk settles the declaration, the run leans to finish

## Evidence (live gate #6, turn 2, campaign gate6-haunting-0335)
- The compile selected the obligation check; the clerk executed it (Persuade 16, hard success, `settled: true`) at 3.0 s. Then route s6 answered exit low_confidence → LLM: the Keeper ran a first-impression check and proposed a step on the next obligation (Ruth Blake), refused after a 57 s review; compose came at 96 s. The turn took 112 s for a declaration the clerk had settled by second 10.

## Scope
1. Measure on SL-13's fixtures (gate3-t2, gate4-t1, the gate6 turn-2 state) with live Jev, 5 runs each: the exit distribution right after a compile-selected candidate succeeded; how often `finish` would have been chosen under the proposed rule; what the Keeper did in those LLM steps in the recorded runs. Pre-register.
2. Rule from the numbers (write it as a dated addendum in §135.30 / §135.11): after the declaration's own step succeeded, `finish` is the default exit unless `continue`/`ask_llm` clears the gate on its own; the compose still receives the settlement's receipts and the obligation's book line; forced session steps (a pending defence) still run.
3. Implement in runtime/jev/step-policy.ts with tests (mutation-killable: default removed; forced step skipped), replay the three fixtures again, and report LLM steps and wall before/after.

## Comments
