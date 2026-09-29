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
