Status: ready-for-human (worked 2026-09-26 on `claude/sl76-20260926`, head `485c84023`; after SL-71/72/73 merge — shares `hybrid-engine.ts`/`candidates.ts`)
Stage: SL-76 (P1, Stage 2a of `docs/specs/jev-driven-steps.md`: the three consequence candidate classes, shadow-routed)
Spec: docs/specs/jev-driven-steps.md D1–D4; docs/kernel-rpc.md §135.32; §135.2/§135.3 (candidates, clerk authority), §135.30 (fan-out rows), §32 affordances, §136 (rules as data); load the `typesafe-jev` skill first

# SL-76 — `npc_reaction`, `clue_follow_up`, `time_cost` become host-issued candidates, routed by Jev in shadow

## Scope
1. Contract §135.32 (written) is the rule; add the `consequence_bookkeeping` clerk authority to §135.3 as an addendum.
2. `runtime/jev/candidates.ts` (+ a new `consequence-candidates.ts`): the three classes exactly as D1 — sources, bound parameters, the Noul text per class with the criteria fields (`what`, `not_for`, `examples` from the person's role/position; the clue's book placement), the per-family `exists` Noul (D2.2). No candidate for a person the graph does not know, for hazards, sanity, pending choices.
3. `runtime/jev/route-compile.ts`/`step-policy.ts`: the new rows enter the same fan-out; thresholds from `content/rulesets/coc7/host-budgets.json` (add `jev_steps: {row_min, row_ratio, shadow: true}` beside `look_budget`); no literals.
4. `runtime/jev/hybrid-engine.ts`: `COC_JEV_STEPS=shadow|on|off` (default `shadow`); in shadow the cleared D1 candidates are never executed; at turn close pair each with the Keeper's own calls of the turn (same NPC first-impression / same clue handle / a time advance) and write `{lane:"route", shadow:true, class, key, cleared, confidence, distribution, keeper_did}`; in `on` they run as clerk steps (SL-78 accepts `on`; this ticket lands the switch and the shadow path).
5. Tests (mutation-killable, `tests/extension/`): each class issues only under its condition (met NPC → no candidate; discovered clue → none; gate unsatisfied → none; stated time cost → direct not a question); the rows carry no kernel tags; shadow never executes (assert zero clerk writes with a stub port that clears everything); the pairing row is written for the three outcomes; `packing_limit`/outage degrade to no D1 rows and a telemetry reason.
6. Keep the run's Jev budget honest: report added Jev ms per turn in the ticket from a replay of gate #12 t1/t7/t14.

## Comments

### 2026-09-26, worker: landed items 1-5; item 6 (live replay ms) not done -- see below

**What landed, by scope item.**

1. Contract §135.3.1 addendum (`docs/kernel-rpc.md`) adds `consequence_bookkeeping` to `CLERK_AUTHORITY`, written
   before the code per the ticket's rule. A §136.10-table addendum documents the one new structural kernel read
   this ticket needed and wasn't already exposed: `capsule.where.rules[].time_cost`/`handle`
   (`kernel-ts/read/mech-line.ts`'s `mechRow`), the same "typed, no `book` line" shape `ModuleGraph.statedRewards`
   already gives a rule's `reward`. Additive only: a rule with no `time_cost` shape gains no new key.
2. `runtime/jev/consequence-candidates.ts` (new): `npcReactionCandidates`, `clueFollowUpCandidates`,
   `timeCostCandidates`, and `buildConsequenceCandidates`. Each class issues only under its stated condition; no
   candidate for a person the graph does not know, a hazard, sanity, or a pending choice (none of those have a
   builder here at all). `npc_reaction` reads `capsule.mods.pending_contacts` filtered to
   `natural-npc:first-impression`; `clue_follow_up` reads `table.apply.options.candidates`' clue rows (the kernel's
   own gate, already enforced before the row is issued at all -- no gate is re-evaluated here); `time_cost` reads
   the new structural `where.rules[].time_cost`, direct when stated (`apply {kind:"time", stated:<handle>}`, no
   Noul at all), a Noul only for an `amount_unstated` shape, whose `minutes` stays open and Keeper-owned (no
   rules default exists anywhere in the codebase for an arbitrary time amount, so none is invented; see "left
   open" below).
3. **Deviation from scope item 3, please confirm:** the new rows do **not** enter `route-compile.ts`'s existing
   fan-out. A first attempt tried exactly that (asking Jev mid-read, in the same call cadence as the compile), and
   it broke `single-loop-compile.test.mjs`'s "the compile is the run's first Jev question" and
   `single-loop-prescreen-budget.test.mjs`'s "a `read_more` on the same scene spends no Jev call" (§135.6's reuse
   rule) -- both pre-existing, accepted tests. `runtime/jev/consequence-route.ts` is a **separate** batch/family
   (`single-loop-consequence`), asked once per run from `turnCloseStep` (see below), never able to select or
   change anything the route/compile fan-out chooses. It still reuses the same row-gate shape (`ROW_MIN`/`ROW_RATIO`
   from §135.30.9.1), just read from `content/rulesets/coc7/host-budgets.json`'s new `jev_steps` entry
   (`runtime/jev/host-budgets.ts`) instead of being a second literal.
4. `runtime/jev/hybrid-engine.ts`: `COC_JEV_STEPS=shadow|on|off` (`jevStepsMode`, default `shadow`, read once per
   process). **The one Jev call for this ticket's shadow route fires once per run, at turn close** (inside
   `turnCloseStep`, after the run's own route/compile/bind calls are done), not per read as scope item 4's own
   wording ("at turn close pair...") could be read either way -- the mid-read version was the one that broke the
   two tests above; turn-close is also simply the more literal reading of "at turn close ... pair ... and write".
   The pairing telemetry (`{lane:"route", shadow:true, class, key, cleared, confidence, distribution, keeper_did}`)
   is read off the turn's own receipts (`run.turnReceipts`, accumulated every read from `table.status.receipts`),
   never off a model-origin call's arguments, which this engine does not otherwise retain anywhere. `keeper_did`'s
   three outcomes: `true` (the same entity), `other` (the same kind of consequence, a different entity this turn --
   `npc_reaction`/`clue_follow_up` only; `time_cost` has no second entity), `false` (neither). `on` runs a cleared
   candidate through the existing `clerkStep` gateway, once per key per run (`consequenceKeysToExecute`); nothing
   beyond that switch is SL-78's to accept.
5. Tests: 33, all pure (no Jev, no kernel subprocess), across four files -- see below.
6. **Not done.** Reporting live-replay Jev ms per turn from gate #12 t1/t7/t14 needs a live Jev key
   (`EXT_JEV_APIKEY`) and, per this repo's standing rule against unauthorized live-model calls or self-authorized
   playtest shortcuts, that is outside what this worker session may do on its own. `experiments/single-loop-routing/run.mjs
   --llm replay` exists but was not run. Reporting a number here would be a guess, which the ticket explicitly does
   not want; someone with the live key and standing authorization to run it should do this one.

**A regression found and fixed before committing.** An initial version excluded the natural-npc first-impression
row from `candidates.ts`'s generic `mod_contact` loop (reasoning: "npc_reaction now owns this decision"), on the
assumption that decision was newly up for grabs. It is not: `mod_contact` already offers it live, and
`single-loop-candidates.test.mjs`'s "candidates come from the kernel's own reads" already asserts
`contact?.clerk === "mod_contact"` for it. Removing it broke that pre-existing, accepted test. Fixed by reading
the same `pending_contacts` row from **both** places: the live `mod_contact` candidate (`buildCandidates`,
unchanged) and the shadow-only `npc_reaction` candidate (`buildConsequenceCandidates`, wholly separate list). They
carry different `key`/`family`/`clerk` and only the live one is ever offered to the route/compile fan-out or
executed. `clue_follow_up` was designed the same way from the start (additional to, never in place of, the live
`apply:clue` family). Caught locally by running the exact previously-failing test files after a
`node scripts/build-runtime.mjs`, not by trusting the change.

**Suite evidence.** A full `test:ext` run on leehow-pc (accidentally concurrent with a `loop` run on the *same*
worktree path -- a mistake, not a repeatable measurement) showed 12 failures, all traced locally afterward: the
`mod_contact` exclusion above (1 test) and the mid-read Jev call disrupting call-order/call-count assertions in 11
others (`single-loop-compile`, `single-loop-prescreen-budget`, `scene-obligation-candidates`,
`preparation-wait-never-strands`, `npc-preparation-integration`, `single-loop-carried-views`,
`jev-source-domain`; the last few were likely also touched by the concurrent-run build race, but the fixes above
made them all pass regardless). After both fixes, every one of the 26 `createHybridEngine`-using test files, plus
`single-loop-candidates.test.mjs` (SL-02's own acceptance test) and the two files above, ran green locally
(`node --test`, after `node scripts/build-runtime.mjs`) -- roughly 250+ individual test cases across ~30 files,
none touched by this ticket's product code left red. The coordinator asked that a consolidated full-suite
acceptance run on the merged head, not this worker, be the final `test:ext`/`loop`/`pytest` gate; this worker did
not re-run those full suites after the fix (box time). `kernel-ts` (the `mech-line.ts` change) type-checks clean:
`npx tsc -p tsconfig.kernel.json --noEmit` exits 0.

**This worker's own new tests: 33, all pure, all pass** (`node --test tests/extension/consequence-candidates.test.mjs
tests/extension/consequence-route.test.mjs tests/extension/consequence-shadow-gate.test.mjs
tests/extension/consequence-host-budgets.test.mjs`):
- `consequence-candidates.test.mjs` (14): each class issues only under its condition; no kernel tag leaks into a
  model-visible field.
- `consequence-route.test.mjs` (8): the Noul row gate and its threshold sensitivity; the batch shape (one Noul per
  asked candidate, one `exists` Noul per class, a direct candidate never asked); no kernel tag in the state sent to
  Jev; an outage/incomplete batch clears nothing, with a reason.
- `consequence-shadow-gate.test.mjs` (6): `jevStepsMode`'s default and the two named values; shadow/off never
  execute however much clears (the whole of "shadow never executes", as a pure function of inputs rather than
  something to trust from reading the control flow); `on` executes cleared/unexecuted keys once each;
  `keeperDidFor`'s three outcomes per class.
- `consequence-host-budgets.test.mjs` (5): thresholds read from `content/rulesets/coc7/host-budgets.json`
  (mutating the file's own values changes what comes back); out-of-range/missing fields and an unreadable file
  fall back field-by-field to the shipped default.

**Mutation evidence** (copy the file to `/tmp`, edit the copy in place over the real file, run, restore from the
`/tmp` copy -- never `git checkout --`/`git stash`): confirmed each of these turns a passing test red and restoring
turns it green again --
- `consequence-candidates.ts`: dropping the `decision !== NPC_REACTION_DECISION` filter (1 test fails);
  `statedAmount` forced to always `false` (2 tests fail, including the key-collision count).
- `consequence-route.ts`: dropping the ratio half of `noulClears`'s gate, keeping only the min (2 tests fail:
  the row-gate boundary and the interpret test's 0.6-is-unresolved case).
- `hybrid-engine.ts`: dropping the `mode !== 'on'` guard in `consequenceKeysToExecute` (1 test fails: shadow/off
  would then execute cleared rows -- exactly the defect the ticket asks to prove killed); collapsing
  `keeperDidFor`'s `other` branch to `false` (1 test fails: the pairing's third outcome).

**Left open / for the human.**
- Confirm the `time_cost` clerk authority. §135.32 (the contract) says all three classes are
  `consequence_bookkeeping`; the design doc `docs/specs/jev-driven-steps.md`'s D1 table says `time_cost`'s is
  `declared_bookkeeping`. This worker followed the contract (per instruction received mid-task); the spec's D1
  table should be corrected to match, but this worker did not touch the spec file.
- The design doc's "a Noul ... only for a shape marked `_unstated` with a rules default" implies a rules default
  for `minutes` exists; none is defined anywhere in the codebase. `timeCostCandidates` leaves `minutes` as a
  required, open (never closed) parameter for that case, which the existing `clerk_unbound`/Keeper-adjudicate path
  (§135.28) already handles correctly if `on` mode is ever wired to bind it -- this ticket did not invent a
  default rather than leave a gap silently.
- The clue's Noul criteria and the npc_reaction's Noul criteria do not yet carry the richer `what`/`not_for`/
  `examples` structured fields scope item 2 mentions (role/position, book placement) -- they carry plain-string
  `instructions`/`criteria.true`/`criteria.false`, which is a valid, simpler Noul shape per the `typesafe-jev`
  skill, but not the fuller structured form. Whoever runs the first shadow tables (gates #13/#14) may want to
  richen these before trusting the agreement-rate numbers D6 asks for.
- SL-78 (execute) and SL-77 (the agreement report) are unstarted; this ticket's `on` path is wired but unaccepted.

**Files touched:** `docs/kernel-rpc.md`, `content/rulesets/coc7/host-budgets.json`, `kernel-ts/read/mech-line.ts`,
`runtime/jev/host-budgets.ts` (new), `runtime/jev/consequence-candidates.ts` (new),
`runtime/jev/consequence-route.ts` (new), `runtime/jev/candidates.ts`, `runtime/jev/step-policy.ts`,
`runtime/jev/hybrid-engine.ts`, and the four `tests/extension/consequence-*.test.mjs` files.

**Commits** on `claude/sl76-20260926`: `5ac4d94d4` (contract + rules data), `ecb39b04d` (kernel structural read),
`d2e095c18` (runtime implementation), `485c84023` (tests).
