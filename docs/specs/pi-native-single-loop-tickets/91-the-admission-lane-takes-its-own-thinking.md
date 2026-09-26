Status: ready (filed 2026-09-26 from long gate #21; batch 16; P1 latency)
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
