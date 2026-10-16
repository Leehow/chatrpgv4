# MiniMax Enhanced

## Objective and acceptance

Add an independent MiniMax enhancement extension, analogous to the Grok integration,
while retaining Pi's native MiniMax accounts and model catalog. Success means:

- M3 tool continuations preserve unsigned thinking as thinking, not visible text.
- Granted Historical Reference requests can use documented MiniMax server search,
  with exact original protocol replay and no search outside the existing grant.
- MiniMax image-01/image-01-live work through the existing image dispatcher and
  portrait/illustration reuse path, with explicit selection and unchanged defaults.
- H3/H3-Max video submission and status retrieval are available through extension
  commands and the existing host invoke port; task IDs survive in private session
  entries. Return the result URL without downloading video payloads.
- Source/runtime/profile loading, host disablement and offline native SDK requests
  are verified. Distinguish these from real service use, GUI acceptance and packaging.

## Scope and constraints

Latest branch is 0.9.7a at 59abc4371, with extensive existing WIP including the
previous Anthropic cache extension. Preserve it. Approved scope is this extension,
shared native-search/image integration, deployment/installer wiring, focused tests
and contracts. No extra Keeper verb, provider account, model-default change, Pi
fork, kernel-state authority, automatic media generation or unrelated cleanup.
No Python/uv/node-gyp; heavy checks use a LAN box after probing. Empty synthetic
unit workspaces need no retained seed (test-data-storage.md).

## Design and evidence

Official MiniMax M3 function-call docs require complete assistant content,
including thinking/text/tool_use. The current Pi Anthropic adapter converts an
unsigned thinking block into text unless allowEmptySignature is enabled. Use a
stream-only provider override; preserve catalog, auth, effort and output limits.

MiniMax server-tools docs specify web_search_20250305 for Anthropic Messages and
web_search for Responses. Initial product support uses the existing Anthropic
transport only. Register a provider capability with the shared native-search
adapter; do not bypass the Historical Reference campaign/run/step grant. Exact
replay retains original order rather than regrouping server/thinking blocks.

Image requests use POST /v1/image_generation, base64 output and optional character
subject_reference; these are subject-reference regeneration, not arbitrary masked
edits. Video uses POST /v2/video_generation and GET
/v2/query/video_generation/{task_id}. Submit once; no silent retry, polling timer,
automatic cancellation/deletion or video download. Reuse registry credentials;
refuse unsupported model/endpoint/parameter combinations before sending.

Sources checked 2026-10-16:
https://platform.minimax.cn/docs/guides/text-m3-function-call
https://platform.minimax.cn/docs/guides/server-tools
https://platform.minimax.cn/docs/api-reference/image-generation-t2i
https://platform.minimax.cn/docs/api-reference/image-generation-i2i
https://platform.minimax.cn/docs/api-reference/video-generation-v2-create
https://platform.minimax.cn/docs/api-reference/video-generation-v2-query
Anthropic's thinking documentation independently confirms retaining thinking on
tool continuations, but its signatures and model-specific budgets do not establish
MiniMax behavior: https://platform.claude.com/docs/en/build-with-claude/extended-thinking

## Progress

- Contract and implementation complete: unsigned thinking, M3/preview native
  search capability and exact replay, shared image adapter, H3 create/query,
  private task receipts, real invoke registry/settings component and profile routes.
- Thirteen extension tests pass, including actual Pi serialization, source and
  emitted registration with native auth/catalog preserved, both image operations,
  the actual shared portrait entry, search replay and host invocation.
- Shared cache/search/image/control-flow checks passed (85 tests before the extra
  emitted-runtime case). Source/emitted MiniMax, launch, installed profile, RPC,
  system-language and TS foundation checks passed (54 tests). Kernel typecheck,
  JavaScript syntax and diff whitespace checks passed.
- LAN probe selected idle amax. The first focused run was explicitly interrupted
  after discovering the required two new control-flow inventory entries were not
  in its snapshot; its result/evidence remain in run.YdY9sCH5 (143). The updated
  inventory passes. Latest focused run.49TEgCb6 was stopped at the user's request
  before leaving the lab on 2026-10-16. Its 662 completed extension files all
  exited zero; run-driver-output.test.mjs was still running. Integration/routing
  phases had not started. Result 143 and all partial evidence remain under
  /home/lihao/chatrpgv4-testbox/wt/codex-tests/.pytest-runs/chatrpgv4-wt-pi-coc-v2/run.49TEgCb6.
  Verified all five task-owned remote shell/test PIDs exited; do not restart amax.
- The successful runtime build from that exact snapshot was fetched over LAN;
  local and remote MiniMax bundle SHA256 both equal
  ab9b51eb6bf231155da6a1336d24a449aa9ee7e17b30c630f9749434914f5245.
  The later local test-only additions verify the shared portrait function and
  emitted Pi registration. A later one-line settings-component fix accepts the
  host's string error envelope; syntax, installed assets and language checks
  passed again (6 tests). Agent/runtime production sources still match the build.
- User resumed the remaining tests from home. Probe selected idle leehow-pc,
  reachable over LAN at 192.168.31.113; amax remains untouched. Branch/HEAD still
  match, with additional unrelated fixture-storage WIP preserved.
- The unfinished run-driver-output file, current MiniMax/cache/search/image/
  launch/profile/RPC checks, mandatory smokes and routing-loop test passed through
  the canonical remote runner's explicit-file native test harness: 194/194 tests,
  exit 0, 192 seconds on leehow-pc, run.yfyuh9Qt. This avoids repeating all 662
  completed extension files. Its selected logs, source hashes, result and JUnit
  are copied to .coc/test-runs/minimax-enhanced-OXpoHl/targeted/.
- Full TS integration passed on the same box, run.daYpT0dK: 2,193/2,193 tests,
  exit 0, 435 seconds; no skipped or cancelled tests. Selected logs, source hashes,
  result and JUnit are copied to .coc/test-runs/minimax-enhanced-OXpoHl/integration/.
- Validation is complete for this implementation scope. All twelve extension and
  shared adapter/deployment source files match the tested snapshot hashes; the
  MiniMax test file also matches the remote SHA256. The earlier 662-file amax
  results remain distinct partial evidence, not a claim of a new complete
  extension sweep on today's other unrelated WIP. Both remaining test batches
  ran serially on leehow-pc and ended successfully; no test or production fix was
  needed during this continuation.
  No live API/media generation, desktop GUI acceptance or App packaging has
  been performed.

## Live API and package follow-up (owner authorized)

The user explicitly requested real MiniMax API validation, followed by rebuilding
PipiCOC once verified. Use the existing App profile's read-only credential store
and native provider, without copying keys or changing model defaults. Retain actual
cache-write/read usage, native thinking/tool/search continuations and minimal
image/video service outcomes separately from earlier synthetic tests. Use an empty
owned protocol workspace, not a campaign or a fictional playtest. Account/service
limitations are findings, not successful generated media. Never silently retry
media submission or switch accounts.

Before packaging, read the global macOS App hygiene policy. The current recipe
installs the real bundle at /Applications/PipiCOC.app and the legacy build-home
back-link points there; preserve this project-specific current layout. Use the
stable PipiUI Dev certificate, cached archives and offline npm; clean all staging
on exit and verify exact canonical executable, signature and extension assets.
The current canonical App is running and must quit normally before replacement.

The owner additionally requested post-package real play with M3.1/medium for both Keeper and final author, covering cache hits, Historical Reference and image generation. Added the exact test-only profile to the existing driver/author paths; product defaults and auxiliary lane choices remain intact. Scoped regression is running on leehow-pc before packaging. Live protocol evidence is .coc/test-runs/minimax-live-n1ScSX/: preview cache reads rose from 128 to 7680 on the second request; native default baseline second request reported only 128. M2.7 omitted cache counters, and all observed endpoints omitted cache creation counts. Preview and M3 returned real thinking blocks and replayed them through local tools. Hosted search and its local-tool continuation succeeded. Image generation and subject-reference generation succeeded. H3 create returned HTTP 402 and created no task; keep it unverified.

Package follow-up: shipped /Applications/PipiCOC.app using PipiUI Dev with strict signature verification and an empty staging root. Canonical LaunchServices registration resolves only that App; Spotlight still returned no match after mdimport, which is an indexing limitation, not evidence of a second bundle. GUI verification found the missing settings-tab admission, fixed minimax-media in the existing whitelist, passed its 16 existing UI tests and rebuilt. The omitted git-capability import remains the existing baseline suite-load failure, unchanged. The repaired real App now visibly shows the MiniMax panel and minimax-cn configured.

The cloned haunting-s0 attempt stopped at campaign_not_ready because retained narration-audit 1.3.0 bytes conflict with the current product; preserve that entire workspace/run as invalid-for-play-acceptance. Fresh campaign minimax-m31-medium uses the shipped thomas-hayes pregen via the production campaign.create method. A fresh driver runs the canonical packaged launcher in compiled/hybrid mode, run minimax-m31-medium-table-20261016, home .coc/playtests/minimax-m31-medium-fresh-20261016/workspace. The first two real player turns settled and published through actual M3.1/medium isolated authors. Cache usage is retained in RPC entry_appended coc-telemetry records. First turn had a provider truncated stream followed by one invalid-tool-pair retry; normal recovery completed, so keep this limitation visible and continue real play.

Real table follow-up: four sequential player inputs completed (three in-fiction replies and one OOC image request). Historical Reference actually executed two server searches with 20 returned source rows. KP correctly lacks the separate image-generation host port, so verify the shared packaged image/portrait entry separately rather than count its refusal as image success. Live trace exposed incomplete server-call/result records after a truncated stream; two focused regressions reproduced unsafe retention and old-record replay. Added MiniMax exact-protocol terminal/visible-identity/pair completeness guards; incomplete records are marked unavailable and hosted search closes for that run, with no changes to game tools or other providers. Scoped regression and a final rebuild remain before more real play. Retain original stream/retry errors and all test runs.

## Final acceptance, 2026-10-16

Completed the scoped follow-up. The M3.1/medium test-profile checks passed 90/90
on leehow-pc (run.ccEM2nmJ); search completeness checks passed 63/63 on the same
box (run.L2NbaOBd). MiniMax extension coverage now has fifteen cases, including
the two regressions observed red before the protocol guard. The UI registry's
sixteen tests passed. These are scoped checks after the earlier complete
integration run, not a claim that all suites were repeated on the final tree.

The final canonical package receipt is dated 2026-10-16T12:40:23.289Z. Strict
deep signature verification passed with PipiUI Dev; the packaged native-search
hook contains the completeness guard. Staging is empty and the legacy build
path links to /Applications/PipiCOC.app. LaunchServices and Spotlight now both
resolve that canonical bundle. Reopened the final bundle, verified its executable
at /Applications/PipiCOC.app/Contents/MacOS/PipiCOC and visually verified the
MiniMax settings tab and configured minimax-cn account. No account or product
model-default changes were made.

Two valid real driver runs completed seven sequential player inputs: five
in-fiction turns and two OOC requests. Keeper used the requested
minimax-cn/MiniMax-M3.1-Flash-Preview / medium; all five isolated fiction authors
reported that same actual model and effort. Both drivers stopped normally.
The repaired run minimax-m31-medium-repaired-20261016 completed three inputs
without provider errors. It rejected one incomplete hosted-search response as
unavailable, continued game tools, and subsequently completed two historical
queries with twenty source records in the OOC reference turn. Preserve the
original run's truncated stream and invalid-tool-pair errors as pre-fix evidence.

Repaired-run cache reads were 41984, 128, 51584, 53760, 52992, 93184, 42240 and
128 tokens. Real reads demonstrate reuse, with low-hit requests also present.
Creation counts were omitted, so no complete hit ratio, write count or total
cost-saving claim is established. The separate controlled protocol probe saw
read tokens rise from 128 to 7680 on a repeated long prefix. M2.7 omitted counters.

The final packaged shared image dispatcher generated a 308081-byte image-01
JPEG, packaged-office.jpg, visually checked against the public office prompt.
The earlier direct generation and subject-reference generation also succeeded.
Keeper's OOC refusal is not counted as image success: generation belongs to the
existing host image/portrait path. Video remains unverified because H3 submission
returned HTTP 402 without a task; no silent retry or account switch occurred.
Historical search transport works, but the prose initially invented paper names
and currency wording; an OOC challenge corrected them. Returned source quality
and cross-year prices do not establish precise historical accuracy.

Consolidated evidence: .coc/test-runs/minimax-live-n1ScSX/live-assessment.json,
package-audit.json, package-final.log and the generated images. All campaign,
playtest and invalid-seed evidence remains intact. Final git diff --check passed;
the extensive unrelated dirty tree was preserved, with nothing staged or committed.

## Owner follow-up: cache writes, reuse and both image controls

Owner requested explicit write statistics, high cache reuse and Grok-equivalent
portrait/scene generation. Scope is existing cache and image host paths. Success
requires honest raw usage accounting, preservation of warm unchanged boundaries,
and actual host portrait/scene results. Fake write estimates or a bare adapter
image counted as full host acceptance would be invalid-for-intent.

Storage contract read; admission recorded in followup-admission.json (146.9 GiB
free; 512 MiB maximum growth, expected 8 MiB). Existing campaign/playtest evidence
is preserved; empty protocol and image-control workspaces need no seed copy.
Raw stream/non-stream probes returned no streaming write field and non-streaming
write zero even on a fresh unique prefix. A repeated streaming prefix read 6656
tokens. Keep missing and reported zero distinct; client code cannot certify
server cache creation from either. Official MiniMax and Anthropic caching docs
again confirm five-minute reuse, twenty-block lookup and four explicit markers;
M3's official model page also advertises automatic caching. These validate
retained explicit prefix boundaries, not a new warming request or speculative
write-count inference.

Added a hash-only snapshot of completed request boundaries and preserved a still
identical old conversation marker when appended blocks exceed the lookup window.
The two focused regressions failed before the change and pass after it. Changed
tools, effort, tool choice, model, expiry or failed requests cannot manufacture
reuse. Added status/UI statistics with reported-write totals, coverage and null
for missing counts. Existing portrait and scene host controls already share the
MiniMax adapter; added a full host-control regression covering actual defaults,
configured selection, portrait storage and scene character-reference storage.

Follow-up completed: the final scoped LAN run passed 107/107, exit 0, on
leehow-pc (run.5ZjnFBQ8). An additional regression exposed loss of the first
physical request's writes when a hosted-search pause continued within one Pi
message. It failed before the fix; each message_stop now retains its own usage
and message_end is the error fallback, with no duplicate accounting.

Real source-prefix probes added thirty-five content blocks and reported warm
reads of 9856 tokens with 95.26% and 95.03% reported-input read shares. After
packaging, repeated the probe using the installed cache bundle and an actual
tool definition, exercising the four-slot pressure case: the redundant tool
marker was replaced by previous-prefix while system, brief and tail remained.
Warm reads were 10112 tokens with 95.67% and 95.52% reported-input read shares.
Both passed the >=90% warm unchanged-prefix target. The cold request reported
only 128 read tokens. These shares exclude unknown writes; they are not complete
cache-hit ratios or a guarantee for changing prompts/tools or server eviction.

Actual default host controls generated a 302236-byte character portrait and a
183167-byte scene illustration. The scene task ran M3.1/medium with actual read
and write tools, produced a 755-character prompt, and sent the stored portrait
as a character reference. Both images were viewed; likeness/era/setting broadly
match, while exact gesture placement is not guaranteed. The first synthetic
host fixture omitted its campaign folder, so its generated portrait could not
be saved; preserve that failed harness log, exclude it from acceptance, and
count the later successful host run separately. No production storage fix or
automatic media retry was introduced.

Final package receipt: 2026-10-16T13:14:27.913Z, real bundle
/Applications/PipiCOC.app, PipiUI Dev, strict deep verification passed. The
legacy path is a back-link, staging is empty, LaunchServices and Spotlight each
resolve only the canonical App. Final executable and installed cache/control
assets verified. Reopened the App and observed Cache usage, read/write reported
coverage, refresh and existing image-control guidance. Its selected ordinary
session has no MiniMax telemetry, so 0/0 requests correctly displays unreported;
no product model/image default was changed. All owned test processes ended.
Consolidated evidence is followup-assessment.json under the existing live API
evidence directory. Full write-token accounting remains limited by the real
service's omitted/zero counters; no client inference fills that gap.

## Agent request construction follow-up (owner 2026-10-16)

Intent: keep actual MiniMax play request prefixes stable across inputs and tool continuations; a high-hit synthetic prompt alone is insufficient. Added a bounded, submitted-request journal at the table context seam, initially for MiniMax single-Keeper sessions. State/history/clerk updates and moving book windows append exact structural revisions; full successful assistant responses, including thinking, remain in history. Source revisions no longer reset a stable module identity. Capacity, module/worldline/model/system changes and native-history mismatches remain explicit checkpoints. Final authors retain private real working directories while omitting their random cwd system section; the existing cache policy is reused. No model defaults, semantic output repair or canonical state mutation changed.

Retained evidence: .coc/test-runs/minimax-request-journal-20261016. The first real API transport probe without complete assistant replay still had low reads; the complete-response probe then returned 98.624%, 98.255%, 97.897% on three warm requests. These are synthetic transport results, not gameplay acceptance. Initial packaged gameplay run .coc/playtests/minimax-m31-medium-append-game-20261016 delivered one turn, then hit the previously observed compose JSON format error. Its lookup also exposed a moving-brief checkpoint, now covered by exact book-revision tests. All failed and successful evidence remains.

Current targeted source/SDK checks pass 79 tests. Initial LAN snapshot run.nk55mNGY on leehow-pc: extension phase 3833/3834 pass; test-tiers rejects the already-dirty native play-driver counterpart hash (actual 5716496cc501a65d7e83668500a441900a58019249f8ad24a28096371c4d72c6, inventory a452e3de5011891a1f464f787f3f1000f16cfbf05e38606275904426393b44fd). No migration expectation was rewritten. Integration/routing phases and final packaged game remain in progress. Initial LAN snapshot predates the final assistant/book refinements, so final affected checks must run on the final source too.

Final real-game diagnostic .coc/playtests/minimax-m31-medium-append-final-20261016 is stopped normally with all evidence retained. Four genuine inputs yielded ten KP requests, including dialogue, lookup, travel, a failed check, door inspection and a capacity checkpoint. After the initial request: 574976 read / (574976 + 46783 input) = 92.4757%; all ten requests including initial: 88.6256%. Individual warm shares 81.17%-98.15%; capacity checkpoint still read 41216 tokens. Writes remain unreported. Three delivered turns used M3.1/medium authors; one compose-format failure recovered with an ordinary next input. Author reads were 1174,128,1152 on independent short packets, so do not claim stable high author reuse or full story acceptance. Package 2026-10-16T14:57:15.330Z is canonical, strictly verified under PipiUI Dev; table, reader-context and cache bundles exactly match local build; staging is empty.

Initial LAN snapshot integration passed 2188 cases with one skip and zero failures; routing passed 12. The bookkeeping method requestJournal.complete caused a scanner false positive on final source; it is now explicitly inventoried as infrastructure with no inference/task/network call. The guard was not weakened. The final nine-file LAN rerun is recorded in run.7ffD8qt1/final-agent-tests-verified.log. Broad native-counterpart SHA drift remains separately reported. No source commits or pushes were made.

Final nine-file LAN rerun completed: 126/126 passed, exit 0. Source/package and evidence audit complete; only the documented prior SHA-inventory drift, unreported writes, intermittent short-author reuse and independent compose-format failure remain.
