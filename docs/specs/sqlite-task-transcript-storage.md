# SQLite task and page-transcript storage

Status: approved first batch, implementation in progress (2026-10-10).
Baseline: latest0.9.7a at4bbcbc2ac. Contract: kernel-rpc210; amends191.4 storage only.

## Intent and scope

The task record store currently implements file locks, atomic replacement and version
comparison; page transcripts implement exclusive claim files, stale takeover and publish-once
files. SQLite takes these management responsibilities through the existing interfaces.
Authorization, state transitions, source integrity and model work keep their current owners.
An empty SQLite wrapper or a second writable JSON authority is not completion.

Only TaskStore and home TranscriptStore records/claims migrate. Source metadata/jobs keep
source-reading.sqlite. Campaign transactions, Git/worldlines, memories, other caches,
raw PDF/images, immutable graph versions and all real evidence stay with their owners.
TranscriptService's priority, concurrency, timeout/retry and in-memory scheduling stay intact.
No schema/limit/model changes to TaskRecord, TranscriptRecord or native-line validation.

## Storage ownership and interfaces

- createTaskStore(directory) keeps load(id), list(), save(record). Each existing task
  namespace gets directory/tasks.sqlite, outside canonical campaign Git state.
- TranscriptStore(home, contentRoot, extractionVersion) keeps read/readPages/recordedPages,
  put, claim/claimedElsewhere and token-bound release. Its home gets
  .coc/source-transcripts/transcripts.sqlite. dir/workDir/renderCache and the legacy
  recordPath remain path helpers; recordPath is not a writable authority.
- The two owners use shared SQLite mechanics but separate databases: a page-cache write
  cannot hold the task record's writer lock or affect source-reading/campaign authority.
- Connections are owned by one operation and closed in finally. Already initialized reads
  use read-only connections; no persistent connection or shutdown hook leaks into callers.

Writers/readers/actors: TaskRuntime persists checkpoints, resumes them through the same
load/list interface and dispatches only after existing current-context/intent checks.
TranscriptService publishes records and owns claims; sourcePageText/search/reader drivers
read them for navigation only. Claim rows decide which producer may run, never source truth.
Import records and ownership markers decide whether legacy import may run again.

## Task record transaction

tasks stores id(primary key), revision, status and exact validated JSON payload. A short
BEGIN IMMEDIATE reads the prior row, preserves the existing immutable-context/intent/domain
comparisons, requires revision=previous+1, and prevents closed-to-open resurrection.
The row replacement and commit are one transaction. Readers see the old or new complete row.
List enumerates SQL rows, not a directory of JSON files. Parsed row id/revision/status must
match its indexed columns; corrupt records remain invalid_task_record.

The existing500ms file-lock contention allowance is retained as asynchronous retries of
SQLITE_BUSY (native busy_timeout=0). Retry yields the event loop; no new task/provider budget
is created. Other errors are explicit. SQLite transactions never await Jev, models or files.

## Transcript records and claims

Records have a unique(file_sha256,page,extraction_version,transcript_version) key and exact
payload digest. Publish uses INSERT ... ON CONFLICT DO NOTHING and never overwrites a page
of the same version. Different extraction versions coexist. The original permutation,
shape, file/page identity and text hash checks still run before publication and reading.
Shipped seeds remain read-only files and retain first precedence; they are not imported
or copied to home. Batch readers fetch matching SQL pages in one query.

Claims are keyed by the same file/page/version and hold a random owner token, pid and
claimed_at. An atomic conditional insert/takeover succeeds only when no live owner exists;
age<=staleMs is live as before. Release deletes only its exact token. A crashed process
leaves a claim that the existing stale allowance can recover. A competing writer returns
no claim immediately; no new wait/deadline/producer slot is added.

An unavailable home transcript database cannot read stale legacy JSON. It is unavailable
navigation material: source readers keep original native text, source search keeps its
native route, and producer telemetry records failure. It never becomes source evidence or
blocks play while waiting for layout. Shipped seeds can still be read independently.

## Legacy import and failure behavior

First access imports a namespace's matching legacy records and claims in one transaction
and sets user_version1. It stores each original relative name, bytes and SHA256 in an
append-only import table; source files are neither replaced nor deleted. Migration does
file reads before beginning the SQL transaction. A concurrent initializer observes the
committed migration instead of reimporting. Existing live legacy claims remain conservative
holds until their original stale age, and incomplete claim timestamps use filemtime as before.
Malformed optional transcript files are archived as bytes and are unavailable records;
malformed required task records fail import without publishing a partial task database.

A successful owner marker plus schema/version checks prevent a deleted, truncated,
corrupt or incompatible database from falling back to old JSON. Once imported, later
legacy-file edits have no authority. Empty uninitialized read-only homes stay empty; there
is no database creation solely for a cache miss. Mixed old/new producer versions on one
namespace are unsupported: rollout occurs after its old producer stops. The separate
running App and prior real evidence are not modified by this implementation task.

## Validation and integration

- Existing authentic TaskRuntime/store and transcript producer/reader tests retain their
  semantic assertions; filesystem-publication assertions switch to logical SQL state.
- New regressions cover exact-byte imports, missing/corrupt SQL without JSON fallback,
  cross-process task CAS, failed transaction rollback, claim race/stale token release,
  version coexistence and unavailable-cache native fallback. No scripted play is acceptance.
- Canonical idle-LAN focused/all checks and exact-runtime verification precede scoped
  integration. Real acceptance uses tests/play/driver.py, Grok4.7Fast/low and root's single
  natural utterances; validate actual task/transcript SQL use and repeat reads without
  duplicate layout generation. Preserve raw logs, campaigns and original evidence.
- No App packaging/restart, dependency downloads or authority/gate/resource changes.

## Existing practice

[SQLite transactions](https://www.sqlite.org/lang_transaction.html) confirm BEGIN IMMEDIATE
may return SQLITE_BUSY and transactions have one writer; [WAL](https://www.sqlite.org/wal.html)
permits readers alongside that writer but does not eliminate contention.
[Node sqlite](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html) exposes
synchronous database calls and lock timeout: native waits must not monopolize this host.
[Zotero storage](https://www.zotero.org/support/zotero_data) separates SQLite metadata from
original attachments, supporting retained files here. Unlike Zotero library state, this
batch does not replace the campaign's Git/worldline authority or move PDF work into the kernel.
