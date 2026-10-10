# SQLite task and transcript storage

## Objective and scope

The owner approved the recommended first batch: specification and implementation for
the general TaskStore and home page-transcript records/claims. Success means existing
callers actually read/write SQLite with unchanged authorization, revision, permutation,
model and resource gates. A database file with callers still using JSON is hollow delivery.

Editable: runtime SQLite mechanics, runtime/jev/task-store.ts, transcript-store.ts and
necessary native-fallback wiring, their tests, this plan/spec and kernel-rpc contract.
Non-goals: campaign/Git/worldline state, memory/NPC journals, workspace caches, investigator
libraries, source-reading database optimization, persistent transcript scheduling, App
packaging/restart, dependencies, models, thresholds or resource-limit changes.

## Ownership

Owned task sqlite-task-transcript-20261010, worktree
/Users/haoli/.codex/worktrees/sqlite-task-transcript-20261010, branch
codex/sqlite-task-transcript-20261010; lifecycle-created from latest0.9.7a at4bbcbc2ac.
Primary and other task's retained PDF worktree/evidence are preservation boundaries.
Use existing cached dependencies only. Heavy suites/builds use an idle canonical LAN box;
check build ownership as well as probe because the previous task exposed a build-start race.
Live validation uses tests/play/driver.py, Grok4.7Fast/low and this root as sole natural player.
Do not use Astra, fake/scripted play, production plaintext credential files or restore Python.

## Decisions and ready work

1. Write spec and contract first; keep TaskStore/TranscriptStore interfaces.
2. Task namespace gets tasks.sqlite; the home transcript store gets transcripts.sqlite.
   Owners remain separate from source-reading.sqlite and canonical campaign Git history.
3. Short synchronous SQLite transactions, WAL/FULL durability, no model/filesystem awaits
   under a transaction; TaskStore retains its existing500ms contention allowance via async
   retry, never a25s synchronous busy wait. Transcript claims never wait on another producer.
4. Import old files once, preserve their exact bytes/digests and leave originals untouched.
   Seeds and source/work/image evidence stay files. Owner markers prevent missing/corrupt
   SQL from resurrecting stale JSON. Mixed old/new producers on the same namespace are
   unsupported; the separate running App will not be migrated or restarted in this task.
5. Meaningful tests: legacy import/no fallback, transaction/crash atomicity, multiprocess
   CAS and claim exclusivity, stale-token release, extraction-version coexistence, original
   validation gates, optional transcript failure retaining native reading.
6. Focused then full LAN gate, exact runtime/source check and genuine driver validation;
   retain every result. Scope-only integration after inspecting actual main ownership.
7. Terminal lifecycle audit/closeout; retain any real evidence rather than deleting it.

## Current state

Initial inspection: two existing file-backed stores confirmed; source metadata/jobs already
have a separate SQLite owner. amax initially busy with another task. No code changed yet.
Spec: docs/specs/sqlite-task-transcript-storage.md; contract210.

SQLite transaction/WAL and Node sqlite official documentation validate short exclusive
write transactions and zero native busy wait; Zotero's database plus attachment storage
validates retaining original files. This differs from migrating campaign/worldline authority.
