# Validation and suite execution

The two-pass recipe is for a requested or required full suite. Use focused checks for a narrow change. Test totals and measured timings below are dated observations, not a reason to expand the test scope.

Paths and commands below are relative to the repository root unless absolute. Read only this route when the task requires it; it does not expand authorization.

## Running The Suite (two passes, ~8 minutes)

The suite is 8603 tests that each build a workspace on disk and spawn real
subprocesses. Serially it takes about two hours on one core while nine sit
idle. Run it in two passes:

```bash
uv run --frozen python -m pytest tests/ -n 8 --dist loadfile -m "not serial"
uv run --frozen python -m pytest tests/ -m serial
```

`--dist loadfile` keeps a file on one worker: eight module-scoped fixtures
would otherwise be rebuilt in every worker a file was split across, and two
suites read a corpus the whole file shares.

The sixteen `serial` tests install process-wide signal handlers, edit the
thread sigmask, and send SIGTERM to their own pid. Under `-n` that pid is an
xdist worker whose signal handling they overwrite, and one of them fails there
while passing serially. Marking is not tidiness; it is the difference between
a false red and a real one.

**One test used to dominate the wall clock, and the reason is worth keeping.**
`test_toolbox.py::test_evicted_roll_replay_does_not_reearn_consumed_development_check`
journals and finalizes 301 turns to rotate the bounded ledger. It took 43
minutes of a 51-minute parallel run -- 85% of the whole suite -- because
`commit_finalized_turn` opened with an idempotence check that read every commit
on every ref and spawned one `git interpret-trailers` per commit. One lookup
cost the campaign's whole length, and every finalized turn paid it. It is 9
minutes now (`66400af6`); git does the search.

What remains is `_repo_is_healthy` running `git fsck` once per turn, which is
proportional to repository size. So a long run is still worth looking at rather
than accepting: measure with `--durations`, and check whether one test is again
the answer.

## Validation And Evidence

Whole-product, UX, latency, Keeper-quality, integration, and acceptance claims
come primarily from window-equivalent play. Automated tests remain authoritative
for deterministic arithmetic, schemas, transactions/idempotency, path safety,
secret/public projection, plugin metadata, PDF bundle validation, and typed
tool/runtime contracts. They must not infer prose meaning with keyword tests or
claim to measure the whole Keeper.

Before finishing plugin work, run at minimum:

```bash
PYTHONDONTWRITEBYTECODE=1 uv run --frozen python -m pytest tests/test_plugin_metadata.py -q -p no:cacheprovider
```

Changes under `rulesets/coc7/rules-json/` additionally run:

```bash
PYTHONDONTWRITEBYTECODE=1 uv run --frozen python -m pytest tests/test_rulebook_data_audit.py -q -p no:cacheprovider
```

`scripts/verify_*_ocr.py` are extraction-time checks requiring the MinerU cache,
not pytest. `checks/exhaustive_rulebook_validator.py <playtests-root>` sweeps
play logs and exits 2 rather than granting a vacuous pass on zero records.
