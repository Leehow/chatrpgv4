Status: ready-for-agent
Stage: SL-11 (with SL-10; before SL-03)
Spec: docs/specs/pi-native-single-loop.md (Rulings: "A turn is under 60 seconds")

# SL-11 — The model-call diet: fewer calls, fewer output tokens per call

## Evidence (the SL-02 live gate, 2026-09-23, session d33d44c1, campaign game-b5367f88)

Per call of the declared-move turn (Grok 4.7 Fast, `reasoning_effort: low`, measured 90–115 output tokens/s):

| call | s | output tok | reasoning tok | what |
| --- | --- | --- | --- | --- |
| 1 | 10.9 | 1077 | 989 | two `lookup`s (module + source) — cache read 17.5K of 42K, TTFT 5.5 s |
| 2 | 2.2 | 32 | 22 | `look clues` |
| 3 | 22.6 | 2586 | 1322 | one `apply` batch with paragraph-long `how`/`why` |
| 4 | 4.1 | 225 | 209 | `look npc` |
| 5 | 6.3 | 484 | 427 | `apply person` |
| 6 | 2.9 | 117 | 4 | `resolve` first impression |
| 7 | 12.2 | 1069 | 646 | the narration (377 chars) |

Three of seven calls were reads the host could have supplied; reasoning alone was ~3.6K tokens (~35 s).

## Scope

1. **The read step supplies what the model looks up:** for every issued scene candidate (clue, handout, person) the read artifact carries the body/description the Keeper would otherwise `lookup`/`look` for (bounded per candidate, the same 1 KB-class budgets the capsule uses; cite §13.2/§131); measure on the gate table's session which lookups it would have removed.
2. **Tool arguments are not prose:** contract + tool schema + prompt: `how`/`why` one sentence (schema `maxLength`, refused with a `fix` that says shorten, not a silent cut); `apply` batches over one-call-per-effect (the prompt already prefers batches — check why the Keeper split them and fix the cause, not the wording).
3. **Reasoning budget by provider option, measured:** probe the Grok Build provider's reasoning options (`reasoning_effort` values the API accepts; any "minimal"/"none"; the existing thinking-schedule code in `tests/extension/thinking-schedule.test.mjs` and `runtime/`), run the turn-3 and fight-round replays at each accepted level with the product driver, and report tokens and seconds per call and whether actions still match 8/8. Do not change the default without the numbers; the owner picks from the table.
4. **Cache prefix:** the first call of a turn read only 17.5K cached of 42K; find what the read step changes before the stable prefix (prescreen material placement, §128.1 `context_with_system`) and move the per-turn material after the stable prefix; measure cacheRead before/after on the replay.

## Acceptance

- Replays (turn-3, fight-round; product driver; 3 runs each): calls per turn, output/reasoning tokens per call, wall, cacheRead on the first call, all before/after, in a table; 8/8 actions kept.
- Tests: the read artifact carries candidate bodies (mutation: bodies dropped → a test on the artifact fails); `how`/`why` over the limit refused with the fix; the prefix test (a run's second call reads the first call's prefix from cache in the fake provider's accounting).
- `npm run test:ext`, pytest green on the branch baseline; legacy prompt/tool behaviour unchanged except the argument limits (which apply to both engines — say so in the contract).
