Status: ready (filed 2026-09-26 from long gate #21's first turns; batch 16; P1 latency)
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
