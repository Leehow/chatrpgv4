Status: ready-for-human (filed 2026-09-24 from long gate #4; batch 5; implemented 2026-09-24)
Stage: SL-43 (P2, compile routing)
Spec: docs/kernel-rpc.md §135.30.x (compile rows), §134.17 (obligation fold), §135.28 (ordinary binder)

# SL-43 — One declaration, one check: the obligation step and the ordinary binder do not both bind a check for the same act

## Evidence (long gate #4 t2, `longgate4-triage.txt`)
- "我说明来意，请他帮忙调出科比特宅这些年的旧剪报。": the compile selected `resolve:globe-clippings-access` (the obligation check, Persuade, rolled 8) and then `resolve:ordinary-check` (Persuade again, rolled 100) for the same sentence; two clerk writes at 0 ms, two rolls, and 44 s of model steps narrating both; wall 65 s with a 13 s cap wait on the Keeper's own resolve.

## Ruling (owner, 2026-09-24)
A declaration's act is settled once. When the obligation candidate covers the act feature (the approach is the attempt, SL-14), the ordinary binder binds no second check in that compile; an ordinary check is bound only for an act the obligation step did not cover.

## Scope
1. Contract: §135.30 addendum (new subsection): the obligation step consumes the act feature it settles; the ordinary binder runs on the remainder.
2. `runtime/jev/compile-rows.ts` / obligation candidates / the ordinary binder: the second selection is not made when the first covers the same act.
3. Tests, mutation-killable: the t2 sentence on the Haunting fixture selects one resolve; a sentence with an obligation approach plus a distinct act (e.g. speak then search) still selects both.

## Comments

### 2026-09-24 — implemented on `claude/sl43-20260924` (from the integration branch at `c31f483dd`)

**Commits.** `95559a8c5` (contract §135.30.8, `route-compile.ts`, `step-policy.ts`, the engine's compile row, the new test
file); SL-44's `d937803d7` and `bf83e822c` ride the same branch.

**What the code does** (contract §135.30.8). The run keeps `RunView.actsSettled`: the cleared `act` an `obligation_check`
fires on (settled for the same compile's other candidates too: `settledActs` in `interpretCompile`), and the intent the clerk
executes an obligation check with (`obligationAct` in `settleExecute`; taken or refused). `ordinary_check` gains a fourth
condition: a cleared act that is settled *decides* the check (consumed, the Keeper's for the run) instead of firing; any other
act fires as §135.30.3 says. `settleOrdinaryBind` executes nothing for a check whose intent (the compile's, else the binder's) is
settled: `ordinary_act_settled`, consumed. The engine re-reads the compile with the run's settled acts on the question, so the
compile row's `decided` is the policy's; the row gains `acts_settled`. Nothing reads words; the acts are the kernel's resolve
intents.

**Why both a compile-time and an execution-time settle.** Gate #4 t2 cleared `social` at 0.96 at the first compile, so the
compile-time settle alone would have consumed the ordinary check there. A first compile whose act is under the gate settles
nothing, and the check's act is only known from its bind; the execution-time settle covers that (the second policy test and the
second emitted-kernel test). The binder guard covers the route's `need` selecting the check (the predicate is not `sole`).

**Tests** (`tests/extension/single-loop-one-check.test.mjs`, 6): the same-compile decide (and the control: the same act with no
obligation step still selects the check); gate #4 t2 across two compiles with the first act unclear, the executed intent
settling `social`, the second compile deciding the check, and a later `investigate` still selecting it with intent
`investigate` (speak, then search); a refused check still settles its act; the binder's remainder; on the emitted kernel through
the hybrid engine with gate #4's answers for both compiles, one clerk roll, the obligation's (both with the first act cleared and
unclear).

**Mutations** (copy-revert, `mutate.py`/`mutate2.py` in the session scratchpad; every one killed):

| mutation | killed by |
| --- | --- |
| M1 `ordinary_check` ignores settled acts (fires and decides as before) | the two emitted-kernel t2 tests (two rolls), the same-compile and cross-compile policy tests |
| M2 no same-compile settle (`settledActs` returns none) | the same-compile policy test, the emitted-kernel t2 test (`decided`/`acts_settled` at the first compile) |
| M3 execution settles nothing | the cross-compile and refused-check policy tests |
| M4 binder guard removed | the binder remainder test |
| M5 only a taken check settles its act | the refused-check test |
| M6 any settled act blocks every act | the cross-compile test (`investigate` no longer selected) |
| M7 the engine's row ignores the run's settled acts | the emitted-kernel test with the first act unclear (second row's `decided`) |

**Replay of gate #4 t2** (fixture `longgate4-t2` from `longgate4-haunting-1308`, recorded Keeper at its recorded latency, live
Jev, `--latency live`, 3 runs per arm; outcomes pre-registered before the after arm). `--seed 1` makes the replayed obligation roll
fail (the obligation stays open, no archivist, no second compile): 3/3 before-runs had one roll, the defect not reproduced; kept
as the control. `--seed 4` passes the roll as live (Persuade 8) and reproduces it.

| arm | seed | clerk rolls | selections | wall (s) |
| --- | --- | --- | --- | --- |
| before `c31f483dd` | 4 | 2, 2, 2 (obligation + ordinary) | compile 1: obligation (ask 0.86–0.89, act social 0.96–0.97); compile 2: ordinary (act social 0.98, ask `none` 0.14–0.17 under the gate) | 53.5, 52.4, 52.4 |
| after `bf83e822c` | 4 | 1, 1, 1 (obligation) | compile 1: obligation, ordinary check **decided**, `acts_settled: [social]`; compile 2: nothing | 24.8, 23.5, 23.6 |
| before `c31f483dd` | 1 | 1, 1, 1 (roll failed) | compile 1: obligation | 54.2, 49.3, 51.2 |
| after | 1 | 1, 1, 1 (roll failed) | compile 1: obligation | 52.4, 51.2, 49.2 |

Where the seed-4 wall went: the binder (0.52–0.58 s) and the second clerk roll are gone, and the route after the checks answered
differently. Before, with a pass and a fumble (100) among the turn's steps, its exit read `ask_llm` at 0.55–0.60 and the Keeper
adjudicated twice (27.3 s + 17.6 s of recorded latency); after, with one pass, `ask_llm` at 0.25–0.29 did not clear, the SL-20
settled lean composed once (17.6 s). So most of the 28–29 s is the route's exit reading a turn without the second roll, not the
check itself. Caveat: in the compose the replay plays the recorded Keeper's prose, not its first message's `apply` of Arty and
Ruth (the baseline's two `person` matches are false in the after arm); a live Keeper composing may still stage them. Results:
`experiments/single-loop-routing/results/sl43-longgate4-t2-{before-seed4,after,before-seed1,after-seed1}`.

**Not done / noted.** The symmetric order (an ordinary check the compile selected first, then an obligation check on the same act
in a later compile) is not covered: the ruling names the obligation step settling the act, and no gate showed the other order;
it is one more `actsSettled` writer if the owner wants it.

**Suites** (leehow-pc, at `bf83e822c`): `ext` — "ℹ tests 3044 / ℹ pass 3044 / ℹ fail 0" (`== ext on leehow-pc @ bf83e822c...: exit=0 wall=145s`; the first run at `d937803d7` had 2 failures, the source-request case and a load-sensitive deadline check, both fixed in `bf83e822c`); `loop` — "# tests 175 / # pass 175 / # fail 0" (exit=0 wall=41s); `py` — "1725 passed, 2 skipped in 181.74s" (exit=0 wall=183s).
