Status: ready-for-human (filed 2026-09-26; owner: "不需要等结果的写入和 narrate 合进同一次调用……只要不阻塞的就完全可以并行，能不等就不等"; batch 16; implemented 2026-09-26 by claude/sl88-20260926, see Comments)
Stage: SL-88 (P1, latency: Keeper steps and host waits on the critical path)
Spec: docs/kernel-rpc.md §135.5 (Keeper batches run in order; a refused step stops the rest), §32.12 / §32.12.3 (a batch is reviewed whole; line-level admission), §34.13–§34.14 (markers, rendered delivery), §135.11 (turn close), §135.25 (run budget); `extensions/kernel/tools.ts` (apply / narrate descriptions), `runtime/jev/hybrid-engine.ts` (`modelStep`, `clerkStep`, `routeConsequencesAfterWrite`), `extensions/kernel/index.ts` + `admission.ts` (`admitAction`)

# SL-88 — What needs no result does not wait for one: non-blocking writes go out with the narrate in one call, and the host starts every independent wait at once

## Evidence (long gate #18, grok-build/grok-4.5 low, 20 turns, 881 s input-to-delivery)
- Keeper inference is 55% of the wall: 56 calls, 2.8 per turn, 9.3 s each. A fit over the 56 calls (R² 0.90): call time ≈ 1.44 s fixed + 19.3 ms per generated token (≈ 52 tok/s; generated includes reasoning) + 0.047 s per 1k uncached input. Of the 501 s of calls: generation 77% (visible 214 s, reasoning 171 s), fixed 16%, uncached prefill 7%.
- The Keeper issues one tool per call and waits: typical turns are `apply → narrate` or `apply → resolve → apply → narrate`; 18 standalone `apply` calls generated 7,092 tokens (≈ 382 each incl. reasoning). A clue reveal, a move, a time advance, a person staged — their landing is fixed by their own arguments, yet the Keeper waits a full call (fixed cost + a fresh reasoning pass ≈ 3–5 s) to write the prose it could have written with them.
- Every batch step is reviewed and executed strictly in sequence: 65 tool executions, 0 overlapping; Keeper `apply` p50 4.9 s / max 10.5 s, `resolve` p50 4.6 s, almost all admission-lane time.

## Ruling (owner, 2026-09-26)
Anything that does not block does not wait.
1. **Keeper side.** A step *blocks* only when the prose depends on a result the Keeper cannot know in advance: `resolve` (the roll's outcome), `look` / `lookup` / `recall` (information it has not read). Every other write — an `apply` whose landing is fixed by its own arguments — is *non-blocking* and goes in the same message as the `narrate` that describes it: one call, the writes first, the narrate last. §135.5's order and failure branch stand unchanged: a refused write stops the batch, the narrate is not executed, the Keeper repairs. Say this in the `apply` and `narrate` tool descriptions and in the Keeper's turn-flow guidance (mind the brief/style byte budgets).
2. **Markers for writes the Keeper has not seen answered.** A narrate that shares a batch with its writes cannot copy the markers those writes return. It may name the effect instead: `{{<kind>:<handle>}}` (e.g. `{{clue:globe-fire-cutoff}}`, `{{move:newspaper-morgue}}`) resolves to this turn's receipt for that effect; an effect key that matches nothing is dropped exactly as an unknown marker is today (§34.13/§34.14 unchanged). Closed vocabulary: the kinds are the kernel's receipt kinds, the handle is the one the write named — no text matching.
3. **Host side.** Every wait on the critical path that does not depend on an earlier step's effect starts at once. At minimum: the admission reviews of all write steps of one model response start together as one lane round (the batch is already reviewed whole in meaning, §32.12; the per-step sequential rounds are only an implementation order), and settle in the batch's order; a later step's verdict is not reused if an earlier step of the batch was refused. Inventory every other `await` between the player's input and the delivery in `hybrid-engine.ts` / `index.ts` and parallelise the ones whose inputs are ready (record the inventory in the ticket); leave any whose order is a contract (read before route, §135.6; guard after effects, §135.30.5).

## Scope
- Contract: §135.5 addendum (blocking vs non-blocking, the batch shape) and §34.13 addendum (effect-key markers), §32.12 addendum (one review round per response) — before code.
- `extensions/kernel/tools.ts` descriptions; the Keeper turn-flow text wherever the system prompt assembles it; `narrate` marker resolution (kernel `render` / wherever markers are resolved); admission batching; the await inventory.
- Tests (mutation-killable): a batch `[apply clue, apply time, narrate {{clue:x}}]` settles both writes, resolves the effect-key marker to the clue receipt, delivers in one model step; a refused first write leaves the narrate unexecuted and returns to the Keeper; an effect key naming nothing is dropped; admission for two writes of one response runs in one round (assert concurrency with a stub lane that records overlap); a batch containing a `resolve` before the narrate is still allowed but the guidance says to wait (no host refusal).
- Acceptance on a live table (gate #21, grok-4.5 low): Keeper calls per turn ≤ 2.0 (from 2.8); median wall ≤ 40 s (from 49); ≤ 60 s 20/20.

## Comments

**2026-09-26, worker (claude/sl88-20260926, head 8deb4dd94). Landed.**

Contract (before code): §135.5.1 (blocking vs non-blocking, the batch shape), §34.13.1 (effect-key markers), §32.12.4
(one admission round per response) -- all in `docs/kernel-rpc.md`, inline with the existing numbering convention
(`#### 135.5.1 Addendum`, `**34.13.1 Addendum**` beside 34.x's own inline-bold style, `#### 32.12.4 Addendum`).

1. **Tool descriptions + turn-flow guidance** (one/two sentences each, per the ruling):
   - `extensions/kernel/tools.ts`: `apply`'s description gained "Its landing is fixed by the arguments you give it
     ... put this call and the narrate that follows it in one message, writes first, narrate last (contract
     §135.5)."; `narrate`'s gained the effect-key sentence with both examples from the ruling.
   - `kernel-ts/read/assemble.ts`'s `SILENT_WRITES` and `runtime/jev/hybrid-engine.ts`'s `CLERK_NOTE_HEAD` (the two
     near-duplicate strings the capsule head and the run's first clerk note carry) now name which calls block and
     which do not, instead of only saying writes are silent. Both stay outside every section budget (§135.11.1); no
     test asserts their exact wording, only equality with the exported constant (`tests/extension/beside-drop-
     row.test.mjs`, `tests/extension/single-loop-note-head.test.mjs`), so the wording change is free.

2. **Effect-key markers** (`kernel-ts/write/text.ts`): `effectKeyHandle` (the handle-bearing kinds: `move`, `clue`,
   `item`, `handout`, `map`) and `effectKeyReceipt` (kind:handle -> receipt id, first match, closed vocabulary, no
   text search). `bindMarkers` tries the ordinary placement name first (unchanged) and falls back to an effect key
   only when that misses, so nothing about the existing scheme changed for a receipt that already resolves through
   it. Rebuilt into `build/kernel/rpc.mjs` (the emitted kernel is what `tests/extension/*.test.mjs` and PipiCOC's
   installed App both run; `kernel-ts/` alone changes nothing until `npm run build:runtime`).

3. **Admission concurrency** (`extensions/kernel/index.ts`): `message_end` -- the same hook that already reads the
   whole assistant message for §135.11.1/§34.17/§78, before any of its calls has reached `runTool` -- now starts a
   review for every `apply`/`resolve` of a batch of **two or more** reviewed calls (a lone write gains nothing from
   starting one hook earlier, and leaving it alone kept every single-call admission timing test's exact shape
   intact, see "what broke" below). `prefetchAdmission` clones and normalizes each call's raw arguments the way
   `runTool` will, builds the identical proposal `admitAction` would (`admissionScopeBuilder`, extracted from
   `admitAction`'s own top so the two paths cannot drift -- same for `admissionContextFor`), and parks
   `reviewAdmissionPrimary`'s promise in `state.admissionPending` under the proposal's key, tagged `prefetched:
   true`. `admitOne` collects it exactly where §32.12.2's own resend already collects a running round from -- no
   new collection code, only the fix below to keep the two collectors' *meaning* apart.

   **What broke, and the fix.** The first real run of `tests/extension/admission-within-turn.test.mjs` and
   `admission-late.test.mjs` after wiring this in flipped four passing assertions to `review_timeout` where
   `review_pending` (or a live verdict) was expected. Cause: `admitOne`'s `if (pending && noVerdict)` shortcut existed
   to say "the Keeper already read a `review_pending` refusal for this exact call once, so a second no-verdict
   answer is final" -- but a *prefetched* entry has never been shown to the Keeper at all, so from its seat this is
   the **first** attempt, and treating it as a resend skipped the ordinary late-admission/park-for-a-real-resend
   handling every fresh review is supposed to get when it hits its own cap. Fixed by gating the shortcut on
   `!pending.prefetched`; a collected prefetch that still has no verdict now falls through to the same
   `lateAdmission`/park logic a fresh `review()` reaching its cap would, and only re-parks itself (without the
   `prefetched` tag) so a *real* future resend still gets the immediate-timeout treatment it should. Telemetry: a
   collected prefetch carries `concurrent`/`concurrent_wait_ms` in place of `resend`/`resend_wait_ms`, so a reader of
   admission rows is not told a resend happened when the Keeper never saw a refusal to resend.

**Await inventory** (`runtime/jev/hybrid-engine.ts`'s `read` port, `modelStep`, `clerkStep`,
`routeConsequencesAfterWrite`, and `extensions/kernel/index.ts`'s `runTool`), before/after:

| Site | Before | After | Why |
| --- | --- | --- | --- |
| `message_end`: admission review start, for 2+ write calls of one response | Each call's review starts only when `runTool` reaches it -- strictly after the previous call's whole execution (gate #18: 65 executions, 0 overlapping) | All such reviews start together, from `message_end`, before any call has run (§32.12.4) | The ticket's own "at minimum" ask; the only await in this inventory whose start time did not already depend on an earlier step's own effect |
| `read` port: `tableReads` -> `prepareKeeperSupport` (prescreen) -> `readCandidateBodies` | Sequential | Unchanged | Each depends on the previous: the prescreen needs the read's own `capsule`/`table.binding`; candidate bodies are built *after* the locate so a located clue/handout is among them (comment in the source itself). This is §135.6, "read before route", verbatim |
| `modelStep`: `execute()` -> `freshOf(run)` -> `routeConsequencesAfterWrite(...)` | Sequential | Unchanged | `freshOf` needs to know the write landed; `routeConsequencesAfterWrite` needs the *fresh* post-write state to price D1 consequence classes for the Keeper's next note -- exactly §135.30.5, "a guard is evaluated after the effects the same declaration files". Making this fire-and-forget would let the run's next step read stale `run.consequenceCandidates` |
| `clerkStep`: `dispatcher.dispatch(...)` -> `freshOf(run)` -> `routeConsequencesAfterWrite(...)` | Sequential | Unchanged | Same shape as `modelStep`'s, for the clerk's own writes; same §135.30.5 reason |
| `runTool`: `attributeUnwrappedSpeech` (narrate's speech attribution) -> `mods.prepare` (Mod hooks) | Sequential | Unchanged | `mods.prepare` reads `payload.text`, which `attributeUnwrappedSpeech` mutates in place; reordering would hand Mods the unattributed draft |
| `runTool`, post-kernel-write enrichments: `prepareMapViews(state, result)` (unconditional) beside the `resolve`-only defense-settlement block (`settleStandingDefense`, session refresh) | Sequential (map views first, always; defense settlement only for `resolve`) | **Identified, not changed** | Both mutate the same `result` object via `result = {...result, ...}` spreads. Running them concurrently risks one branch's spread missing the other's still-pending mutation -- a real race, not just a relabeling. The two are also not simultaneously applicable today except by coincidence of call order, so the safe fix (reconciling two mutations of one shared object) is a small refactor of its own; deferred rather than risked under this ticket. Left as a named candidate for a future ticket, not a silent gap |

Nothing else on the path from the player's input to the delivery is a candidate: every remaining `await` either reads
kernel/session state the very next line needs, or is already the single write §135.5 says runs in order. No `Date.now()`/
timer helper was touched in `hybrid-engine.ts` -- the one new site (`prefetchAdmission`, in `index.ts`) uses
`admissionTimeoutMs()`/`admissionHardCapMs()` (existing helpers) for its parked entry's `capMs`/`hardCapMs`, matching
exactly what a fresh `reviewAdmissionPrimary()` call would compute for itself.

**Tests** (mutation-killable; fake pi / stub ports, per the neighbours):
- `tests/extension/admission-concurrent-batch.test.mjs` (hybrid engine, real kernel, a stub admission lane that
  timestamps each request's start/answer): two writes of one response show the second request starting before the
  first answers (proves overlap directly off the clock, never inferred from a margin); a batch whose writes both
  refuse leaves nothing landed, the batch's remaining steps recorded `batch_step_fell`, and the run recovers on its
  next message without hanging or an unhandled rejection from the uncollected prefetch.
- `tests/extension/narrate-non-blocking-batch.test.mjs` (hybrid engine, real kernel): `[apply clue, apply time,
  narrate {{clue:x}}]` lands both writes, delivers in the Keeper's one call (`lane: "provider-call"` count == 1),
  and the turn record's `mechanics`/`receipts` show both landed with no brace in `rendered_text`; a refused first
  write leaves the second write and that message's own narrate un-executed (`batch_step_fell`, `batch_fallen`'s
  next `infer`) and the turn closes on the Keeper's next message instead; a `resolve` before a `narrate` in one
  message still runs to completion (no host refusal -- the shape is guidance only).
- `tests/extension/ts-kernel-write.test.mjs` (direct `createWriteRuntime` RPC, no agent loop -- the precise unit
  level for the marker mechanism itself, added beside its existing "ask and narrate share delivery formatting"
  test): `{{move:x}}` and `{{clue:y}}` both resolve via the effect key to a synthetic same-turn receipt injected
  with `commitResolve`, with no `dropped_markers` and the literal token still standing in `marked_text` (never
  translated to the ordinary scheme's `scene:` name); an effect key naming no receipt of the turn is dropped exactly
  like an unknown marker (`dropped_markers.unknown`), the prose still delivers, and the mechanic that did land still
  projects.

**Mutation evidence** (copy to scratch, edit, run, copy back -- never `git checkout --`): reverting the prefetch
trigger's threshold (`reviewedCalls.length > 1` -> `> 999`, i.e. disabling prefetch) kills
`admission-concurrent-batch.test.mjs`'s overlap assertion (`the second call's review started ... before the first
one answered` fails: actual `false`). Reverting `effectKeyReceipt` to always return `null` kills
`ts-kernel-write.test.mjs`'s new "resolves ... without copying its placement marker" test (`dropped_markers`
appears where none was expected). Both restored from the backed-up originals before any further edit; `git diff
--stat` afterward shows only the intended net changes (no drift from the mutation round-trip).

**Regression sweep** (files directly touched or immediately downstream; full `test:ext` is leehow-pc's job, not
run here): `admission*.test.mjs` (100/100), `single-loop-*.test.mjs` (174/174) + `single-loop-model-call-
diet.test.mjs` (11/11), `beside-drop-row.test.mjs` (7/7), `system-language.test.mjs`, `turn.test.mjs`,
`jev-apply-host.test.mjs` (47/47 combined), `ts-kernel-write.test.mjs` (18/18 with the two new tests) -- all green
after the `noVerdict`/`!pending.prefetched` fix; before it, four `admission-within-turn`/`admission-late` cases
regressed as described above.

**What I could not do.** The `prepareMapViews`-vs-`settleStandingDefense` concurrency candidate in the await
inventory above is named but not implemented -- it needs the shared `result` object's mutations reconciled first,
which is outside this ticket's blast radius as I read it. No live-table acceptance run (gate #21) was attempted:
that is a real-model playtest, explicitly out of scope for a worker session per `Agents.md`'s absolute ban on
fake-KP shortcuts, and the ticket's own acceptance line is the owner's to run.

**Files:** `docs/kernel-rpc.md` (§135.5.1, §34.13.1, §32.12.4 addenda); `extensions/kernel/tools.ts` (`apply`/
`narrate` descriptions); `kernel-ts/read/assemble.ts` (`SILENT_WRITES`); `runtime/jev/hybrid-engine.ts`
(`CLERK_NOTE_HEAD`); `kernel-ts/write/text.ts` (`effectKeyHandle`, `effectKeyReceipt`, `bindMarkers`);
`extensions/kernel/index.ts` (`admissionScopeBuilder`, `admissionContextFor`, `prefetchAdmission`, the
`message_end` prefetch loop, `admitOne`'s `!pending.prefetched` fix); new tests
`tests/extension/admission-concurrent-batch.test.mjs`, `tests/extension/narrate-non-blocking-batch.test.mjs`;
additions to `tests/extension/ts-kernel-write.test.mjs`.

Status: ready-for-human.
- Live (gate #21): batches 4 (from 1), Keeper calls/turn 2.8 unchanged, concurrent admission 0 triggers (no 2+-write response). Guidance-only did not move grok; SL-92 carries it structurally.
