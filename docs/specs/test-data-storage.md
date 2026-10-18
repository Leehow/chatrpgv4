# Bounded test data and evidence (owner 2026-10-16)

Tests reuse one retained seed per starting position. A new model, reasoning level,
or retry creates a private copy-on-write view of that seed, not another full
payload or a tar export. `scripts/test-workspace.mjs` owns this operation;
`tests/play/driver.ts start --seed-home PATH` invokes it before starting a child.
Campaign-scoped `memory-decisions/<campaign>` and `memory-drafts/<campaign>` are
included so restart tests retain accepted decision work without another campaign's cache.
Tests that start from an empty workspace need no seed. Existing running tests
and product workspaces are outside this migration.

## All file types and entry points (owner 2026-10-16)

This contract covers every test payload: JSON/JSONL, images, PDFs, prose, raw
logs, archives, databases, copied dependencies and reader work. Extension and
size are not exemptions. `shareTestTree` in `scripts/test-workspace.mjs` provides
the same forced CoW references for arbitrary files and trees; use it for module
libraries and experiment fixtures as well as complete campaign seeds. Writable
views remain ordinary private files while APFS references shared data blocks.
Independent writes allocate only the changed blocks. Existing hard-link groups
already reference shared data and retain their relationship.

Retain one reusable fixture workspace per starting position. New fixture writers
publish a `workspace` reference instead of another `workspace.tar.gz`; legacy
tar fixtures are extracted into a hash-keyed seed cache once, then materialized
through CoW. Preserve legacy archives and recorded turn results. Changing a
starting position creates only its CoW delta. Cached seeds are never modified
by a consumer. Generic copies have the same default seed/file/free-space bounds
and verify the source and destination hashes before returning.

Historical cleanup covers all inactive test data roots, rather than a hand-picked
list of eight runs. Protect the entire root of each open or running test and the
canonical product/campaign stores. Deduplicate every nonempty byte-identical
regular-file payload without a minimum-size cutoff. Keep unique content and
all result paths. Zero-byte files have no data blocks to reclaim. Source code,
dependencies in use, and formal campaign stores are protected; report remaining
duplicate bytes there separately instead of silently expanding cleanup scope.
Nested source snapshots in `.pi/worktrees` and every `.cache/python-oracle`
directory are protected too; frozen migration evidence is never unlocked.

## Creation and isolation

- Select one campaign, its history repository, its module and campaign-private
  module scope, installed Mod packages, and supporting NPC/presentation caches.
  Keep the full selected module provenance. Exclude other campaigns, previous
  playtests, Mod audit jobs, root-wide reader database caches/WALs, and agent homes.
  Tests of an omitted subsystem must explicitly extend the dependency selection
  in the helper and its isolation tests before using it.
- Capture seeds while quiescent. The helper rejects open selected inputs and
  untrusted symlinks rather than importing a writable reference to a different workspace.
  It records file hashes and checks source identity and timestamps while copying.
  A source change makes creation fail with retained diagnostic evidence. Trusted
  read-only object references are verified against their SHA-256 and materialized
  as private regular files with their original mode; arbitrary links are rejected.
- Use macOS `clonefile` (the helper builds a small C executable using the system
  compiler), or Linux `COPYFILE_FICLONE_FORCE`: independent inodes sharing data blocks until a
  write. Hard links and writable symlinks are unsuitable for state isolation.
  Unsupported filesystems fail explicitly; do not silently perform a full copy.
  Linux tests can use a reflink-capable filesystem or existing small synthetic
  fixtures through the ordinary scratch runner.
- A destination is new and invocation-owned. Creation never replaces an existing
  destination, source, product home, or another invocation's evidence.

## Bounds

The helper records its seed path, campaign, per-file SHA-256 and baseline byte
counts in `test-workspace.json`. Default admission bounds are 4 GiB of selected
seed data, 512 MiB of subsequent new/changed file content, and 10 GiB free space.
Changed-file accounting is conservative: a changed file counts its full current
size, not an assumed APFS allocation. Limits can be reduced by the caller. A
larger experiment needs an explicit reviewed limit in its test plan, rather
than a silent retry or environment override.

The managed live driver counts both workspace growth and its run's raw logs,
events and results. It checks these bounds before process creation and before
each player turn. On a limit it refuses the next input and retains all partial
results. It does not truncate raw telemetry or terminate an already executing
turn. A single in-flight turn can exceed the bound; inspect and stop it normally
before authorizing another input. This is an admission limit, not a filesystem
quota. Record before/after free space separately from logical directory sizes.

## Results and cleanup

Preserve outcomes, failures, delivered prose, raw event streams, telemetry,
source/model attribution, unique final state, and reproducible dependencies.
Successful disposable unit fixtures continue through the existing owned-scratch
cleanup. Live evidence stays at its original paths. The existence of a report
does not authorize deleting its underlying evidence.

Historical deduplication is a separate, explicitly scoped operation: inventory
and hash first; exclude open/running roots, App-registered workspaces and formal
campaign homes. Closed test evidence uses `.coc/test-data/objects/<prefix>/<sha>-<mode>.<ext>`
as its local read-only content store. Duplicate immutable JSON, images, PDFs,
logs and archives become file references after object verification. Private state,
code and databases keep CoW isolation. The
original paths and byte contents remain readable without the external audit disk.
Original modes are carried in object names and restored in writable views.
Archive roots carry `.test-data-archive.json`; the live driver refuses to run
directly there. Create a private view from the archive through the common helper.
Cleanup walkers must use `lstat` and unlink references without chmod or recursion
through them. New fixture publishers use read-only object references too; consumers
materialize private regular files before running a kernel or a model.
Keep a durable journal, preserve original modes and reference modification times, and verify the complete retained
file inventory afterward. Never infer recoverable physical bytes from summed
file sizes. New unique output necessarily occupies new space; archive it only
with explicit authorization and a verified restoration path.

The object store is retained evidence, not disposable cache. Never delete objects
by age or because one test finished. A transfer must materialize private files or
carry the complete referenced objects and rebase the links; copying link entries
alone is not a portable backup. No object garbage collection is authorized by
this cleanup.

## Precedent

Apple's `clonefile(2)` manual specifies independent attributes and private writes
after block sharing. Node's [`fs.copyFile` documentation](https://nodejs.org/api/fs.html#fscopyfilesrc-dest-mode-callback)
distinguishes forced reflinks from the flag that silently falls back to copying.
[libuv's implementation](https://github.com/libuv/libuv/blob/v1.x/src/unix/fs.c)
and a local Node 24 probe showed `ENOSYS` for forced reflinks on this Mac; use
the native syscall here. The macOS `cp(1)` manual explicitly allows `cp -c` to
fall back to a full copy, so it cannot enforce this contract. Ordinary links
cannot provide CoW isolation.
The repository already used `cp -cR` in some experiments; the missing pieces were
a common dependency scope, capacity admission and a discoverable contract.

[Nix's store model](https://github.com/NixOS/nix/blob/master/doc/manual/source/store/index.md)
also separates immutable shared objects from their consumers. This project uses
local SHA-256 object references for closed evidence and CoW files for writable
state; it does not make live campaign state a shared writable object.
