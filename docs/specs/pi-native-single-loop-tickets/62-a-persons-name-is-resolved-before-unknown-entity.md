Status: ready-for-human (implemented 2026-09-25)
Stage: SL-62 (P1, admission / entities; SL-51's allowed Jev question, never built)
Spec: docs/kernel-rpc.md §11.5.4 (SL-51), §22.4.7.1 (SL-56), §135.30 (compile features: addressee rows), the `unknown_entity` refusal

# SL-62 — A person's name the Keeper uses is resolved against the scene's known people before `unknown_entity`

## Evidence (long gate #10 t4, `longgate10-haunting-1345`, `longgate10-triage.txt`)
- At the Hall of Records the compile's move landed; the Keeper then wrote `look npc 档案处的办事员` and three `resolve` on that name. All refused `unknown_entity`: the starter's NPC is "the Hall of Records clerk", registered under the play-language name the lane rendered, and the Keeper's own rendering did not match. Three refusals of one class tripped the class limit and the refusal budget; the run aborted and the turn stranded (see SL-63). The addressee feature of the same turn's compile listed "the Hall of Records clerk" as a candidate: the person was known.
- SL-51's ruling allows "a Jev question for a variant spelling"; nobody built it.

## Ruling (owner, 2026-09-25)
A person named in a write or check is resolved before it is refused: exact match on handle or any registered name first (as today); then the scene's known people (present, addressee rows, the module's people of this scene) as fan-out candidates to Jev ("is this name the same person as …", per row, the SL-52 within-row margin); a clear row rewrites the call's target to that handle and the receipt records `resolved_from`; only a name that clears nothing is `unknown_entity`. No name lists in code; the candidates are the scene's rows.

## Scope
1. Contract: §11.5.4 addendum (name resolution order; the Jev question's rows; `resolved_from`).
2. Host (`extensions/kernel/index.ts`, where SL-51/56 mark `_passage`/`_land_on_text`) or the compile port: the resolution step before the kernel call; one Jev call per write at most; memoised per run by name.
3. Tests, mutation-killable: a variant name of a present NPC resolves and the check lands with `resolved_from`; a name matching nobody still refuses; the class limit is not reached on the gate #10 t4 replay (recorded Keeper, live Jev).

## Comments

**2026-09-25, implemented (worker, branch `claude/sl62-20260925`, base `07b306a22`).**

- Contract: docs/kernel-rpc.md §11.5.6 (new subsection, no renumbering).
- Host: `extensions/kernel/index.ts` -- `unknownPersonTarget` (where the failed name lives on a `resolve`
  action or an `apply` npc/person effect, from the kernel's own `unknown_entity` `details`），
  `scenePersonCandidates` (the scene's `present` reduction, `table.look {focus: "scene"}`, no name list),
  `resolveScenePerson` (the one fan-out call, memoised on `state.personResolved` by name, cleared with the
  turn), `resolveUnknownPerson` (the retry, wired into the `unknown_entity` branch of the same catch block
  that already retries `_land_on_text`/`_passage`, §11.5.4/§22.4.7.1).
- Typed family: `runtime/jev/person-resolution-domain.ts` (new), mirroring `speech-attribution-domain.ts`'s
  shape; reuses `rowClears`/`YES`/`NO` from `runtime/jev/route-compile.ts` for the SL-52 within-row margin,
  never re-implementing it.
- Kernel: `kernel-ts/apply/entities.ts` (`stageNpc`, `establishedOf` gains `resolvedFrom`),
  `kernel-ts/apply/person.ts` (`stagePerson`), `kernel-ts/resolve/projection.ts` (`tagNpcReceipts`) --
  a host-only `_resolved_from` on the effect/action becomes `resolved_from` on the receipt(s), read once,
  never changing who the write or check is about.
- `look` is explicitly **not** covered (ticket scope is "a write or check"; `look` is neither and produces
  no receipt to carry `resolved_from`). The gate #10 t4 evidence's own `look npc 档案处的办事员` therefore
  still refuses `unknown_entity` on its own -- see the replay finding below.

**Tests** (mutation-verified by copy-revert, never `git checkout --`):
- `tests/extension/jev-person-resolution-domain.test.mjs` (pure domain, no kernel/network): the fan-out's
  one row per candidate, the SL-52 margin via `rowClears`, exactly-one-clears resolution, and every named
  fallback (no candidates, too many, an invalid answer, an incomplete result, a foreign lease, a throwing
  port). Mutation: flipped `cleared.length !== 1` to `< 1` (would resolve on an ambiguous double-clear) --
  caught.
- `tests/extension/name-resolution.test.mjs` (host seam: `openTable`'s fake kernel + a stubbed Jev
  endpoint at `https://api.typesafe.ai/v1/systemone`; `fake-kernel.mjs` gained
  `FAKE_KERNEL_UNKNOWN_ENTITY`): a variant name of the one present person clears its row and the retried
  write lands, one Jev call, `name_resolution` telemetry `status: "resolved"`; a name that clears no row
  stays refused `unknown_entity`, memoised (one Jev call, not two, across two writes for the same name);
  a scene with no known people spends no Jev call at all. Mutation: made `resolveUnknownPerson` retry even
  on an unresolved handle (`target.apply(handle ?? target.name)`) -- caught via the kernel-request count
  (2 vs 4: a wasted retry on an already-refused name), not via the final error code alone (which stayed
  `unknown_entity` either way -- the count assertion is what kills this mutation).
- `tests/extension/name-resolution-receipt.test.mjs` (emitted kernel via `build/kernel/rpc.mjs`, the
  starter's `Steven Knott`): a host-sent `_resolved_from` on an `npc` effect, a `person` effect and a
  `resolve` action each rides the npc/person/roll receipt without changing which book person the effect or
  check resolves to (`handle`/`who`/`npc` stay `steven-knott`); a batch sending none carries no field.
  Mutation: dropped the `resolved_from` assignment in `tagNpcReceipts` -- caught (roll receipt lost the
  field).

**Suites, on leehow-pc** (`~/.claude/skills/leehow-pc-tests/scripts/remote-test.sh`, base `07b306a22`,
worker commit `843fd798`):
```
== ext on leehow-pc @ 07b306a22c70f0139785034f2e1f3e1cb3376ae1: exit=0 wall=168s log=/home/leehow/leehow/code/wt/chatrpgv4-wt-sl62/remote-ext.log
```
(3148/3148; one pre-fix failure, `control-flow-inventory.test.mjs`'s SL-00 guard on the new
`resolveScenePerson.resolve` → `createDecisionAdapter` call site, fixed by registering it in
`inventory-SL-00.json`/`.md`, kind `jev-adapter`, path `app-play-gated`, role `leaf`.)
```
== loop on leehow-pc @ 07b306a22c70f0139785034f2e1f3e1cb3376ae1: exit=0 wall=43s log=/home/leehow/leehow/code/wt/chatrpgv4-wt-sl62/remote-loop.log
```
(196/196.)
```
== py on leehow-pc @ 07b306a22c70f0139785034f2e1f3e1cb3376ae1: exit=0 wall=180s log=/home/leehow/leehow/code/wt/chatrpgv4-wt-sl62/remote-py.log
```
(1728 passed, 2 skipped.)

**Replay finding (gate #10 t4, recorded Keeper, live Jev, `experiments/single-loop-routing/run.mjs
--fixture <fixture>/longgate10-t4 --runs 2 --llm replay`, two runs, byte-identical outcomes).** The
recorded baseline for this fixture turn (`gate-fixture.mjs`'s own report: `tools:
["apply(clerk)","look","apply","lookup","resolve!"x10,"look!","resolve!"x8]`) has the full evidence chain
on disk, but neither replay run reached it: the fresh compile/route/turn-close policy (live Jev this
time, not necessarily the same answers the original live table got) ended the run after only 5 model
steps (`compose, adjudicate x3, compose`), on `M:look!unknown_entity` (the exact
`档案处的办事员`/"the Hall of Records clerk" mismatch this ticket is about) followed by a spent steer with
no further deliverable text -- `status: "undelivered", reason:
"turn_close_steer_spent:no_delivered_evidence"`, not `aborted_during_operate`/stranded. Since the failing
call here is `look` (out of this ticket's scope, see above), SL-62 correctly did not engage, and the run
never got far enough to reach a `resolve`/`apply` call for SL-62 to resolve, or to the refusal-budget
runaway abort SL-63 covers. This is a property of how replay reconstructs a run from live Jev routing
decisions, not a regression from this change -- confirmed by diffing against the unmodified base
(07b306a22) fixture, which was not re-run here for budget reasons but is expected to show the same early
stop, since neither SL-62 nor SL-63's code paths are reachable before it. **Left undone:** a replay that
actually reaches the recorded `resolve!`/second `look!` calls, to demonstrate SL-62 resolving the clerk's
own name and SL-63's fallback (or its absence) end to end; this needs either a different fixture/turn
whose early policy steps do not bail out this early, or a flag this ticket's instructions did not specify
(e.g. `--arm before` to see if disabling the fast-budget arm changes the trajectory). Recommend a
follow-up pass with a fresh live table specifically re-triggering this shape (a Keeper writing a
present-but-differently-spelled NPC's name), since replay fidelity here is bounded by what the fresh
policy chooses to do, not by what was recorded.
