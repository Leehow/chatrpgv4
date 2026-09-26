Status: ready-for-human (implemented 2026-09-26, worktree chatrpgv4-wt-sl81, branch claude/sl81-20260926)
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

**2026-09-26, worker (branch `claude/sl81-20260926`).** Implemented per the ruling. Contract §12.8.1
addendum written before code (docs/kernel-rpc.md, right after §12.8.1's four-row table, before §12.9).

- `runtime/fast-model.ts`'s `resolveFastThinking` gains an optional `table` argument, ranked below
  the override and the setting and above `LANE_THINKING_DEFAULT`. No existing caller
  (`runtime/tasks.ts`'s `mod` task, `presentationLaneChoice`) passes one, so their resolution --
  `mod` effort deliberately never inherits the table's, §37.11 -- is unchanged bit for bit (proven by
  the untouched `tests/extension/fast-model-resolution.test.mjs` cases and a mutation round-trip).
- `extensions/lanes/subsession.ts`'s `laneThinkingLevel` (previously zero-argument, reading only
  `PI_COC_LANE_THINKING`) now takes the session `ExtensionContext`, resolves through
  `resolveFastThinking` with `table: ctx?.thinkingLevel`, and validates the result against the level
  set (now including `off`) before falling to the literal default. This is the actual fix for the
  reported bug: `runLane`'s only caller of this function, `runLaneAttempt`, previously reached
  `LANE_THINKING_DEFAULT` ("low") unconditionally for every zero-tool lane that does not pass its own
  `thinking` (admission, verifier, memory, journal, voice -- all of them, today) whenever the table's
  own effort was never even consulted; now it is, before the literal.
- `laneReasoningOptions` no longer ever sends `off` as a literal `reasoningEffort`. For the four
  `reasoningEffort`-shaped APIs (`openai-responses`, `azure-openai-responses`,
  `openai-codex-responses`, `openai-completions`), `off` is omitted from the options entirely whenever
  the model's own `thinkingLevelMap.off` is not explicitly `null` -- mirroring, byte for byte, what
  pi's own `Agent`/`streamSimple` road already does for `off`
  (`node_modules/@earendil-works/pi-agent-core/dist/agent.js`: `reasoning: thinkingLevel === "off" ?
  undefined : thinkingLevel`) -- and letting each API's own raw builder in
  `node_modules/@earendil-works/pi-ai/dist/api/*.js` consult that same map to produce its disabled
  shape (`thinking: {type: "disabled"}` for `deepseek`). A model whose map says `off: null`
  (unsupported) keeps the pre-fix, unconditional `{reasoningEffort: "off"}` -- today's behaviour,
  unchanged on purpose.
- The `start` row gains `lane_thinking_effective`, written as `clampThinkingLevel(model, thinking)`
  only when the resolved level is `off` (identical to `lane_thinking` for every other level, by
  design -- this ticket's concrete scope is `off`, not a general remap of every level). For a
  corrected deepseek model it stays `off`; for a model whose map still says `off: null` it reports
  the real floor (e.g. `grok-4.6` → `minimal`, matching the existing `LANE_THINKING_DEFAULT` doc
  comment's own worked example), so the gap between what was asked and what could be delivered is on
  the row itself, not only inferable from `thinking_carried`.

**Files.** `docs/kernel-rpc.md` (§12.8.1 addendum + `start` row field list), `runtime/fast-model.ts`,
`extensions/lanes/subsession.ts`, `tests/extension/fast-model-resolution.test.mjs`,
`tests/extension/lane-reasoning-budget.test.mjs`.

**Tests run** (`node --test`, not the full `test:ext`): `lane-reasoning-budget.test.mjs` (9/9),
`fast-model-resolution.test.mjs` (46/46), `lane-session-headers.test.mjs` (11/11),
`coc-lane-model.test.mjs` (11/11) -- all green, including every pre-existing case (no assertion was
weakened or deleted to make this pass). `lane-outage.test.mjs`/`lane-queue.test.mjs` also green;
`lane-idle-timeout.test.mjs`, `lanes.test.mjs`, `npc-character-lane.test.mjs`,
`npc-journal-lane.test.mjs`, `npc-voice-lane.test.mjs`, `thinking-schedule.test.mjs` fail in this
worktree on `ERR_MODULE_NOT_FOUND` for `build/node_modules/@earendil-works/pi-coding-agent/...` and
`build/kernel/check.mjs` -- **pre-existing**: this worktree has never run `npm run build:runtime`
(`build/` does not exist at all), none of those six files import `extensions/lanes/subsession.ts` or
`runtime/fast-model.ts`, and the failures are identical with and without this change. Left for the
full-suite run after merge (a `build:runtime` first will very likely turn them green; not verified
here per the instruction not to run heavy suites).

**Mutation evidence** (copy-edit-run-restore, never `git checkout --`): (1) removing the
`level === "off" && ... && thinkingLevelMap?.off !== null` short-circuit in `laneReasoningOptions` →
two new tests fail (`{}` expected, `{reasoningEffort:"off"}` got; `"reasoningEffort" in seen` true
where it must be false). (2) dropping the `table` fallback from `resolveFastThinking` → the new
direct unit test and the new `runLane`-mediated "no setting: the table's own off" test both fail
(`"low" !== "off"`), 3 assertions total. (3) dropping `lane_thinking_effective` from the `start` row
→ two new tests fail (`undefined !== "off"`, `undefined !== "minimal"`). All three mutations restored
from an in-memory copy before the next check; final state re-verified green.

**Not done / left open.**
- The memory note `lane-children-need-provider-extensions` (an entry in the orchestrator's own
  `~/.claude/…/memory/MEMORY.md`, not a repository file this worktree can write) is not amended here;
  flagging for whoever owns that memory file to add "the §135.27.1 corrections must reach a
  `runLane` zero-tool lane too, not only a `mod` child" if it doesn't already say so.
- No live model call was made (per the hard rule); the claim that a corrected deepseek model's actual
  wire request ends up as `thinking: {type: "disabled"}` rests on reading
  `node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js`'s own (unexported, so not
  directly unit-testable without vendoring more of pi-ai) per-`thinkingFormat` branch, not on
  invoking it. `laneReasoningOptions`'s own contract (return `{}`) is what the tests here prove.
- Gate #14 acceptance numbers (admission lane p90 ≤ 3 s, `review_timeout` 0, `review_pending` ≤ 1)
  are a live-table measurement, out of scope for this worker (no live model calls; real playtest
  gates are run by the human/live-KP process per the project's playtest rules).
- Live (gate #14, b088de327): 64 lane starts all `off`/`off`; admission p50 0 / p90 2,268 / max 2,813 ms; review_timeout 0, review_pending 0 (#13: p90 10,275, 4 timeouts, 5 pending). Line met.
- Live (gate #15): 90 lane starts `off`/`off`; admission p90 2,440 / max 5,714 ms; 0 timeouts, 0 pending. Confirmed on two tables.
- Live (gate #16): 118 lane starts `off`/`off`; admission p90 2,640 / max 4,201 ms; 0 timeouts, 0 pending. Three tables.
- Live (gates #18/#19): lanes on grok-4.5 low → admission p90 7,105 ms; lanes on grok-4.3 off → p90 1,385 ms. The lane needs a model whose map has `off`; the table-follow rule is right, the lane model choice matters more.
