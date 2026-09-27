Status: ready-for-human (implemented 2026-09-26)
Stage: SL-91 (P1, lanes: the admission lane's own model and thinking)
Spec: docs/kernel-rpc.md §12.8.1 + addendum (SL-81 lane thinking resolution), §32 (`PI_COC_ADMISSION_MODEL`), §32.12 (13 s cap, 26 s hard cap); `extensions/lanes/subsession.ts` (`fastLaneChoice`, `laneThinkingLevel`, `laneReasoningOptions`), `extensions/kernel/admission.ts` (`reviewAdmission`: `envName: "PI_COC_ADMISSION_MODEL"`)

# SL-91 — A lane whose model comes from its own env override also takes its own thinking level from a matching env

## Evidence
- Gate #21 (lanes grok-build/grok-4.5 low): admission lane reviews 5–13 s each; t3 two refusal-budget cuts from a `review_pending` + `review_timeout`; t4 26 s of lane time on three `resolve` reviews; lane seconds on the model's own writes 175 s over the table.
- Gates #19/#20 (lanes xai/grok-4.3 off): admission p90 1,385 / 1,365 ms, 0 timeouts. The owner rejected 4.3 as the Keeper; as a reviewer it is fast and its verdicts held.
- `PI_COC_ADMISSION_MODEL` already routes the admission lane to its own model, but `laneThinkingLevel` resolves one level for every lane (`PI_COC_LANE_THINKING` > fast-model setting > table), so an admission lane on 4.3 would run at the table's `low` while the other lanes stay on 4.5.

## Ruling (filed for the owner)
When a lane's model comes from its own env override (`envName`, e.g. `PI_COC_ADMISSION_MODEL`), its thinking level comes from `${envName}_THINKING` when set (e.g. `PI_COC_ADMISSION_MODEL_THINKING=off`), mapped through that model's `thinkingLevelMap` exactly as SL-81 maps the shared level; otherwise today's resolution. The lane `start` row records which source decided (`thinking_source`). No change for lanes without an override.

## Scope
- `subsession.ts` (`runLane`/`fastLaneChoice`/`laneThinkingLevel` take the lane's envName), contract §12.8.1 addendum 2; driver/gate scripts pass `--env PI_COC_ADMISSION_MODEL=xai/grok-4.3 --env PI_COC_ADMISSION_MODEL_THINKING=off` on the next gate.
- Tests (mutation-killable): with both envs set, the admission lane starts on that model at `off` (disabled request shape for a map with `off`) while another lane keeps the shared level; without the thinking env the lane uses the shared resolution; `thinking_source` recorded.

## Comments

- 2026-09-26, implementation (worker on `claude/sl90-20260926`, same worktree as SL-90): landed the filed
  ruling.
  - Contract: `62900be19` -- §12.8.1 addendum 2, appended at the document's current end (the repo's existing
    convention for a new addendum, per SL-86's own `§135.32 addendum 3.1`).
  - Implementation: `ac36dc024`, `extensions/lanes/subsession.ts`.
    - `laneThinkingChoice(ctx, envName)`: `{level, source}`, `source` one of `caller`/`lane-operator`/
      `operator`/`setting`/`table`/`default`. The lane-specific `${envName}_THINKING` is read only when
      `envName && process.env[envName]?.trim()` -- mirroring `resolveLaneModel`'s own check of the same
      variable rather than a second copy of it that could drift. `laneThinkingLevel(ctx, envName?)` keeps
      its pre-addendum string-returning shape (`envName` now optional, defaulting to the unchanged
      four-rank resolution) so every caller before this ticket is unaffected; it is now a one-line wrapper
      around `laneThinkingChoice(ctx, envName).level`.
    - `runLaneAttempt` passes `request.envName` into `laneThinkingChoice` (previously `laneThinkingLevel(request.ctx)`
      with no envName at all) and threads the resolved `source` into `rows.start(...)`'s new fifth
      parameter; `laneCallRows.start` writes it as `thinking_source` on the `start` row.
    - `fastLaneChoice` (the tool-enabled child road) gets the same conditional check ahead of its own
      resolution (`laneOverride || resolveFastThinking({choice})`) -- verified this actually reaches a
      launched child unmodified for `adaptation.ts`'s `reader`-kind tasks (`runtime/tasks.ts`'s `runTask`
      only re-resolves model/thinking for `kind: "mod"`, never `"reader"`); `ensureMapWords`'s own
      `mod`-kind call in `extensions/kernel/index.ts` still re-resolves independently through
      `runtime/tasks.ts`'s pre-existing, differently-named `PI_COC_MOD_MODEL`/`PI_COC_MOD_THINKING`
      convention, so `fastLaneChoice`'s `thinking` there is cosmetic for that one caller (unused
      downstream) both before and after this change -- confirmed by reading `runTask`'s `mod` branch, not
      assumed.
  - Tests: `73a3aa9b6`, `tests/extension/lane-reasoning-budget.test.mjs` (extended in place; no new file
    needed). Pure ranking tests for `laneThinkingChoice` (lane-operator over operator/setting/table/
    default; the lane-specific check skipped entirely when the model override is absent even with a
    stray `_THINKING` set; `envName`-omitting callers unaffected; a garbage lane-specific value still
    named `lane-operator` while normalizing to the literal default level) plus one lane-seam test through
    the real `runLane` (a fixture `openai-responses`-shaped model whose map supports `off`): both envs
    set starts the lane on its own model at `off` with no literal `reasoningEffort` and
    `thinking_source: "lane-operator"` on the `start` row, while a second lane with a different, unset
    `envName` in the same process keeps the shared level -- proving the override is per-lane, not
    process-wide the moment any lane's env is set.
  - Mutation testing (scratch copy under `/private/tmp/.../scratchpad/sl91-mutation`, `cp` in and out,
    never `git checkout --`/`git stash`, restored and diffed clean afterward): the lane-specific override
    read forced to `undefined` -- red (both the pure ranking test and the lane-seam test); `thinking_source`
    dropped from the `start` row -- red (the lane-seam test); `request.envName` dropped from the call into
    `laneThinkingChoice` inside `runLaneAttempt` -- red (the lane-seam test, on the very assertion the
    ticket's own acceptance line names: no literal `reasoningEffort` sent).
  - Test runs (locally, `node --test`, this worktree): `lane-reasoning-budget.test.mjs` and
    `fast-model-resolution.test.mjs` together, 61 tests, 0 failures, before and after each mutation
    restoration.
  - Left for the human: the driver/gate script change (`--env PI_COC_ADMISSION_MODEL=xai/grok-4.3 --env
    PI_COC_ADMISSION_MODEL_THINKING=off` on the next gate) is an operational change to a live-table
    driver script, not this worktree's code, and out of scope for a worker session with no live model
    calls; the next gate's own measurement (admission lane latency/timeouts on `grok-4.3` at `off`) is
    likewise for the live table.
- Live (gate #22): admission lane xai/grok-4.3 off (`thinking_source: lane-operator`), p50 1.2 s / p90 2.1 s / max 2.4 s; 2 not_authorized of 25 (one reads as a false refusal: t6 vittorio-bible-weapon).
