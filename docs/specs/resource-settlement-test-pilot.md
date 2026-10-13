# Resource settlement test pilot

## Contract and scope

The pilot ports the seven cases in `tests/kernel/test_apply_time_healing.py`
and the five cases in `tests/kernel/test_apply_time_mp.py` to direct calls to
the current TypeScript resource contribution. The original RPC tests remain
unchanged and remain in the full suite: they own transport, apply-result
projection, real file persistence, and the connection from time effects to
resource recovery. This pilot does not change test selection or claim to have
accelerated the full suite.

The direct cases use the production `applyResources`, `SettleContext`,
`CheckArithmetic`, `PythonRandom`, clock arithmetic, healing and MP engines.
Only sheet/save storage is an isolated in-memory adapter. Receipt creation,
conditions, healing rules and random draws must not be reimplemented in tests.
Rule tables and the pregen are loaded from current content. Every case owns
its mutable state; the seed-4 comparisons retain seed 4. No retired Python
implementation is modified or used as the subject of the new tests.

The direct result has `recovered: []` where the public apply result omits
`recovered`; the original RPC assertions continue to check that omission.
Reading an in-memory sheet proves synchronization, not disk persistence.
The original tests continue to prove the latter. The known per-call
60-minute MP gate is preserved, including two separate 30-minute advances.

## Acceptance

- Map every original assertion to a direct assertion or its retained RPC
  responsibility; keep hashes of the original test files.
- Run all twelve original cases and all twelve direct cases on the same
  machine with one worker, the same current production source and content,
  and no concurrent repository suite. Include runner startup and direct TS
  compilation in the primary elapsed-time comparison; report build separately.
- Alternate the two suites for repeated measurements. Preserve raw logs,
  commands, versions, machine/load information and all exits. No speed claim
  may be based only on summed test-body durations.
- Check representative mutations of day conversion, MP rounding and condition
  synchronization against the direct suite. A mutation must fail a relevant
  assertion, not merely compilation or initialization.
- Preserve the existing full-suite gate and all real-play evidence. This is
  deterministic kernel verification, not a Keeper playtest.

## Implementation and measurement

`tests/extension/resource-settlement.test.mjs` carries the same twelve test
names as the two Python files. The 36 original `assert` statements map to 47
direct assertions; compound Python conditions are split into individual
checks. Counts identify the inventory, not proof of equivalence. The mapping
was reviewed against the expressions and the responsibilities below.

| Original case (abbreviated) | Original assertions | Direct responsibility |
| --- | ---: | --- |
| One day restores one HP | 4 | Initial HP/conditions, final HP, exact recovered row, HP receipt ID |
| Day boundary at 24 hours | 2 | HP after 2879 minutes, then another 2880 minutes |
| One week restores seven HP | 3 | Two non-major blows, final HP, exact recovered row |
| Thirty-day rest | 2 | HP ceiling, exact recovered row |
| Major wound after 3360 minutes | 5 | Initial/final HP and conditions, no recovery or HP delta |
| Three weekly rolls | 4 | Independent seed-4 states, initial wounds, one-week gain, greater three-week gain, exact recovered row |
| Recovery clears conditions | 5 | Initial major wound, full healing, empty conditions, next small wound stays non-major |
| Five-minute MP advance | 2 | No recovery, MP stays 3 |
| Sixty-minute MP advance | 2 | Nonempty recovered rows, exact 0-to-1 change, sheet MP |
| Ninety-minute MP advance | 2 | Nonempty recovered rows, exact 0-to-1 change, sheet MP |
| Separate thirty-minute advances | 3 | Neither recovers MP, sheet MP stays 0 |
| Long MP rest | 2 | Nonempty recovered rows, exact 9-to-11 change, sheet MP |

The original RPC assertions for public `look`, disk reads, absent `recovered`
fields and projected receipt-ID lists remain unchanged in the full suite.
Their business counterparts use the stored in-memory sheet, empty recovery
arrays and real resource-receipt objects. This is an additional fast test
surface, not removal of the integration responsibilities. Production source
outside the test-export module is unchanged.

Run the direct surface with:

```sh
node --test --test-concurrency=1 tests/extension/resource-settlement.test.mjs
```

On the same machine, after the normal runtime build, run the paired
measurement and mutation checks with a new report directory:

```sh
node scripts/benchmark-resource-settlement.mjs /absolute/new/report-directory
```

The report records a cold pair and three alternating measured pairs, then
checks compiled-only mutations of the day length, MP rounding and recovered
condition synchronization. The mutated bundles and failure logs are evidence;
no production source or oracle is rewritten.

The user authorized running this pilot on the local Mac on 2026-10-12 because
the LAN boxes remained occupied. Both variants run serially on that Mac with
one worker. The RPC runner uses disk storage on macOS; Linux uses its hybrid
storage policy. Results describe the measured platform, not a cross-platform
speedup. The runtime build is measured separately.

## Measured result (2026-10-12 local time)

Host: Apple M1 Max, macOS, Node v24.19.0, Python 3.14.6. Both variants
used one worker and the same checkout at `c9df4d27bd6d15429bebdae86578183c3e567b38`
plus its recorded working-tree diff. The RPC side used the existing kernel
pool and disk storage runner. All eight invocations passed all twelve cases.

| Invocation | Original pytest/RPC | Direct TS |
| --- | ---: | ---: |
| First pair | 15.671 s | 0.415 s |
| Measured pair 1 | 15.078 s | 0.356 s |
| Measured pair 2 (direct first) | 15.526 s | 0.321 s |
| Measured pair 3 | 14.958 s | 0.344 s |
| Median of measured pairs | **15.078 s** | **0.344 s** |

The elapsed-time ratio was **43.8x (97.7% reduction)**.
This includes Node startup, test setup, direct TS bundling, assertions and
cleanup. The shared runtime build took 1.337 s and is reported separately.
The report's `cold` label denotes the first pair only: OS caches were not
flushed. The machine was not otherwise idle (one-minute load ranged from
7.57 to 17.97); no competing Node/pytest suite was found at the pre/post
checks of the accepted invocations. These are same-machine pilot numbers,
not a prediction for the LAN box or the full regression suite.

The first comparison was rejected when another local suite appeared; the
second was rejected before running while that suite remained active. Both
records are retained and excluded. The accepted report is
`.coc/playtests/resource-settlement-pilot-20261012-kMnPr8/mac-comparison-3/comparison.json`.
Its directory contains raw logs, JUnit output, per-run storage metadata,
source/test hashes and the three compiled-only mutation failures. The sibling
`assertion-map.json` in the parent report directory inventories the 36 original and 47 direct assertions;
`intake.json` and `unchanged-inputs.json` verify that the original tests and
resource implementation were untouched.

All three mutations were detected by their designated assertions: an
eight-hour day, MP rounding instead of whole hours, and omitting healed
conditions from the sheet. This establishes sensitivity to those regressions;
it is not a line/branch coverage percentage. Coverage of RPC projection,
campaign creation, transaction integration and real persistence remains with
the unchanged original tests. The fast command above is ready for resource
business-rule iteration; the full-suite policy and selector are unchanged.

The existing selector chose the new resource file and the mandatory
`control-flow-inventory` and `ts-kernel-foundation` smoke files for this
six-file change. Their serial run passed **28/28 tests** in 2.372 s;
`focused.json`, `focused.log` and `selection.json` preserve the command and
result alongside the comparison. No full-suite or live-play acceptance is
claimed for this test-only pilot.
