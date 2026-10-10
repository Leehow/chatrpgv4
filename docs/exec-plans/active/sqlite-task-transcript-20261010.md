# SQLite task and transcript storage

## Objective and scope

The owner approved the recommended first batch: specification and implementation for
the general TaskStore and home page-transcript records/claims. Success means existing
callers actually read/write SQLite with unchanged authorization, revision, permutation,
model and resource gates. A database file with callers still using JSON is hollow delivery.

Editable: runtime SQLite mechanics, runtime/jev/task-store.ts, transcript-store.ts and
necessary native-fallback/kernel-text-reader/seed-export wiring, their tests, this plan/spec and kernel-rpc contract.
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

## Implementation milestone

Spec/contract committed5d3f8dea7 before code. Both stores now use SQLite with operation-owned
connections, short transactions, exact-byte legacy imports and ownership markers. Task
CAS/immutable/closed gates and transcript permutation/version/hash gates are unchanged.
Token claims replace claim files; seed-first reads and native fallback survive unavailable
home SQL. put retries only under the original layout child's deadline; no new resource grant.
Task500ms contention yields the event loop, native busy_timeout0. New SQL files are mode600.
Consumer inspection found two direct legacy readers: kernel page text and seed export.
Both now consume SQL/TranscriptStore; kernel adapter reads data only, never PDF/layout code.
Necessary evidence preservation: allocate a fresh work attempt instead of deleting an older
directory, and retain the input page image with its trace. Legacy evidence is never deleted.

Initial4reds were file-publication assertions; migrated logical-state assertions preserve
the old semantics. Related37 then41local cases passed and kernel types passed. Two later
test failures: direct native-TS kernel import required the usual esbuild bundle, and old
input-image deletion assertion now asserts retention. All reds retained under
.coc/playtests/sqlite-task-transcript-20261010-evidence; final local run in progress.
amax wasbusy earlier, latestprobeidle5.17; recheck ownership before heavy dispatch. Next
focused/full LAN + exact runtime + genuine driver with isolated home, then scoped integration
and lifecycle evidence retention. Existing App, other task PDF evidence and primary stay untouched.

First canonical focused2b completed RED563s:3150extpass/11fail,2128py/2skip,loop12pass.
Raw/per-file outputs archived focused-2b7e0c5dd before refresh. Eight passage-related failures
exposed the remaining filesystem-only transcriptListing (and its removed stat import).
Listing now uses immutable seed stamps plus scoped SQL record digests; no WAL/claim/other-PDF
churn. Three old tests inspected task JSON/input-image deletion; migrated to real TaskStore
and retained-image/logical-state assertions. Book test now verifies legacy edits ignored
and actual SQL corruption still falls back natively. A listing-first import cannot assign
legacy claims an unknown/current extraction version: wildcard legacy holds protect every
version until the original expiry. New regression preserves raw claim bytes.
Local affected21 had20pass/1 oldfilesystem assertion; repaired that final assertion. Latest
listing/claims subset11pass; previous related44 and kernel types green. Need final all/runtime.

Real setup launch attempt with API-key environment references could not register authorized
Grok4.7; no actual model turn, retained setupfailed. Supported native Pi credential-store
file link (not credential copy) plus nonsecret catalog restores exact Grok4.7Fast/low;
Jev vault is decrypted only in launch/child memory. Native-auth startup28763/28767 stopped
normally at0turns because its compiled2b runtime predated the latest source fix; it is only
an auth-startup check, not acceptance. Preserve both runs. Own agent home/settings remain
isolated, old auth is existing Pi credential authority, no plaintext secret copied/newly
written. No App/global model/threshold changes. Next exact new runtime, new run suffix,
real natural setup/play with isolated source home (48 copied legacy pages, PDF SHA verified),
then evidence/PID/SQL audit. Do not claim current source is validated by the old runtime.

Allfcaf completed RED611s:5441extpass/1fail/1skip,2128py/2skip,loop12pass; raw/per-file logs
retained all-fcaf662aa. Only immutable material-gap reuse expired its10s retry window under
full load; all new migration/claims/reader cases and kernel checks passed. The case now
prereads actual kernel workspace/source/check snapshots as well as actual PDF pages outside
its500ms allowance, asserts exact request args and clones those immutable responses inside.
No production limit/assertion/gate changed. Local8/8pass; final all after this TEST-ONLY fix
is next. Production source remainsfcaf and genuine runtime690/690 matches it.

Verified genuine setup40920/40921 completed5natural inputs/10tools/180.2s, self-created
professor44, originalPDF/Chinese, confirmed via normal setup. Copied48legacypagebytes remain
identical; live DB has48records/48imports/0claims/integrityok, no duplicate layout generation.
Current genuineplay44072/44073 has first root natural input pending (driver95069). Keep
waiting on actual state, no timeout/resource changes or fake reply. Root has only public
setup prose; no private source or thinking. Default hybrid mode does not activate optional
TaskRuntime flags, so do not claim TaskStore has live mode coverage without actual SQL rows;
its authentic TaskRuntime/controlled-source/multiprocess/crash regressions are separate proof.

All2c19 RED844s:5440?seeactualsummary/2extfail,2128py/2skip,loop12pass; all raw/per-file
logs retained all-2c19b77cf. Previous reuse test passed. Two timing-sensitive cases: layout
second timeout observed oneHTTPrequest although page.attempts/real outcomes were2, and held
answer was not carried under full load. Layout test now counts actual runtime.runTask calls,
not HTTP requests that may never start before the unchanged3000ms lease; exact2attempts,
no-third/timeout/requeue assertions stay. Next isolated unchanged held-answer check then
combined all. No model/resource/production timeout changes.

Independent realplay audit:3lookups success2347.7/12.9/4.5ms, then9provider transport failures
(Connectionerror7,Requesttimeout1,terminated1).8noHTTPheaders,1HTTP200truncatedSSE, no server
errorframe/no sustainedreasoning/output-limit evidence. Driver300s ended,agentsettled77.711s
later with no delivered text. SQLite data intact/integrityok/48legacy bytes+payload+imports
unchanged. Source modulepreparing with reader_transport and correctindependentreview failures.
All62observedPIDs exitedafter normalstop. Not successfulplay; no liveTaskStore coverage.
Safeaudit play-verified-provider-sql-audit.json. Underlying networkcause not retained in trace.

Latestmain advanced to1d1adba8b with otherownertransport/context/hybrid read-owner repairs.
Merged only committed changes into c28df9a33. Sharedcontracttail conflict resolved by keeping
main209metric note before own210; no content discarded. Their3targetedfiles50/50localpass.
This production drift needs newcombinedruntime/genuine continuation. Keep all previous reds
and failed/0turnauth startups; defaultTaskRuntimeflags off, don't flip them for fakecoverage.
