Status: ready-for-human (implemented 2026-09-26 on claude/sl93-20260926, head af5f917b1)
Stage: SL-93 (P0, delivery: one floor for every path that delivers prose)
Spec: docs/kernel-rpc.md §135.11 / §135.11.4 (SL-80: the floor's one steer, the dropped-draft rule), §135.5.2 (SL-92: `apply.narrate`), §34.13/§34.14 (markers, rendered delivery); `extensions/kernel/index.ts` (`FLOOR_STEER` ~754, the implicit-path floor ~5604–5614, the embedded narrate dispatch ~4090–4101, the explicit `narrate` tool path), `extensions/kernel/unwrapped-speech.ts` (`isSpeechOnlyDraft`), `content/rulesets/coc7/host-budgets.json`

# SL-93 — The floor applies to the explicit `narrate` and to `apply.narrate`, not only to the implicit path

## Evidence (long gate #22, `longgate22-haunting-1448`, d64c7a7c4, Keeper grok-4.5 low)
- Turn 1: `apply {effects, narrate: "text thriftily-placeholder"}` → delivered verbatim as the whole turn (`narrate_in_apply` ok, `closed_how: explicit`). The Keeper's real intent sat in text beside its tool calls ("受理委托与抵达已由书记结算。正在补登钥匙、称呼…"), dropped as `text_beside_tool_calls`.
- Turn 8: `apply {effects, narrate: "text"}` → the player read "text".
- The floor (§135.11.4) runs only on the implicit path (`toolCallsThisTurn === 0 || isSpeechOnlyDraft`); an explicit or embedded narrate of four characters passes every check, including the narration audit (it checks claims, not omissions).

## Ruling (filed for the owner; P0 because it reached the player)
One floor for every delivery path — implicit, explicit `narrate`, and `apply.narrate`: the rendered prose with markers and `{{say}}` tokens removed (speech inside say spans still counts as prose unless the whole draft is speech-only, SL-80's rule) must reach `delivery_floor.min_prose_chars` Unicode code points (data in `content/rulesets/coc7/host-budgets.json`, start at 40; structural length only, no word lists). Below it the draft is not delivered: the turn's one steer (`FLOOR_STEER`, existing budget) goes back to the Keeper naming what the turn settled; for `apply.narrate` the writes stay landed and only the embedded narrate is refused. Once the turn's steer is spent, the next draft closes the turn whatever its length (existing dropped-draft rule — the floor never strands a turn). Also: the `apply.narrate` schema description says the field holds the complete closing prose and is omitted when the Keeper will narrate separately.

## Scope
- Contract §135.11.4 addendum (the floor on every path; the data knob); the check shared by the three paths (one function), telemetry `{lane:"floor", reason:"below_floor", path:"explicit"|"embedded"|"implicit", chars}`.
- Tests (mutation-killable): `apply {…, narrate:"text"}` → writes land, no delivery, one floor steer; the second leg with real prose delivers; an explicit `narrate {text:"text"}` → steered; after the steer is spent a short draft delivers (no strand); a 40+ char Chinese draft delivers on the first leg; the threshold is read from the data file.
- Acceptance on gate #23: floor rows counted; no delivered turn below the floor unless it followed a spent steer (report each).

## Comments

**2026-09-26, implementation (worker, branch `claude/sl93-20260926`).** Contract §135.11.4.1 addendum landed first
(`89f984a24`), then the code. Commits:
- `89f984a24` spec(sl-93): §135.11.4.1 addendum — one floor for every delivery path
- `9ad1455d7` feat(sl-93): delivery_floor.min_prose_chars data knob and loader
- `627f17ad4` fix(sl-93): the floor now runs on the explicit narrate and apply.narrate paths too
- `107aadbb8` test(sl-93): mutation-killable coverage for the floor on every delivery path
- `af5f917b1` test(sl-93): lengthen placeholder narrate fixtures past the new floor

Files: `docs/kernel-rpc.md` (§135.11.4.1), `content/rulesets/coc7/host-budgets.json` (`delivery_floor.min_prose_chars: 40`),
`runtime/jev/host-budgets.ts` (`DeliveryFloorBudget`/`deliveryFloorBudget`/`resetDeliveryFloorBudgetCache`),
`extensions/kernel/unwrapped-speech.ts` (`proseCharCount`), `extensions/kernel/index.ts` (`runTool`'s new
`narratePath` parameter and the below-floor check at the top of `narrate`'s try block; `message_end`'s implicit
floor gains the `belowFloor` disjunct), `extensions/kernel/tools.ts` (`apply.narrate`'s field description),
`tests/extension/delivery-floor-every-path.test.mjs` (new).

**One correction against the ticket's own framing.** "The turn's one steer (`FLOOR_STEER`, existing budget) goes
back to the Keeper" reads, for the implicit path, as `takeTurnCloseSteer`/`turn_close` sending a `coc-host` message.
For the explicit and embedded paths this is a different mechanism, discovered by running the tests, not assumed:
a refused tool call is not "no pending model proposals", so the driven run's step policy never asks for `turn_close`
at all — Pi's own ordinary retry loop just hands the tool's own refusal (`isError`, `fix: FLOOR_STEER`'s text) back
to the Keeper directly, and the model tries again in its next step. Because that mechanism never touches
`takeTurnCloseSteer`, `state.steeredThisTurn` has to be set `true` **synchronously, inside the refusal itself** for
these two paths — not left for a `turn_close` that may never come. Without that, a hand-run repro
(`apply {effects, narrate:"text"}` then a second, equally-short explicit `narrate`) showed the floor refusing
*every* short attempt, never once: the first version of this fix had only `state.deliveryFix` set, and the second
attempt (33 code points, still under 40) was refused a second time instead of closing the turn — caught by the
"once the steer is spent" test in `delivery-floor-every-path.test.mjs`, not by inspection.

**Mutation evidence** (hand-run against the working tree, each mutation applied, tested, then reverted to the
committed text before the next — no `git checkout --`/`git stash`, the diff against `af5f917b1` is clean):
1. `chars < minProseChars` → `chars > minProseChars` in `runTool`'s check: killed (`apply {effects, narrate:"text"}`,
   the second-leg-delivers assertions, and the "raising the floor" test all fail).
2. Dropped `state.steeredThisTurn = true;` from the same check: killed ("once the steer is spent" test: `1 !== 2`
   requests; "raising the floor" test: two floor rows instead of one) — this is the exact bug the correction above
   describes, first found by writing the test, then confirmed as a mutation.
3. `"embedded"` → `"explicit"` at the recursive `runTool(narrateSpec, ...)` call site: killed (the `path` field in
   the floor telemetry row assertion).
4. `proseCharCount`'s `text.replace(MARKER, "")` → `text` (stop stripping markers): killed by the direct unit test
   (`proseCharCount`'s own suite), not by an end-to-end one — evidence for keeping both kinds of test in the new file.
5. Dropped `!closesOpening` from `runTool`'s check: killed by the *existing* `gates.test.mjs` test "开桌回合：
   awaiting_player 拒写，但 narrate 放行" (the opening's narrate call-id shifts from `t0-c1` to `t0-c2`), not by a
   new test — existing coverage was already sufficient for this exemption.
6. Hardcoded `deliveryFloorBudget`'s return to the fallback (ignoring the file's own value): killed (the "shipped
   default" identity check, and both "lowering"/"raising the floor" tests).

**Test results.** `node --test` on each file individually (per the P0 brief's "no full suites" instruction; the
owner runs `test:ext`/`pytest` on the box after merge):
- `tests/extension/delivery-floor-every-path.test.mjs`: 11/11 pass.
- `tests/extension/single-loop-turn-close.test.mjs`: 15/15 pass (existing suite, one fixture lengthened, one
  fixture given its own longer local constant — see below).
- `tests/extension/apply-narrate-combined.test.mjs`: 4/4 pass (existing suite, all four narrate/`apply.narrate`
  texts lengthened).
- `tests/extension/narrate-non-blocking-batch.test.mjs`: 3/3 pass (existing suite, all three narrate texts
  lengthened).
- `tests/extension/gates.test.mjs`: 12/12 pass (existing suite, seven narrate fixtures lengthened; two left as-is —
  see below).
- `tests/extension/unwrapped-speech.test.mjs`: 13/13 pass, unchanged — pure unit tests of `unwrapped-speech.ts`'s
  existing functions, never touched by this ticket's code path.
- `npm run build:runtime`: clean (esbuild + the AST-based re-export check; not a full `tsc` type-check — this repo
  has no project-wide tsconfig for `extensions/`/`runtime/`, only `tsconfig.kernel.json` for `kernel-ts/`).

**Existing fixtures changed, and why (none of them are about narrate's own length).** Every one below was
below 40 code points before the fix and is lengthened now, substrings any assertion matched on kept intact:
- `single-loop-turn-close.test.mjs`: "a step that called narrate itself is unchanged" (about no `turn_close` being
  asked when narrate already delivered, not length) and the SL-80 "an explicit narrate of the same say-only shape
  is unchanged" test (about the *structural* speech-only check never running on the explicit path — a different,
  older check this ticket does not touch; given its own local `sayOnlyLongEnough` constant so the shared, short
  `sayOnly` stays untouched for the two implicit-path SL-80 tests that need it short).
- `apply-narrate-combined.test.mjs`: all four tests (batching + effect-key marker resolution; a refused effect
  falling the batch; a narration-audit refusal of the embedded text — this one specifically needed lengthening
  *before* the audit stub, or the floor would fire first and the test would stop proving what it says it proves;
  and "no narrate field" parity).
- `narrate-non-blocking-batch.test.mjs`: all three tests (non-blocking batching, a fallen batch's second leg,
  resolve-then-narrate guidance).
- `gates.test.mjs`: the runaway-abort test, both look-budget tests plus the reset-on-new-input one, the
  same-batch-refusal test, and the three refusal-budget-counting tests. Left unchanged: the opening's own
  exemption (`closesOpening`) made the two "开桌回合"/awaiting_player tests unaffected regardless of their
  narrate text's length (verified by mutation #5 above), and "回合已经关掉之后，narrate 也要计入拒绝预算" is
  blocked by `turnHasNoDoor` before `runTool` ever runs, so the floor never sees its text either.

**Acceptance on gate #23** is the owner's/next playtest's to run; not attempted here (no live model calls, per the
brief).

- 2026-09-26 (integrator): **re-scoped to `apply.narrate` only.**
  - After the merge at `92a8b0b42`, the box suites went red: ext 118, loop 23 failures, reported by the load-proof worker at `3d9204520`. The cause was legitimate short explicit narrates, e.g. `turn.test.mjs`'s "门厅很安静，你准备怎么做？".
  - Both placeholders in the evidence were in `apply.narrate`, so the floor now runs only on the embedded path. The explicit path and the implicit close are back to SL-80.
  - Contract note appended to §135.11.4.1. Tests reworked in `delivery-floor-every-path.test.mjs`; the mutation removing the `embedded` condition goes red.
  - Local single-file runs green: turn 35/35, single-loop-turn-close 15/15, apply-narrate-combined 4/4, narrate-non-blocking-batch 3/3, gates 12/12, unwrapped-speech 13/13, delivery-floor-every-path 11/11. The box run follows.
