Status: ready-for-human (filed 2026-09-26 from long gate #21; batch 16; P1 latency; continues SL-88 under the owner's "能不等就不等"; implemented 2026-09-26 by claude/sl88-20260926, see Comments)
Stage: SL-92 (P1, Keeper steps: one tool call where the model insists on one)
Spec: docs/kernel-rpc.md §135.5 + §135.5.1 (SL-88: non-blocking writes share the narrate's call), §34.13.1 (effect-key markers), §135.11 (turn close / delivery evidence), §34.14 (only a rendered delivery counts), narration audit (§ narrate); `extensions/kernel/tools.ts` (`apply` schema), `extensions/kernel/index.ts` (tool dispatch, implicit/explicit narrate paths), `runtime/jev/hybrid-engine.ts` (`modelStep`)

# SL-92 — `apply` takes an optional `narrate`: the prose that closes the turn once the writes land, in the same single tool call

## Evidence
- SL-88 put the batching rule in the tool descriptions and the Keeper's turn-flow text. Gate #21 (grok-4.5 low, same Keeper/lanes as #18): `[apply…, narrate]` batches 4 (from 1), standalone `apply` calls 20 (from 18), Keeper calls per turn 2.8 (unchanged). The model emits one tool call per message; guidance does not change that habit.
- Each separate narrate call costs ≈ 1.4 s fixed + a fresh reasoning pass (≈ 160 tokens at ≈ 52 tok/s) + prefill — ≈ 4–5 s per turn that has a non-blocking write before the prose.

## Ruling (filed for the owner; the owner approved the aim: "不需要等结果的写入和 narrate 合进同一次调用")
`apply` gains an optional `narrate` field (same shape and rules as the `narrate` tool's `text`: play_language, markers — effect-key markers `{{kind:handle}}` are the natural ones here — `{{say:…}}` spans). When present: the host settles the apply's lines exactly as today (admission, kernel, receipts, §135.5 failure branch); if every line landed, it runs the narrate with that text through the same path the `narrate` tool uses (rendering, marker resolution, narration audit, delivery, turn close) — one model call for the whole turn. If any line was refused or the audit refuses the text, nothing is delivered and the Keeper gets the refusal as today (the text is held as the draft for the repair, like §135.11's dropped-draft rule). `resolve`/`look`/`lookup`/`recall` get no such field (they block). The `narrate` tool stays for turns with no write.

## Scope
- Contract §135.5 addendum 2 (the combined call), tool schema + one-line description ("put the closing prose here when nothing you are waiting on changes it"), dispatch in `index.ts`/`hybrid-engine.ts` so the embedded narrate is delivery evidence exactly as an explicit one; telemetry `{lane:"delivery", reason:"narrate_in_apply"}`.
- Tests (mutation-killable): `apply {lines…, narrate}` settles lines then delivers and closes the turn in one model step; a refused line → no delivery, refusal back to the Keeper, text held as draft; audit refusal of the embedded text → same as an explicit narrate's refusal; effect-key markers resolve; an `apply` without `narrate` behaves exactly as today.
- Acceptance on gate #22: Keeper calls per turn ≤ 2.0; `narrate_in_apply` deliveries ≥ 8.

## Comments

**2026-09-26, worker (claude/sl88-20260926, merged to claude/integ-single-loop-2-20260926 head ba6b5e177 first). Landed.**

Contract first: §135.5.2 addendum in `docs/kernel-rpc.md`, right after SL-88's own §135.5.1. States the ruling, the
"how it is the same path, not a parallel one" architecture note, what `modelStep` is told, telemetry and the tests.

**Schema + description** (`extensions/kernel/tools.ts`): `apply.parameters` gains an optional `narrate: Type.Optional
(Type.String({...}))`, one sentence, worded to the ticket's own line ("put the closing prose here... delivers only
once every effect above lands, exactly as calling narrate would"). `apply`'s own top-level description gained a
clause pointing at it. `resolve`/`look`/`lookup`/`recall` untouched, as the ruling says.

**Host dispatch** (`extensions/kernel/index.ts`, `runTool`). Design: `runTool` is the *one* function every tool call
runs through -- `createCanonicalOperationDispatcher`'s `execute` stage (`dispatcher.execute`) is a bare passthrough to
it, confirmed by reading `canonical-operation-dispatcher.ts` line by line before writing a line of this. So "the same
path the narrate tool uses" is implemented literally: when every effect of an `apply` call lands (no
`partial.notLanded`) and it carries a `narrate` field, `runTool` calls *itself*, recursively, for a synthetic
`narrate` call under `${toolCallId}:narrate`. This is not a parallel reimplementation of rendering/audit/delivery --
it is the identical code, on a call the dispatcher's own per-call `frames` map was never asked to register (that map
is populated only by a policy-origin's `bindReadScope`/`bindIncumbentScope`/`dispatch`, never by an ordinary model
call), so every seam the recursive call touches (`hostOrigin`, `tracksMutation`, `requireCapability`,
`beforeKernelInvoke`, `bindKernelCallId`) reads it exactly as an ordinary top-level Keeper call. The embedded
narrate's own success path runs `applyToolSuccess(state, "narrate", …)` unchanged, so `state.closedThisRun`,
`renderedText`, `deliveredTurn`, the mechanics/commit/standing projections and the post-delivery review scheduling
all land exactly as an explicit call's would; the one correction made afterward is `state.deliveryToolCallId`,
restored to the *outer* apply's own toolCallId (the one the transcript actually shows) since the synthetic id never
appears there. A refusal from any stage the recursive call reaches -- admission, the kernel, the narration audit --
comes back as the same `{content, details: {coc_error}}` shape an explicit `narrate` refusal has; the outer `apply`
call reports that as its own refusal (with the already-landed effects/receipts still named in the merged result), so
`finalizeOperation` marks it `isError` and the refusal budget (§34.12) counts it precisely as a refused `narrate`
would be. Telemetry: `{lane: "delivery", reason: "narrate_in_apply", ok, call_id}`.

**Driven-run bookkeeping** (`runtime/jev/hybrid-engine.ts`, `modelStep` only -- `routeConsequencesAfterWrite` and
`clerkStep` left untouched per the coordination note about the concurrent SL-90 work in this file).
`DELIVERY_VERBS` named only `narrate`/`ask`; `modelStep`'s `delivery` computation now also reads an `apply` result's
own `narrate_in_apply: true` flag, so `closeConsequences(run)` and the step's own `delivery` field (which the driver
reads to end the run `delivered`) treat the combined call exactly as an explicit `narrate` would. Proven by mutation:
forcing this check to always answer `undefined` made the run ask the Keeper a second, unnecessary time -- caught by
test 1's `keeperCalls === 1` assertion.

**Kernel:** untouched, per the coordinator's note that another session owns `kernel-ts/write/index.ts` (the narrate
rollback journal). Kernel-side there is nothing new to build: `table.apply` then `table.narrate` is the exact RPC
sequence the kernel has always executed for two separate Keeper tool calls; only which host code decides to make the
second call changed. No `npm run build:runtime` was needed for this ticket (kernel-ts/ is unchanged); the harness
loads `extensions/kernel/` and `runtime/jev/` from source.

**Tests** (`tests/extension/apply-narrate-combined.test.mjs`, a new file per the coordination note -- kept separate
from `ts-kernel-write.test.mjs`, which another session is also touching; real kernel, hybrid engine, fake pi):
1. `apply {effects: [clue], narrate: "...{{clue:x}}..."}` in one message settles the clue, delivers the narrate, and
   closes the turn in the Keeper's one call (`lane: "provider-call"` count == 1); the effect-key marker resolves; the
   transcript's tool result is under the outer apply's own toolCallId, carrying `narrate_in_apply: true`.
2. A refused effect (unknown clue) leaves nothing delivered; the batch's own failure branch (§135.5) is unaffected by
   the embedded text having been written at all; the run recovers on the Keeper's next, separate message.
3. A stubbed `coc:mods-bridge` whose `prepare('narrate', …)` throws `reviewUnavailable` (the same fixture
   `continuity-audit.test.mjs` already uses) reproduces a narration-audit refusal: the apply's own effect still
   landed and is named in the refused result, the outer call is `isError`, `narrate_in_apply: false`, and the
   refusal's `details.reason` is `continuity_review_unavailable` -- structurally identical to an explicit narrate's
   own audit refusal. (The refused apply still falls the batch and asks the Keeper once more, whose own leg the
   paused review then holds too -- unrelated, pre-existing §38/§135.5 behavior, not re-verified here.)
4. An `apply` with no `narrate` field behaves exactly as before: no embedded dispatch, no `narrate_in_apply` field at
   all on the result, two Keeper calls as always.

**Mutation evidence** (copy to scratch, edit, run, restore -- never `git checkout --`): disabling the embedded-narrate
trigger (`if (false && spec.name === "apply" && …)`) kills tests 1 and 3 (no landed embedded delivery). Forcing
`modelStep`'s `narrate_in_apply` recognition to always answer `undefined` kills test 1's one-model-call assertion
(the run asks the Keeper a second, needless time). Both restored from backups before any further edit; `git diff
--stat` afterward showed only the intended net changes.

**Regression sweep** (files directly touched or immediately downstream of `runTool`/`modelStep`; full `test:ext` is
leehow-pc's job, not run here): `admission*.test.mjs` (100/100), `single-loop-*.test.mjs` (174/174),
`continuity-audit.test.mjs` (37/37), `canonical-operation-dispatcher.test.mjs` + `jev-apply-host.test.mjs` +
`turn.test.mjs` (54/54 combined), `beside-drop-row.test.mjs`, `narrate-non-blocking-batch.test.mjs`,
`admission-concurrent-batch.test.mjs` (SL-88's own, 14/14) -- all green with SL-92's changes in place.

**What I could not do.** No live-table acceptance run (gate #22) was attempted -- that is a real-model playtest,
explicitly out of scope for a worker session per `Agents.md`'s absolute ban on fake-KP shortcuts; the ticket's own
acceptance numbers (Keeper calls/turn ≤ 2.0, `narrate_in_apply` deliveries ≥ 8) are the owner's to run and read.

**Files:** `docs/kernel-rpc.md` (§135.5.2); `extensions/kernel/tools.ts` (`apply.narrate` field + description);
`extensions/kernel/index.ts` (`embeddedNarrateText` capture/strip, the recursive embedded-narrate dispatch and its
refusal handling, `state.deliveryToolCallId` correction); `runtime/jev/hybrid-engine.ts` (`modelStep`'s
`narrate_in_apply` read, `routeConsequencesAfterWrite`/`clerkStep` untouched); new test
`tests/extension/apply-narrate-combined.test.mjs`.

Status: ready-for-human.
