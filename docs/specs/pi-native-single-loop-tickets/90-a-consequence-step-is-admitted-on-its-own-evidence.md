Status: ready-for-human (implemented 2026-09-26)
Stage: SL-90 (P1, admission: the clerk's executed consequence steps)
Spec: docs/kernel-rpc.md §32.12 (a clerk write the compile selected is admitted on the compile's evidence — `path: "compile"`, 0 ms), §135.32 + addenda 2–4 (execute mode per class; `clue_follow_up` executes after a settled write), §32.12.4 (SL-88: concurrent review round); `runtime/jev/hybrid-engine.ts` (`routeConsequencesAfterWrite`, `clerkStep`), `runtime/jev/consequence-route.ts` (cleared Noul, confidence, distribution), `extensions/kernel/admission.ts` (`basis.compile` fast admission)

# SL-90 — A consequence step the clerk executes is admitted on the Jev answer that selected it, not re-reviewed by the lane

## Evidence (gate #21 t3, `longgate21-haunting-*`, grok-4.5 low lanes)
- After the Keeper's `apply time`, execute mode ran three `clue_follow_up` steps (`house-built-1835`, `neighbor-lawsuit-1852`, `basement-burial-lawsuit`, origin `policy`). Each went to the admission lane (`path: "lane"`, `fast_path: true, jev_fallback: "low_confidence"`): 6.2 s `not_player_action`, 5.4 s `not_player_action`, then 13.0 s `review_pending` + 12.9 s `review_timeout` for the third — 38 s of a 45 s operate step, serially, the turn at 94.6 s.
- The compile's own clerk writes on the same turns are `path: "compile"`, 0 ms. The consequence steps carry an equal kind of evidence (the class gate's cleared Noul with its distribution, §135.32 addendum 3.1) but it is not presented to admission, so the lane re-judges — and answers "not the player's action", which is true and irrelevant: a consequence is by definition not a declared action.
- Gate #18 paid the same: 8 consequence steps.

## Ruling (filed for the owner; follows §32.12's compile precedent)
A step executed by the consequence route carries `basis.consequence {class, key, confidence, distribution, gate}` and is admitted on it (`path: "consequence"`, no lane round), exactly as a compile-selected write is admitted on `basis.compile`; the receipt records the path. Only the executed classes (`jev_steps.execute`) get this path; a shadow class never writes. If the consequence evidence is absent or malformed the write takes the ordinary lane path (fail closed). Several consequence steps after one write run through the gateway without waiting on each other's review (there is none).

## Scope
- Contract §32.12 addendum (the `consequence` evidence path) and §135.32 addendum 5; `hybrid-engine.ts` (attach `basis.consequence` to executed consequence proposals), `admission.ts` (admit on it), telemetry `path: "consequence"`.
- Tests (mutation-killable): an executed clue_follow_up write admits with `path: "consequence"` and no lane call (stub lane records zero calls); a write without the basis still goes to the lane; a shadow class never reaches admission; the basis is rejected when its class is not in `execute` (lane path).
- Acceptance on gate #22: `path: "lane"` rows with `origin: "policy"` = 0; turns with consequence steps no longer grow by the lane time.

## Comments

- 2026-09-26, implementation (worker on `claude/sl90-20260926`): landed exactly the filed ruling.
  - Contract: `e529d29f0` -- §32.12.5 (the admission rule, mirroring §32.12's compile precedent) and §135.32
    addendum 5 (the execution-loop pointer), appended at the document's current end per the repo's existing
    numbering convention (§ numbers are stable ids; new addenda are appended, never reordered into their
    "logical" position).
  - Implementation: `8c0b0cec0`.
    - `runtime/jev/consequence-route.ts`: `candidateWithConsequenceBasis(candidate, row, gate)`, pure, mirrors
      `route-compile.ts`'s `interpretCompile` (`basis: {...basisOf(candidate), compile: {...}}`) exactly:
      `basis: {...candidate.basis, consequence: {class, key, confidence, distribution, gate: {row_min, row_ratio}}}`.
      The candidate's own provenance (`read`/`path`/`row`) rides beside it, never replaced.
    - `runtime/jev/hybrid-engine.ts`: `routeConsequences`'s executing loop calls it right before the `clerkStep`
      dispatch, using the same `ConsequenceRow` `interpretConsequenceResult` already produced and the same
      per-class gate (`classThresholds[candidate.consequenceClass]`, from `thresholdsForClass`) already applied
      to decide the row cleared. No new Jev call, no new kernel read -- one line added to the loop SL-78 already
      had.
    - `extensions/kernel/admission.ts`: `consequenceAdmission(evidence, executeClasses)`, pure, mirrors
      `compileAdmission` field for field: `origin !== "policy"` or no `basis.consequence` -> `undefined` (not
      this call's business); a non-empty `class`/`key`, `class` in the caller-supplied `executeClasses`, a
      finite `confidence` in `[0,1]`, a `{true,false}` `distribution` of finite `[0,1]` numbers, and a
      `{row_min, row_ratio}` `gate` with `row_min` in `(0,1)` and `row_ratio > 0` -- every missing/malformed one
      is its own named refusal reason, fail closed.
    - `extensions/kernel/index.ts`: `admitAction` reads `jevStepsBudget()` once (cached; negligible per-call
      cost) for `executeClasses`, computes `consequenced = consequenceAdmission(evidence, executeClasses)`
      beside the existing `compiled = compileAdmission(evidence)`, and `admitOne` gets a second short-circuit
      branch (`if (!part && consequenced?.ok) return settle({verdict: "authorized", ..., path: "consequence",
      reviewer: "consequence"}, ...)`) right after the compile one. `refusedConsequence` (`consequence_refused`)
      is threaded into every telemetry site `refusedCompile` already reaches.
  - Tests: `a6d2b9f29`, `tests/extension/consequence-admission.test.mjs`. Three layers: pure
    (`consequenceAdmission`, `candidateWithConsequenceBasis`, every field's own refusal reason), engine seam
    (`hybrid-engine.ts` driven directly, no Pi session, no kernel -- the `consequence-execute-mode.test.mjs`
    harness extended to capture the dispatched `context`), and the extension seam (real `apply` tool, real
    admission seam, the emitted kernel, the product's hybrid engine with a stub Jev, the harness's scripted
    `table.lanes.admission` counted) -- the last using a **real** scenario from the shipped `the-haunting`
    module (`knott-commission`, turn 1 of a fresh `thomas-hayes` campaign, asking Knott about the job): probed
    directly against `build/kernel/rpc.mjs` first to confirm it is offered in `table.apply.options` ungated,
    then wired into the fixture. Results: an executed `clue_follow_up` write admits `path: "consequence"`,
    `table.lanes.admission.requests().length === 0`; the same write authored by the Keeper directly (no
    `basis.consequence`) keeps the ordinary lane review (`table.lanes.admission.requests().length >= 1`); an
    unlisted class (`npc_reaction`, cleared exactly as the clue is, per SL-78's own existing test) never
    dispatches at all, so it never carries the evidence either -- "a shadow class never reaches admission" is
    true because there is no call for admission to see, not because admission itself special-cases it.
  - Mutation testing (scratch copies under `/private/tmp/.../scratchpad/sl90-mutation`, `cp` in and out, never
    `git checkout --`/`git stash`, restored and diffed clean afterward): `consequenceAdmission` forced to
    `return undefined` unconditionally -- red (pure test and extension-seam test both); the `admitOne`
    consequence branch neutralized (`if (false && ...)`) -- red (extension-seam test); the enriched candidate
    dropped before `clerkStep` in `hybrid-engine.ts` (passing `{candidate}` instead of `{candidate: executed}`)
    -- red (engine-seam test and extension-seam test both); the `class_not_executed` check disabled -- red
    (pure test). Every mutation restored from the pre-mutation copy before moving to the next.
  - Test runs (locally, `node --test`, this worktree, `build/kernel/rpc.mjs` already current -- no
    `build:runtime` needed): the new file alone, all `admission*`/`consequence-*`/`single-loop-*` files together
    (348 tests, 0 failures, ~97 s) both green before and after mutation restoration. Did not run the project's
    full `test:ext`/pytest suites, per instruction (the coordinator runs those after merge).
  - Left for the human: gate #22 (the acceptance line, "`path: "lane"` rows with `origin: "policy"` = 0" and
    "turns with consequence steps no longer grow by the lane time") needs a live table and is out of scope for
    a worker session (no live model calls). `EXT_JEV_APIKEY`/live-Jev-backed variants of the extension-seam
    tests were not added -- the stub `DecisionPort` the existing `consequence-*`/`single-loop-*` suite already
    uses throughout was judged sufficient and consistent with house style.
- Live (gate #22): 6 consequence steps admitted on their own evidence, 0 on the lane.
