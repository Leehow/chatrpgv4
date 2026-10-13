# Direct TypeScript development tests

## Objective and acceptance

Continue the resource pilot with production-TypeScript character creation,
mechanics projection, rule bands, resource damage and sanity-day cases.
Make `npm test` the bounded fast development command. Preserve explicit
integration and complete regression commands. This changes tests and runners,
not production rules, transactions, persistence or the frozen Python oracle.

Every migrated original function and assertion must be inventoried. Original
Python files remain available unchanged for comparison. Parameter sets, seeds,
negative cases and state assertions remain represented; transport, persistence,
restart and atomicity responsibilities stay in the integration layer. A fast
pass alone is not complete regression or live-play acceptance.

Measure both the original and replacement coverage of the migration inventory
on the same Mac with fixed concurrency, retaining logs and exits. Report the
default fast command separately; do not compare fewer assertions with the full
suite and label the difference a speedup. Record any full-gate timing separately.

## Ownership and execution

Base: `0.9.7a` at `c9df4d27b`, with unrelated existing edits preserved. The user
authorized local timing because the LAN machines remained occupied, then
authorized using amax and stopping conflicting tasks if necessary. No package,
deployment, model call, dependency installation or historical kernel edit is
part of this work. Keep the completed resource pilot evidence unchanged.

- [x] Inspect current tests, runners and storage policy; cross-check the design.
- [x] Implement direct counterparts and inventory retained integration coverage.
- [x] Add fast/integration/all entrypoints and migration guards.
- [x] Verify assertion mapping, parameter sets and representative mutations.
- [x] Measure the original and replacement inventory locally; verify full gate.
- [x] Record outcomes, limitations and exact commands.

## Design evidence

[The Practical Test Pyramid](https://martinfowler.com/articles/practical-test-pyramid.html)
supports testing business rules below process boundaries while retaining tests
of real boundary integrations. It also warns that doubles need contract checks;
our original RPC tests remain the independent integration reference.
[Node's test runner](https://nodejs.org/download/release/latest-jod/docs/api/test.html)
provides isolated files, subtests, concurrency controls and coverage support.
We keep per-file isolation and production implementations; disabling isolation
or merely renaming Python-driven RPC tests would not remove their storage work.

## Current state

Implemented: 111 direct business cases (63 character-creation arithmetic,
12 creation-difficulty arithmetic, 10 mechanics-identity parameters, six rule
bands, six SAN-day cases, two damage cases and the original 12 resource cases).
The default fast command adds the 16 existing smoke tests and two migration
guards: 129 passing tests before benchmarking. Strict kernel typechecking also
passes. No production implementation changed.

`tests/direct-ts-migration.json` records original functions, assertion text,
exception checks and parameter declarations, plus hashes of the unchanged
source files. The fast guard refuses a stale mapping after an original file
changes. Helpers retain their original business assertions (including each
SAN loss) and split compound conditions into explicit checks. The current TS
creation API no longer takes the unused legacy `derive` luck argument; its
age penalty and characteristic inputs are unchanged. Difficulty-card tests
use the production JSON serializer to compare public numeric values, including
internal `PythonFloat` values, with the original RPC assertions.

Every original test still runs in `test:integration`; there is no deselection.
`test:all` builds, runs the complete extension suite, the separate routing-loop
suite, then integration. `npm test` is the bounded fast feedback loop, not a
replacement for the integration gate. Unknown and unmigrated business areas
still need their original focused/integration tests. Existing focused test
selection remains conservative and unchanged.

The repository's development instructions now start with `npm test`; changes
outside the migrated areas or at RPC/storage/transaction boundaries still need
the existing focused integration selection. Full regression remains mandatory
before integration.

## Local comparison (2026-10-12 local / 2026-10-13 UTC)

Evidence root: `.coc/playtests/direct-ts-migration-20261013/`.
Final measurements: `comparison-final/comparison.json`, with per-run logs,
original pytest JUnit reports and source/built-kernel hashes. Reproduce with:

```sh
node scripts/build-runtime.mjs
node scripts/benchmark-test-tiers.mjs <new-report-directory>
```

Apple M1 Max, Node 24.19.0, the same checkout and built RPC kernel. Original and
direct business runs each use one worker; the default fast command uses its
normal two workers. Original runs use the existing pooled kernel and disk
storage. Timings include process startup, collection, setup, cleanup and the
direct tests' TS bundling. The separate shared runtime build took 1.744 seconds
and is excluded from both columns. These are warm-filesystem development runs,
not a claim about cold-machine startup. The benchmark checks for other test
processes before and after each run and records system load; it cannot exclude
all unrelated OS activity.

| Scope | First invocation | Three repeats | Median |
| --- | ---: | --- | ---: |
| Original 111 cases | 31.435 s | 29.713 / 32.513 / 33.519 s | 32.513 s |
| Direct TS 111 cases | 1.397 s | 1.349 / 1.734 / 1.488 s | 1.488 s |
| Fast Node runner, 129 cases including smoke/guards | — | 2.431 / 2.385 / 2.271 s | 2.385 s |
| Actual `npm test`, including npm startup | — | 3.478 / 2.601 / 2.885 s | 2.885 s |

All measured runs passed their expected case counts. The complete migrated
inventory is **21.85 times faster**, a **95.42% reduction** in wall time. This
extends the earlier twelve-case pilot by 99 cases. It is not a speedup claim for
the unchanged full integration suite. Original chargen/mechanics cases include
frozen-oracle tests; their new counterparts exercise the current production TS.

## Assertion and regression evidence

The inventory covers 75 original functions, expanded to 111 cases, with 287
explicit assertion statements and ten exception checks, plus retained helper
assertions. All explicit parameter sets and seeds are preserved. The originally
unseeded SAN-day and damage cases use a fixed seed in the direct fixture; SAN
loss is identical on success and failure, as in the original X/X checks, and
their assertions do not depend on which roll outcome occurs. All eight original
Python files in this inventory remain unchanged, and the integration command
applies no migration exclusions.
This is an assertion/behavior inventory, not a measured line-coverage percentage.

Seven compiled-only mutations were all rejected by their designated business
assertions: eight-hour healing days, rounded MP recovery, stale sheet conditions,
wrong derived HP, leaked identity, reversed rule ranges and unreset daily SAN.
No production source was mutated. The initial range mutation exposed that the
original malformed row also omitted `covers`; its rejection could come from
that separate guard. The direct test retains that input and adds an invalid
range with every other authored field present. The earlier failed mutation run
is retained in `comparison/`; `comparison-final/` verifies the strengthened case
and all seven mutations. Kernel strict typechecking passed.

`npm-fast.json` and `npm-fast-*.log` record three passing invocations of the
actual default command, including npm startup. All 129 tests passed each time.

The local full gate was deliberately interrupted with SIGINT after 1,565.235
seconds when the user authorized amax. Its logs and original exit code are
retained in `full-gate.*`, with the interruption recorded explicitly; queued
test cancellations are not regression verdicts. No local pytest had started.

amax was reachable and idle for tests (load 2.83 on 40 threads), so no existing
task needed stopping. The complete `all` run used the canonical remote runner
with the exact local HEAD and working-tree overlay, under run `run.4RDnFkz5`.
The same-Mac comparison above is separate from this remote regression timing.

## Complete regression result and follow-up

Command: `RT_HOST=amax remote-test.sh run <worktree> all`. It built once and ran
all 649 extension files, all `tests/kernel tests/play`, and the independent
routing loop. The full run took **615 seconds**:

- Python integration: **2,142 passed, 2 skipped**, 456.21 seconds in pytest
  (464.29 seconds including the storage runner).
- Independent routing loop: **12 passed**.
- Extensions: **5,800 passed, 1 skipped, 1 failed** in the initial full run.
  The single failure was `python-retirement.test.mjs` treating the existing
  development controller `scripts/run-pytest.py` as a production implementation.

The retirement check now permits only that exact development-controller path
and asserts that no production resource file/directory includes it. Every other
Python file in production source trees is still rejected. Its three tests pass
on both Mac and amax after the fix. An injected unlisted Python file was rejected
and removed in `finally`, verifying that the production guard remains active.
The complete suite was not redundantly rerun after this isolated test-guard fix;
the original failure and the targeted passing result are both retained. No
production source, original Python assertion or skip was changed to repair it.

Local evidence: `amax/remote-all.log`, `amax/py.log`, `amax/pytest/junit.xml`,
`amax/pf/`, `amax/python-retirement-fixed.log`, `amax/retirement-guard-fix.diff`,
and `retirement-guard-mutation.log`. All initial process exits remain recorded;
the original full-run exit is 1 and the targeted fix exits 0. The default remains
the 129-case TS command; pytest is available explicitly through
`test:integration` and the full regression command.
