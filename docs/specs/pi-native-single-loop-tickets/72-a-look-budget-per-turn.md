Status: ready-for-human (landed 2026-09-26 on claude/sl71-20260926, commit d854f9948)
Stage: SL-72 (P2, host; the reading tools' per-turn budget)
Spec: docs/kernel-rpc.md §34.12 (the refusal budget by class), §135.31 (carried views), §135.11 (turn close)

# SL-72 — A per-turn budget for `look`, `lookup` and `recall`: past it the Keeper writes with what it has

## Evidence (long gate #11 t6: eleven `recall` calls in one turn, 71 s; gate #12: 22 looks over the table on a starter whose carried views already hold the scene and its people)
- With thinking off the deepseek Keeper re-reads instead of writing: the carried views (§135.31) already give it the scene, the people and the passages, and every extra look is a model step of 2–5 s. §34.12 counts refusals by class; nothing counts successful looks.

## Ruling (owner, 2026-09-26)
The reading tools have a per-turn budget, a named default (the count is data in rules, not a literal): once a turn's `look`+`lookup`+`recall` calls reach it, further calls of those tools are answered by the host without a kernel read, with a steer that names what the run already carries (the carried views' names) and says to write with it; `narrate`, `apply`, `resolve` and `ask` are never budgeted. A `lookup kind=source` that is `pending` (SL-36) does not count twice. The budget resets with the next player input, like §34.12. Telemetry: `{lane: "looks", reason: "look_budget", count, carried: [...]}` once per turn when it fires.

## Scope
1. Contract: §34.12 addendum (the look budget beside the refusal budget; the default; the steer's structure).
2. `extensions/kernel/index.ts` (where §34.12 counts) and the hybrid engine's steer text; the default in the rules data.
3. Tests, mutation-killable: the (N+1)th look in a turn is answered by the host with the steer and no kernel call; the count resets on player input; a `pending` source lookup counts once; narrate/apply/resolve/ask untouched; the gate #11 t6 replay (recorded Keeper) shows the run stopping its recall loop at the budget and delivering.

## Comments

**Landed 2026-09-26**, branch `claude/sl71-20260926`, commit `d854f9948` (SL-71's own commits,
`3638c719d`/`1545f4481`, are unrelated and land beside it in the same branch).

**Contract:** docs/kernel-rpc.md §34.12.1 (a new numbered paragraph beside §34.12, in the same §34 run).

**The default lives in data**, per the ruling: `content/rulesets/coc7/host-budgets.json`
(`look_budget.per_turn`, shipped at 8), sitting beside the kernel's other rules data
(`content/rulesets/coc7/`) rather than inside `rules-json/` (that directory is scanned whole by the
glossary reader, and a non-caption file there would break it). `extensions/kernel/index.ts`'s
`lookBudget()` reads and caches it once per process, with a literal fallback only if the file cannot be
read at all.

**Files:** `extensions/kernel/index.ts` (`TableState.looksThisTurn`/`pendingSourceCounted`/
`lookBudgetNotified`, all three reset at both places `refusalsThisTurn` already resets; `LOOK_BUDGET_TOOLS`,
`lookBudget()`; the gate itself in `prepareOperation`, placed beside the existing per-tool `exhausted`
block; the increment in `runTool`'s success path, right after `keepRead(true)`), `content/rulesets/coc7/host-budgets.json`
(new), `content/ui/en/extension.json` + `content/ui/zh-Hans/extension.json` (`look_budget_notice`, read
through the same words/surface lane `refusal_budget_fallback_notice` uses -- no hand-written steer
string in the gate itself).

**The "pending source lookup counts once" mechanism is not what the ticket's spec line implied.**
Investigation found `state.sourceWait` (the gate the ticket's own phrasing pointed at) only guards the
*`apply`/`resolve` automatic material-pending recovery* path, not `lookup kind=source`'s own direct
pending answer (`extensions/kernel/source-answers.ts`'s `pendingAnswer`/`pendingPrepare`) -- a repeat of
the identical still-pending `lookup kind=source` query is not blocked by anything else in the host, so
without an explicit dedup it would count every time. Added `TableState.pendingSourceCounted` (a
per-turn `Set` keyed on focus+question), checked in `runTool`'s increment site against the local
`sourceAnswer` variable's `status === "pending"`; a different focus, or the same one once it has landed,
counts as an ordinary look. Contract text corrected to describe this explicitly rather than the
originally-assumed `sourceWait` mechanism.

**Tests, mutation-killed** (`tests/extension/gates.test.mjs`, fake kernel + real host extension,
`openTable` harness): the 9th `look` in a turn is blocked with the steer text and never reaches
`table.look` on the kernel (verified via `kernelRequests()`); `apply`/`resolve` in between the 8th and
9th `look` are never blocked and never carry `reason: "look_budget"`; the budget resets with the next
player input (a 9th `look` in a *second* turn lands normally); three repeats of an identical
still-`pending` `lookup kind=source` count once, proven by then spending exactly seven more ordinary
`look`s without tripping the budget and the eighth tripping it (if the three pending calls had each
counted, the budget would trip mid-way through the seven instead). Four mutations via scratch copy
(never `git checkout --`): the gate's comparison short-circuited to `false` (both blocking tests fail,
reset test unaffected since it never depends on the gate firing); each isolating exactly the tests it
should.

**Full suites on leehow-pc** (branch head `1545f4481`, SL-71's follow-up commit, run together with this
ticket's own): `test:ext` 3195/3195, `test:loop` 196/196, `pytest` 1730 passed/2 skipped -- all the
unmodified baseline plus this ticket's and SL-71's new tests, no regressions.

**Not done:** the ticket's suggestion to replay gate #11 t6's exact recorded 11-`recall` transcript was
superseded by a direct, parameterised test of the same mechanism (a `look` budget of 8, exceeded by a
9th call) rather than a recorded-transcript replay of that one table's exact call sequence.

Status: **ready-for-human**.
- Live (gate #13, 91ed5fee0): max 2 reads in a turn, table looks 14 (#12: 22), `look_budget` never fired — the budget does not trip a normal table; the runaway shape (#11 t6, 12 reads) is what it is for.
