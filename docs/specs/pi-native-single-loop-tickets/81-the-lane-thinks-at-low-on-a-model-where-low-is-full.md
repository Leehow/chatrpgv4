Status: ready (filed 2026-09-26 from long gate #13's lane telemetry; batch 13)
Stage: SL-81 (P1, lanes; the admission lane's thinking level on deepseek)
Spec: docs/kernel-rpc.md §135.27.1 (provider corrections: `thinkingLevelMap.off`), §12.8.1 (lane `start` row `lane_thinking`), §32.12 (the admission lane's cap), `runtime/fast-model.ts` (`LANE_THINKING_DEFAULT = "low"`, `resolveFastThinking`), `extensions/lanes/subsession.ts` (`laneReasoningOptions`: `openai-completions` → `{reasoningEffort: level}`)

# SL-81 — The admission lane runs deepseek-v4.1-flash at `low`, which on this provider is full reasoning: 4 review timeouts and 5 pendings on one table

## Evidence (long gate #13, campaign telemetry)
- 100 lane `start` rows: `model: opencode-go/deepseek-v4.1-flash, lane_thinking: "low", thinking_carried: true`; every lane request carries `reasoning_effort: low`.
- SL-61's probes on this provider: `reasoning_effort` low/minimal is accepted and does not reduce reasoning; pi-ai's deepseek format sends `thinking: {type: "enabled"}` for any level except `off`; `off` cut a 59–92 s call to 3 s. The Keeper of this table runs `off` (reasoning 0 on 69 of 71 calls). The lane does not: admission lane ms p50 0 / p90 10,275 / max 13,005 (the hard cap); verdicts `review_timeout` 4, `review_pending` 5 (gate #12: pending 4; #11: 4; #10: 2+1 timeout). Pre-registration line 7 ("no review_timeout; pending ≤ 4") failed on this alone.
- `laneReasoningOptions` maps `openai-completions` to `reasoningEffort: level` and never to the model's own `thinkingLevelMap` (the corrections of §135.27.1 that gave the Keeper its `off`).

## Ruling (filed for the owner)
A lane's thinking level resolves through the same model data as the Keeper's: when the fast-model setting names no level, the lane takes the table's level (`off` here) rather than a literal default; and the level is mapped through the model's `thinkingLevelMap` (after §135.27.1's corrections), so `off` produces the disabled shape for a deepseek-format model and `low` on a model whose map says `low` is a no-op is recorded as such on the `start` row (`lane_thinking_effective`). `LANE_THINKING_DEFAULT` stops being a literal: it is "the table's level, else the model map's lowest real level".

## Scope
- `runtime/fast-model.ts` `resolveFastThinking` (table level as the default; map lookup), `extensions/lanes/subsession.ts` `laneReasoningOptions` (map-aware `off`), contract §12.8.1 addendum; the memory note in `lane-children-need-provider-extensions` (the corrections must reach lane children too).
- Tests (mutation-killable): a table at `off` with no fast-thinking setting starts the lane at `off` and the request carries the disabled shape; an explicit fast-thinking setting still wins; a model without `off` in its map keeps today's behaviour and the row says so.
- Acceptance on gate #14: admission lane p90 ≤ 3 s, `review_timeout` 0, `review_pending` ≤ 1.

## Comments
