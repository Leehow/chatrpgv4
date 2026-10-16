# Keeper/output material handoff

Status: context implementation and scoped verification complete; full TS test
migration is owned by the separate image-items chat. Validation limits below apply.
Owner approved 2026-10-13.

## Objective and scope

Connect the existing Jev evidence preparation to explicit output material references,
then separate decision context from expression examples. Success means material references
survive the actual provider request, cannot silently change identity or expose private
source text, and avoid copying already public text. The Keeper still decides disclosure,
NPC intentions and effects; output only realizes the selected fictional material.

No new retrieval agent, model, automatic output, semantic classifier, permission bypass,
Mod threshold change, Python implementation, deployment or packaging is included.
All old and new gameplay evidence is retained. Existing unrelated dirty changes remain intact.

## Contract / implementation decisions

- The context owner gives each supplied material an input-local, immutable semantic source
  name, preserving its original bytes, authority, coverage and provenance. The public
  support indexes use those names. Only material confirmed in the converted provider
  request enters the output source registry. Explicit support lookup uses the same path.
- Source names are references, never disclosure grants. Whole-text reuse requires an
  existing explicit player visibility/privacy marker on a plain text owner result.
  Unknown/private source text requires a Keeper-authored permitted excerpt, as before.
  A player-visible delivery row may omit text only when its source permits exact reuse.
  Required references resolve before the author runs; no late silent substitutions.
- References bind to campaign/turn/worldline/loop/source revision and immutable content.
  A changed source, different input or unconfirmed request cannot reuse the reference.
  Resolved source revisions participate in writer cache identity.
- Pure expression example packets are handed to the output owner rather than inserted
  into the Keeper request. Existing rule instructions, personality, relationships,
  source evidence, temporal reasoning and Mod gates remain with the Keeper.
  No wait is added to the Keeper path; output inherits the existing bounded optional
  preparation wait and may use only current guidance.
- The three ends are: context/lookup prepares and confirms; output resolves and validates;
  the Keeper selects via delivery, and accepted artifact coverage records usage. Optional
  supplied material need not be expressed. Telemetry counts reuse and actual packet bytes;
  it must not feed a usage quota back into the Keeper.

## Validation plan

1. Real Pi hook + TS kernel regressions: automatic and explicit supply; missing/changed/
   private sources; required reuse; failed provider delivery; retry/cache; OOC unchanged.
2. Verify expression packets reach output but do not reach the front Keeper; decisions,
   rule instructions and personality remain. Compare actual request/packet bytes.
3. Focused tests on the LAN box, then fresh driver play with this main session as
   the sole player (Luna/high by default; authorized Grok/low fallback on saturation).
   Separate factual fidelity, request savings and timing;
   a small sample cannot establish general naturalness or latency superiority.

## Current state

- Baseline: 0.9.7a at c9df4d27b, with pre-existing dirty changes preserved in place.
- Before-image and unrelated diff: .tmp/keeper-output-handoff-20261013/.
- TypeSafe state/fan-out guidance supports named evidence and existing batched decisions;
  Anthropic effective-agents guidance supports narrow stages and measured complexity.
  Neither establishes a performance or prose-quality result for this implementation.
- Implementation and focused host verification complete; current live evidence below.

## Test-model steering (2026-10-13)

The owner changed subsequent test sessions to codex-relay/gpt-6-luna with high
reasoning, including the final author. Driver defaults and a bounded test profile
implement this without changing production defaults or old evidence. The failed
Grok startup (missing source-home credential) is retained. The later authorized
Grok fallback reuses only that provider's existing App authentication in the source
play profile.

## Progress and evidence

- Implemented confirmed automatic support registration, immutable semantic references,
  explicit support registration, public-text reference hydration, privacy/staleness
  rejection and source/profile-bound writer caching.
- Moved optional expression examples out of front requests. The selected author asks
  the current expression owner for guidance, with its existing bounded wait moved
  from the Keeper to the selected writer. Existing personality, rules and temporal decision context remain intact.
- `npm test`: 129 passed. Focused host/author/recovery/reference tests: 28 passed.
  Foundation/inventory/expression/reference set: 20 passed. Language/lookup: 10 passed.
  These are deterministic component/host tests, not gameplay.
- Same-input context diagnostic (`context-comparison.json`): converted request 1976 to
  1470 bytes, one expression packet to zero, front expression waits one to zero;
  personality retained in both. This small fixture is not a production average or
  a proven latency/naturalness improvement.
- The LAN runtime build succeeded after waiting for amax. The full focused selection
  is still queued behind another owner's test suite.
- Initial live setup under shared home failed on pre-existing conflicting cached
  Mod bytes. Isolated home creation succeeded; Grok startup then failed because the
  source Pi home has no Grok credential. All failure records retained. No credentials
  copied. Owner subsequently selected Luna/high for this and future tests.
- The test profile, source review, source-boundary regressions and limited live
  episode are complete. Final LAN results and corrections are recorded below.

## First Luna/high live attempt (retained, not acceptance)

Fresh source runtime built on amax in 3 seconds. The configured Luna/high model
was confirmed by the driver and by both final-author tasks. Opening output
succeeded after source-reference and snapshot retries. Jev then supplied six
materials for the first player input in 3063 ms (10 Jev calls). The player turn
hit the driver's 300-second limit; subsequent model records reported a 22500 ms
first-byte cap and relay HTTP 503 `codex upstream concurrency saturated`.
The owned daemon was stopped; this is not successful gameplay acceptance.
Evidence: `.coc/playtests/writing-handoff-luna-jev-20261013/` and the isolated
home `.tmp/keeper-output-handoff-20261013/live-home/`.

The source-reference errors also exposed a scoped check/output mismatch:
private sources without a permitted excerpt passed check and failed only at
output. Both stages now use the same preflight; the error identifies the issued
source and the exact excerpt fields needed. Two focused negative tests pass.
This repair still needs the queued final build and a fresh live run.

Combined fixed-input comparison including the new source names and guidance:
2422 to 2032 converted request bytes (390 bytes, 16.1%); personality retained.
This is a deterministic request comparison, not a live latency result.

The Luna/high test profile also supplies the existing 60000 ms Keeper call-cap
floor when no explicit environment override exists. This matches the existing
thinking allowance and avoids applying the ordinary 22500 ms first-byte cap to
this high-reasoning test. It does not change production budgets or relay limits.
The retry remains a separate run; its latency is not compared as an A/B result.

The owner subsequently authorized Grok 4.5/low fallback when relay concurrency
is full. This live retry uses that explicit fallback for the Keeper, author and
supporting lanes, while retaining Luna/high as the test default. Existing App
Grok authentication is reused only in the isolated source play profile.

## Final scoped regression and Grok fallback progress

The latest combined `final-output`, `expression-reference-context` and
`writing-support` run passed 25/25 tests. Differential TypeScript checking found
138 existing diagnostics before and after, with no added diagnostic; this is not
a clean whole-project typecheck. The same-input combined context comparison
remained 2422 to 2032 bytes with personality retained.

The Grok fallback runs from a fresh isolated home after shared cached Mod bytes
changed during concurrent development. The original conflicting cache is retained.
Evidence is in `.coc/playtests/writing-handoff-grok-fallback-20261013/` and
`.tmp/keeper-output-handoff-20261013/grok-live-home/`. The original LAN-built
runtime was retained, with only the two changed extension entrypoints rebuilt
locally while the full LAN suite waited for the shared box.

Opening and the first two player exchanges delivered successfully. The author
verified Grok 4.5/low; turn 1 received 702 bytes of expression guidance. The two
player exchanges took 133.5 and 111.6 seconds including the full runtime path;
they are not an A/B latency comparison. So far the Keeper chose its own material
proposals, with zero source-reference selections in those delivered turns.
Reference hydration is proven by the real-host deterministic test, not yet by
spontaneous use in this live sample.

### Completed live episode

The real driver episode ended naturally outside the newspaper office after a
failed Persuade roll (99 against 40) and refusal of archive access. The preceding
commission acceptance, cash/key handoff, travel and conversation remained playable.
The owned daemon was stopped at that episode boundary; the full Haunting campaign
has not ended. Four player exchanges took 515.2 seconds in total, with 15 reported
tool calls. This is a limited gameplay sample, not a quality benchmark.

Five accepted deliveries (including opening) verified the fallback author. One
private `support 7` reference was refused with the exact permitted-excerpt guidance;
the Keeper corrected the plan and delivered. One later author attempt aborted and
was retried successfully without repeating the settled transition. These failures
remain in the evidence. No accepted delivery in this sample selected a source-only
material, so it does not demonstrate spontaneous verbatim reuse or a token saving
from that feature. The successful expression handoff and the deterministic exact-
reference tests establish the two plumbing changes at different evidence levels.

### Integrated LAN validation

The queued run started on amax as `run.J8i0X9Sn` against source HEAD c9df4d27b
plus the current preserved working tree. The selector expanded to all extension,
Python and loop tests because unrelated package/test-runner changes are also in
this shared checkout. Runtime compilation and the routing loop completed; the
remaining suites are in progress. The definitive exit codes and counts will be
recorded here when the run finishes.

The owner questioned the Python test invocation because daily tests have moved
to direct TypeScript. Inspection confirmed that `npm test` is the 129-case TS
fast loop; Python-authored RPC/storage/process tests remain only in explicit
integration/full gates and exercise the TS kernel. The remote selector had
expanded this task to a full gate because it included unrelated dirty package
and runner changes. That was unnecessarily broad for this task. The Python
controller belonging to `run.J8i0X9Sn` received SIGINT and preserved its report;
its cancellation is not a test failure verdict. TypeScript extension and routing
checks continue. No test-runner or migration code is changed in this task.

The integrated extension run exposed a bounded-context regression: the added
repeated tool descriptions left only three bytes beneath the 104 KiB degraded
request ceiling, which was then exceeded by the required diagnostic. The fix
shortens the descriptions while retaining source/privacy requirements and the
same budget. The original failing run is retained. The unchanged ceiling case
passes after the fix (`context-ceiling-repair.log`), and the direct TS fast loop
was rerun at 129/129 (`npm-test-final.log`). No limit or assertion was relaxed.

The owner explicitly assigned full TS/pytest migration to the existing
"Image items" chat on 2026-10-13. This task owns only the context optimization
and its regression fixes; it must not edit that chat's migration ledger,
integration tests, runner migration or dependency removal.

The retained integrated run also exposed older context test doubles with an
`events.on` method but no `events.emit`. Production Pi supplies both. Those
fixtures now implement the same event delivery interface, and the source-owner
request regression explicitly verifies that only a confirmed provider packet
emits exact, bound materials to the writing owner. No production handoff guard
was weakened to accommodate a test double.

Post-repair targeted results: source-request 11/11; context/prescreen fixture
suite 93/93; compact-description/profile/language checks 6/6. Differential
TypeScript diagnostics remain 138 before and after with no additions. The
same incomplete event-bus fixture was also found in `check-preflight` and is
being corrected at the fixture boundary, not by making production emission
optional.

## Final result

The retained pre-repair LAN snapshot completed in 554 seconds across 651 extension
files: 5,787 passed, 21 failed and one skipped. All 21 failures were in the seven
identified files: the degraded-request ceiling and incomplete event-bus fixtures.
They are not hidden or counted as passing. Routing passed 12/12. The Python lane
exited 130 after intentional interruption (784 had passed); this is not a complete
Python result and no Python rerun belongs to this task.

After the fixes, all affected failure groups passed: source request 11/11,
context/prescreen group 93/93, check preflight 1/1 and original ceiling case 1/1.
Core output/reference tests previously passed 25/25; profile/language/automatic
handoff checks passed 6/6 after shortening the tool descriptions. TS fast tests
passed 129/129. Differential typechecking adds no diagnostics to the existing
138. No clean post-repair full-suite rerun is claimed; the focused corrections,
raw broad-run failures and live evidence are all retained.

The final same-input comparison is 2422 to 2032 bytes (-16.1%), with authored
personality retained, no expression packet in the front request and no front
expression wait. Live output consumed expression guidance and continued through
commission, custody, travel, NPC speech and a fumbled check. This establishes
working routing and safeguards, not overall speed/naturalness superiority or
spontaneous public-text reuse. No commit, push or App packaging was performed
by this task; unrelated shared changes remain intact.

## Requested post-repair complete extension rerun

The owner requested continuation after scoped verification. This rerun uses
`remote-test.sh run <worktree> ext` on amax, not the legacy `focused/all` paths
that still invoke pytest. It does not edit the migration owned by the other chat.
The exact shared source overlay was built and retained under `run.vE6sMn84`;
local evidence is `post-repair-ext.log` and `post-repair-source.json`.
The TS fast tier passed 129/129 again (exit 0). The complete extension rerun
passed 5808/5809, with zero failures, zero cancellations and one existing skip
(exit 0, 638 seconds including the runtime build). The skip requires an explicit
read-only historical graph via `COC_HISTORICAL_WEAKNESS_GRAPH`; its condition was
not changed. This completes the clean post-repair extension gate that was missing
from the earlier final result.

The independent routing suite passed 12/12 (exit 0). No pytest command ran in
this continuation. The native integration migration remains owned by the other
chat and is not represented as complete by these results. All sixteen scoped
source fingerprints were unchanged from launch through completion, and
`git diff --check` passed. The complete extension log is retained locally in
`.tmp/keeper-output-handoff-20261013/post-repair-lan/remote-ext.log`; fast and
routing logs are `post-repair-fast.log` and `post-repair-routing.log`.

## Canonical App delivery

The owner subsequently requested App packaging. `node pipicoc/package.mjs`
completed with exit 0 using verified local Node/Git/source archives and offline
dependency installation. The canonical real bundle is `/Applications/PipiCOC.app`;
`~/leehow/code/pipicoc-build/PipiCOC.app` remains its backlink. Receipt time:
2026-10-13T05:29:45.495Z, arm64, `PipiUI Dev` signing identity. Deep strict signing
verification passed with the same designated leaf certificate as the previous App.

At installed-package verification, the kernel/table extension hashes matched
the package's build and assembly inventory. The material-reference freshness guard, confirmed
support bus and output expression handoff are present. The App's own Node and
RPC entry answered `kernel.hello` and `campaign.list` successfully (exit 0) in
an isolated empty workspace. This is a package smoke check, not a new playtest.
The preflight matched all sixteen tested source fingerprints. After installation,
another chat modified clue-disclosure descriptions in the shared `tools.ts` and
rebuilt local outputs (01:34 local time, after the 01:29 package receipt).
Those later edits were not repackaged by this task. The installed artifact remains
bound to the saved verified extension hashes and its own assembly inventory.

LaunchServices and Spotlight resolve only the canonical App; no nested helper
registrations remain. Staging is empty. The new canonical executable was launched
(PID 9646 at verification); its renderer restored the existing idle chat and
displayed a ready message input with no running generation. No player input,
campaign mutation, model-default change, commit or push was performed.

Evidence: `.tmp/keeper-output-handoff-20261013/package-app.log`,
`package-receipt.json`, `package-signature.log`, `package-hygiene.json` and
`installed-package-check/result.json`. The canonical receipt is also retained at
`~/leehow/code/pipicoc-build/pipicoc-package.json`.

## Installed-App real play: source linkage passes, expression lifecycle fails

The owner requested a real play segment against the installed App. The TS RPC
driver launched the canonical App's `pi-coc/bin/pi-coc`, with the App's agent
profile and an isolated campaign home. Pregen setup also used the installed
Node, kernel and content, rather than the driver's source-build setup shortcut.
Deep strict signing verification passed; both installed extension hashes still
match the package snapshot above. No implementation or package was changed.

`installed-context-luna-20261013` confirmed Luna/high but received repeated
503 `codex upstream concurrency saturated` errors. Its evidence is preserved.
The authorized fallback, `installed-context-grok-20261013`, confirmed Grok
4.5/low for the Keeper and every observed final author. The sole player gave
natural utterances one at a time. The segment followed the commission into a
newspaper investigation, secured clipping-room access, obtained a held article,
checked its withholding rationale, and left with further investigation leads.
The segment completed naturally; both owned drivers were stopped.

Two accepted deliveries used source-linked public excerpts. Their accepted
evidence retains the support source names, revisions, coverage and text exactly
as supplied in the Keeper's output plan. Neither used omitted-text hydration;
automatic full-text reuse therefore remains unproven by this installed run.
An attempted private scene reference was refused before author publication.

All 29 recorded Keeper request projections contain zero
`coc-expression-reference` segments. However, turn 5 selected and prepared
expression references twice, then successfully ran a private `narrate` check
(`checked:true`, `writer_started:false`, `published:false`). The installed
table observer treats every `narrate` result as delivered, aborts the input
lifetime and resets expression preparation. The subsequent accepted output has
zero expression bytes and no expression handoff event. This is a confirmed
check-versus-publication lifecycle defect, not a Jev relevance rejection.
The installed run does **not** pass complete KP/output responsibility acceptance.
The proposed repair is to retire the expression lifetime only after actual
committed publication, preserving it across private checks and failed calls.
Repair and repackaging were not part of this validation-only continuation.

Raw evidence: `.coc/playtests/installed-context-{luna,grok}-20261013/` and
`.tmp/keeper-output-handoff-20261013/installed-live-home/.coc/`.
Filtered provenance and acceptance evidence: `installed-live-provenance.json`,
`installed-live-evidence.json`, and `installed-tool-evidence.json` under the same
task evidence directory. The fallback completed seven player inputs and eight
accepted deliveries including the opening; those counts describe the evidence,
not the success criterion. No pytest, synthetic player, or fake Keeper ran.
