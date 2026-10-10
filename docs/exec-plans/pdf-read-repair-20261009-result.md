# PDF reading repair outcome, 2026-10-09

Five confirmed source/runtime repairs are integrated into latest mainline `0.9.7a`.
The source integration is `e0a30b08b12d2240b4258f2425b6fb92c173c0c3`.
This record does not claim a completed adventure, installed-App acceptance, or a general latency bound.

## Repairs

1. Preserve accepted opening handles before world creation, promote them into the first world, and
   recover only uniquely matching accepted bindings. The real Cold Harvest setup now reaches ready_for_table.
2. Separate source consultation and publication focus locks. Same-domain serialization, the three-slot
   capacity and foreground reservation remain unchanged.
3. Await stranded-turn release before agent_settled completes. The next player input no longer races
   the host's pending release; failed-release protection remains in place.
4. Retain cast-name physical pages and supply relevant connected names to authors and reviewers.
   Page metadata remains navigation, not proof. A real repaired reader published generation 13 with
   167 supported, zero unsupported and zero missing findings after removing uncited alias assertions.
5. Project existing source-clue ready/missing status and an exact-handle prepare action into capsule,
   look and host candidates. Preserve the first typed rule preview when the new hints consume budget.
   Component tests verify blocked discovery before publication and readiness after checked publication;
   live capsules also carry the preparation hints. Gates, thresholds and resource limits are unchanged.

## Latency findings

| Sample | Measured cause |
| --- | --- |
| Blood Road turn 22, 155.827 s | Six Keeper generations 95.563 s, admission 18.275 s, establishment review 15.650 s; corrective move calls and an untold-name refusal added model round trips. |
| Background source read-5, callback 637.971 s | 548.456 s after demotion waiting to claim behind the same-focus material/map job; author 52.500 s, review 36.519 s. The final answer was unresolved. Initial foreground allowance is outside this callback measurement. |
| Cold Harvest T30, 171.342 s | Existing 120 s source material wait after attempted discovery of an unprepared clue, plus admission 8.079 s and Keeper generations 32.848 s. No provider retry or queue deadlock. |
| Final resumed turn 9, 96.267 s | Keeper 46.430 s; rejected handover apply 13.473 s; corrected apply 11.970 s; narrate 17.106 s. It completed normally with movement and bottle transfer receipts. |

Source excerpt probes of about 2–3 seconds are not end-to-end turn times. The original CLI baseline
also lacked the production Jev credential and took its fallback path. Later source play used the existing
encrypted App credential solely in child memory. No credential was persisted or printed.

## Verification

- LAN all at `23df4efc5`: ext 5410 passed, zero failed; pytest 2127 passed / two skipped; loop 12 passed.
- LAN all at `9cb131584a61bdf7ada8bde13e4dd8e52e90e53d`: ext 5413 passed, zero failed;
  pytest 2127 passed / two skipped; loop 12 passed. All exit codes zero, wall 879 seconds.
- The subsequent mainline destination-question amendment `781f96c28` was merged without conflict.
  Local source readiness, mechanics preview and destination-row checks pass 18/18; the exact final
  `e0a30b08` runtime was built on the LAN box and fetched successfully. The all-suite run predates this
  independent prompt amendment; do not label it an all-suite run of e0a30b08.
  A fresh exact-runtime driver delivered one natural follow-up in 78.299 seconds and stopped normally.
- Native-text audit: 41 Blood Road and 48 Cold Harvest cached pages match freshly extracted PDF.js
  line multisets and native/transcript hashes. This checks 89 cached pages, not every page in every book.
- Ordinary real play: Blood Road 26, Cold recovery 23,
  cast provenance nine, readiness nine and exact-runtime follow-up one: 68 turns. One Haunting turn is supplemental. Setup inputs,
  provider-failed opening, pause input and component fixtures are excluded. All use the real RPC driver,
  Grok 4.7 Fast / low and this main chat as the natural-language player.

## Remaining limitations

- One explicit 50-character notebook addition was rejected at content confidence 0.84 below the
  existing 0.9 threshold despite matching the requested record. This is an unfulfilled player choice,
  not a successful safety correction. A later exact 12-character sentence did append once, revision
  2 to 3; that success does not erase the earlier false negative. No unsupported threshold relaxation.
- T28 described arrival one turn before the T29 move receipt corrected world position. Preserve this
  delivery/accounting delay as an experience limitation, not a PDF parsing failure.
- Source clues may still need a 120-second material wait. The projection repair makes the prerequisite
  visible; it does not prove that the Keeper always follows it or that every future turn is fast.
- The final readiness run started with 23df4efc5; its ninth turn overlapped a build refresh. Source-reader
  code did not change, but it is not exact e0a30b08 acceptance. The separate fresh driver verified that build.
- The separate App session was preserved. No package, restart, push or installed-App acceptance occurred.

## Evidence

Owned worktree: `/Users/haoli/.codex/worktrees/pdf-read-repair-20261009`.
Source home: `/Users/haoli/leehow/code/chatrpgv4-wt-pi-coc-v2/.coc/playtests/pdf-text-20261009-home`.
Final logs and machine-readable metrics are in `.coc/playtests/pdf-clue-readiness-final-20261009-play/`:
`final-regression.log`, `final-combination-regression.log`, `final-runtime-build.log`,
`runtime-final-hashes.json`, `overnight-result.json`, `turn-1.json` through `turn-9.json`, and `final.json`.
Exact final runtime follow-up is in `.coc/playtests/pdf-exact-final-20261009-play/`.
All original campaign, module, event and transcript evidence is retained. Lifecycle closeout must retain
this worktree for its protected evidence marker; removal is not authorized.

## Final retention audit

Mainline outcome record is integrated. Both owned drivers stopped normally; heartbeat pdf is PAUSED.
The exact lifecycle tuple is terminal and intentionally retained for real evidence. Closeout with
verification=passed failed closed (exit 2, blocked_probe) because lsof could not stat the unrelated
WebDAV mount /Volumes/10.3.2.75. Final audit returned exit 0 with audit_pending, pending_count 1: exact identity/branch
match, registered, terminal, dirty only for the protected evidence marker. Classification is
retained:protected_real_playtest_evidence_and_incomplete_process_probe. No removal, mount repair,
branch deletion or clean lifecycle completion is claimed. Detailed receipt: final run lifecycle-final.json.

## Approved source-query optimization follow-up, 2026-10-10

The user approved the design changes. Commits 95909a4dd / 3508c826d implement one
foreground allowance across source binding, checked-cache preflight, original retrieval and
fallback. Exact in-flight original work joins through fallback; cancelling one caller does
not cancel another. Original envelopes reuse a source/revision/campaign/worldline-bound
16-entry / 64 KiB cache. Accepted semantic answers use the kernel's existing retained
draft/review digest checks with cache_only; a miss never queues or promotes work.
Focus domains and priority now share one policy, with the existing library-to-campaign
priority preserved. Host-only claim deferral records explain conflicts or capacity.

A real Grok 4.7 Fast / low lookup returned pending in 8008.4 ms: 3384 ms used before
fallback and only 4616 ms remaining. It continued in the background and landed as
unresolved 137605 ms later. That is foreground-budget success, not a verified source
answer or a whole-turn eight-second promise. Six genuine inputs followed; one absolute
clock-time sleep declaration was refused (declared_time_unresolved), while explicit
durations produced the 480- and 300-minute receipts. Day-part prose differed from the
clock in two turns. These unrelated temporal/narrative limitations remain recorded.
Water observations and laboratory transfer were delivered; no full adventure completion.

Final all at 3f5859fab827adf22b27f523c956d013f82f4ba6 passed ext 5428 / zero failed,
pytest 2128 / two skipped, loop 12 / zero failed; every exit code zero, wall 851 s.
Kernel noEmit check passed. Earlier 3508 all had one Python FileNotFoundError, despite
94 unchanged isolated driver tests passing. A deterministic concurrent rename reproduced
the pid-only JSON staging collision. Commit 3f5859fab gives every write unique staging
and cleans its own temporary file; the same barrier passes, and a real repaired driver
completed and stopped with no staging leftovers. No timeout or resource limit was raised.

Evidence: owned .coc/playtests/pdf-query-optimization-final-20261010-play (five inputs,
query telemetry, runtime hashes, original failed logs and final green regression log),
pdf-query-driver-closeout-20261010-play (one input and normal stop), and the excluded
zero-turn startup pdf-query-optimization-20261010-play. All retained. The App was not
repackaged or restarted by this task; the earlier pdf heartbeat remains PAUSED.

Follow-up integration and retention: source/driver changes and the record are on latest
0.9.7a; the other owner's untracked turn-capability-and-mod-discovery.md remained unstaged.
Owned tuple is terminal and classified retained:protected_real_playtest_evidence_and_incomplete_process_probe.
Closeout returned blocked_probe / exit 2 for the unrelated WebDAV lsof warning. Audit
returned exit 0 / audit_pending / pending_count 1, proving exact identity and branch matches
with the protected marker retained. This is not a clean deletion audit. No evidence or
branch was removed and no unrelated mount was modified.
