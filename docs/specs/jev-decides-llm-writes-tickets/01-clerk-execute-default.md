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
