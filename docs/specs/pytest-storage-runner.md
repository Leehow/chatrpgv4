# Pytest storage runner

The runner changes temporary storage, not test selection, assertions, kernel behavior,
random seeds, fsync, or Git operations. Every invocation owns a fresh disk run directory.

`scripts/run-pytest.py` launches the existing pytest command with the optional
`tests/coc_pytest_storage.py` plugin. Ordinary `tmp_path` and session factory data
use a fresh directory on `/dev/shm`. The explicit file/node inventory in
`tests/pytest-storage-policy.json` keeps storage, crash recovery, transaction,
restart, and publication checks on disk. Parameter instances inherit their named
test's policy. This inventory is reviewed source data, never keyword inference.
Disk-only mode provides a same-runner comparison. Insufficient shared memory falls
back to disk and is reported in the run manifest.

Each xdist worker records collected test IDs, storage assignments, actual temporary
paths, and test outcomes. The runner records command, elapsed time, exit code, and
storage mode. Reports and logs always stay on disk.

On success, only this invocation's owned temporary directories are removed. On
failure or interruption, RAM fixtures are copied to disk before RAM is released;
disk fixtures remain. If copying fails, RAM is retained and its path reported.
Each run is distinct, so a later run cannot delete an earlier run's failed fixtures.
Remote source-tree `.coc` and `.pi` artifacts are retained with a failed run.

The remote helper preserves previous artifacts by rename before reusing its source
checkout; it does not delete old failure evidence on the startup path. Per-run
pytest, extension, and routing logs have separate disk destinations. The matching
Codex and Claude helpers retain their existing separate ownership namespaces.

Verification requires unchanged existing test bodies/decorators, a real fixture
routing/failure-retention test, unchanged collected IDs, a complete pytest run,
and comparison with the prior same-host, same-worker run. A tmpfs measurement does
not establish physical-disk power-loss durability; the explicit disk checks stay
on disk.
