Status: ready-for-human
Spec: docs/specs/jev-decides-llm-writes.md D-A · Contract §150.1

# 01 — The clerk executes by default

The consequence-step mode resolver reads the env switch, else the host-budget data's `jev_steps.shadow`; ship `shadow: false`. Record the effective mode and its source on the run's route/residual rows.

Tests (single files on the Mac; suites on leehow-pc): mode resolution (env on/shadow/off, empty env with data true/false, unreadable data = fallback shadow); a default-env run executes a cleared `clue_follow_up` and keeps `npc_reaction` shadow; the recorded mode names its source. A mutation that ignores the data default fails a case.

## Comments

### 2026-09-28 — implemented (lead)
- `jevStepsMode(env, dataDefault)`: an explicit `on`/`off` wins; an explicit unrecognized value is `shadow`; an absent/empty switch returns the data default. `jevStepsModeSource(env)` names `env | data`.
- The engine reads `jev_steps.shadow` once (cached budget) and every run's first table read awaits it; the residual and `consequence_budget` rows carry `steps_mode` and `steps_mode_source`.
- Shipped data: `jev_steps.shadow: false` (execute list unchanged: `clue_follow_up`).
- Tests: `consequence-shadow-gate` (resolver incl. data default and source), `consequence-execute-mode` (default env executes the listed class and records `data`; explicit env recorded as `env`). Two older tests that meant "shadow" by passing `{}` now pass `COC_JEV_STEPS: "shadow"` explicitly. Mutation (data default ignored) fails the new engine test.
- `consequence-admission.test.mjs` needs the emitted `build/`; run on the test box.

### 2026-09-28 — risk read from ticket 05's report (lead, read-only over 15 gate homes, 27 tables)
- `clue_follow_up` shadow precision over judged cleared rows: 26/29 = 0.897 (the owner's 09-26 opening used 6/6, 6/6 on three tables). Executed rows (49, tables #18–#25) are excluded from that number; SL-78's own transcript reads found 0 FP on #17/#18.
- The three shadow false positives: `longgate16-haunting-0628` (1) and `time-skip-b` turn 2 (2, confidences 0.47 and 0.49, cleared only because SL-86 lowered the class gate to 0.4). One is a real premature clue: the newsvendor asks to be paid first (turn 2 prose), the player pays on turn 3 and the Keeper files `dooley-macario-madness` then; in execute mode the clerk would have filed it a turn early.
- Not changed here: the owner asked for the default flip; raising `jev_steps.classes.clue_follow_up.row_min` back toward 0.5 would have held both time-skip-b rows, at SL-86's recall cost. Reported to the owner for a decision.

### 2026-09-28 — gate decision (lead; owner: 「你来决定吧」)
Decision: keep `jev_steps.classes.clue_follow_up` at `row_min 0.4 / row_ratio 0.67`; do not raise it.

Evidence (replay of recorded Noul `yes` over every judged clue row in the 15 gate homes; executed rows read against their turns' prose):
- Shadow rows under the current (post-SL-86) question, 21 tables: gate 0.40 → tp 12 fp 6; 0.50 → tp 12 fp 1; 0.55/0.60 → tp 12 fp 0. On shadow rows alone, raising looks free.
- But 35 of the 49 executed rows (tables #18–#25) sit below 0.6 and 25 below 0.5, and in that band confidence does not separate right from wrong:
  - Right: the basement dagger (0.42–0.48), the Globe clippings (0.42–0.44), the library years (0.42–0.45) and Gabriela's night visitor on t7 all match the player's action, and the prose carries the clue.
  - Premature: `dooley-macario-madness` on t5 (0.46–0.49) fires while the newsvendor is still asking to be paid. On #18, #20 and #23 the Keeper reconciled by telling the story that turn. On #19 the clue was filed and the prose (83 characters: "a paper or cigarettes?") never delivered it.
- Raising to 0.5 would drop about half the executions, most of them correct, to prevent a failure that a gate cannot target.

The real failure is an executed step that never reaches the prose (§135.32's "every executed D1 step appears in the prose or is reversed"). Ticket 05's report now counts executed / narrated / reversed / neither per table. The next lever is the question's state for NPC-held clues (a condition the fiction imposes before telling), not the gate.
