# Enhanced Locations Mod acceptance

Current follow-up: Enhanced Locations 1.1.2 is installed in the canonical App.
The release source is `28c4a5df515fc4d6c14cd606c610e66a50486da2`. Actual
observation/history play and native UI refresh/cold restoration have passed.
Final full coverage completed with two initial 15-second cancellations; both
unchanged files then passed serially, 13/13. The original overall exit 1 is
retained. Source, package, evidence and remaining limits are recorded below.

Historical baseline: original implementation and F1–F4 failure repairs validated.
The initial handoff left failures described below; its completion claim was too
broad. Repair source is committed as `549a92bda` on `0.9.8a`; the final full
regression completed with exit 0. This is source-runtime acceptance, not an App
installation or acceptance of the proposed cross-place observation enhancement.
This report distinguishes actual
Keeper play, read-only state verification and controlled regression tests.

## Delivered design

The versioned `enhanced-locations` Mod owns location enhancement, requires
`locations.v1`, and stores schema-1 places/features in the existing campaign Mod
state. Its initial package was version 1.0.1; the observation follow-up below
delivers 1.1.2. The kernel mints stable identities and uses
the existing transaction, admission, travel arithmetic, receipts and replay.
Fresh campaigns enable its default package. Existing campaigns retain their
lock and adopt/upgrade it through ordinary Mod configuration; the retained main
test exercised the 1.0.0-to-1.0.1 upgrade without editing saved state.

The separate `place` entry inspects or submits location work. Native `output`
and mixed-domain `apply` reach the same location effect and transaction handler.
An ordinary compatible destination can be defined and entered atomically. The
Keeper resolves open player meaning and improvises minimal public structure;
Jev provides bounded matching/context advice. Missing registration is an
argument/material correction, never a fictional wall. Actual barriers retain
their authority.

Places, nested places and local features remain different representations.
Hotels and rooms have stable scoped identity; desks/windows/corners can be
features and local positions without becoming scenes or carried items. Feature
state survives visits and restarts. Containment grants neither passage nor free
travel. Authored module data remains read-only.

A compact resident entry remains available. Answered input relevance or an
actual place operation discloses detailed grammar and Mod sections. An uncertain
or unavailable context selector discloses conservatively without granting action
authority. Quiet inputs retain the current position and entry. Only host-owned
request detail is omitted; raw evidence, provider continuations and reasoning
fields remain intact.

The final completion guard reuses the input's movement/feature selection and
accounts for typed operation classes in code. It does not repeat target/scope
admission. Only a selected missing dimension asks whether a real obstacle
accounts for that attempt. Time, registration or an NPC action alone cannot
substitute for a selected investigator movement or feature change.

Normative design: [location specification](../specs/location-system-and-tool.md),
[kernel RPC section 242](../kernel-rpc.md), and
[tickets #115–#120](../specs/location-system-tickets/README.md).
The [GPT-6 Pro discussion and primary-source research](../research/location-tool-pro-discussion-20261019.md)
are design evidence, not acceptance evidence. Useful precedents distinguish
world definition from residency, local interaction slots from whole scenes, and
containment from routes. This implementation does not copy a finite video-game
exit map or a room-template bank.

## Actual play and retained state

The sole root player used `tests/play/driver.ts` with `bin/pi-coc`, one natural
message per turn. Actual Keeper/author profile is MiniMax M3.1 Flash Preview with
medium reasoning. No synthetic player, fake Keeper, state-writing scenario
script, provider substitution or hand-edited campaign facts were used.

Private workspace: `.coc/test-workspaces/enhanced-locations-01a154d0`.
Main campaign: `locations-stress-20261019`. All raw successful and failed runs
remain under `.coc/playtests/enhanced-locations-live-20261019*`.

| Behavior | Actual evidence |
|---|---|
| Enter an unregistered ordinary hotel | `repair2` turn 1/global 5: canonical arrival, 30 travel minutes plus 2 activity minutes; no lodging payment |
| Enter a nested room | `repair10` turn 1/global 14: original hotel contains its independently registered third-floor room |
| Approach a local feature | `repair13` turn 1/global 20: committed position beside the iron bed |
| Visit another compatible public place | `repair13` turn 4/global 23: new cafe, then its window seat; no order/payment |
| Quiet action after arrival | `repair13` turn 6/global 25: seated Listen check and canonical time; all spatial applicability axes negative |
| New shop and local corner | `repair14` turns 1–2/global 27–28: bookshop and innermost aisle position |
| Look without walking | `repair14` turn 3/global 29: exact saved position unchanged after looking toward the shop window |
| Revisit and clear stale local pose | `repair14` turn 4/global 30: legacy cafe arrival clears the old window-seat position |
| Outdoor improvisation | `repair14` turn 5/global 31: new rear alley with observable doors, fire escape and other minimal references |
| Reuse hotel/room rather than regenerate | `repair14` turns 6–7/global 32–33: original front desk and room; no new place additions |
| Approach and open a window | `repair14` turns 8–9/global 34–35: saved window position, then a narrow opening of the back window |
| Remove duplicate completion veto | `repair15` turn 1/global 37: room-to-front-desk movement, completion `jev_calls:0`, ordinary admission retained |
| Restart continuity | Before/after restart native RPC: room definition, window state and front-desk position compare equal |
| Return to the saved window | `restart` turn 4/global 41: actual window-side position and prose describing the still-open narrow crack |
| Close the persistent window | `restart` turn 5/global 42: saved state now both windows closed, back latch still broken; no time duplicated |

A second campaign, `locations-cold-20261019`, was created through the canonical
pregen gateway in the same private workspace, with no copied campaign tree or
earlier correction history. Its actual `cold` run first observed the office and
asked about the commission, reached the authored `corbitt-house-ground` in turn
4, then created/entered `查尔斯街药房` in one output call in turn 5. Turn 6
committed the position beside its counter after a registered-reference correction.
Turn 8 returned to the authored house; turn 9 used the separate `place inspect`
and returned to the same pharmacy. Read-only comparison confirms its complete
definition/features equal the first visit (`live-cold-pharmacy-revisit.json`).
That return did not yet commit the requested counter refinement: only actual
place arrival counts. Turn 10 then genuinely committed the counter position;
`live-cold-counter-final.json` confirms it. The live transport was stopped
normally after this check; both private campaigns and every raw run remain.

Read-only verification is under `.coc/test-runs/enhanced-locations-20261019/`:
`live-before-restart-v4.json`, `live-after-restart-v4.json`,
`live-restart-completed.json`, `live-observation-position-comparison.json`,
`live-known-place-snapshot-before-revisit.json`, `live-cafe-return-readback.json`,
`live-window-open-readback.json` and `live-identity-continuity.json`.
The identity report compares current IDs with known early IDs/creation receipts;
compact historical turn snapshots do not contain full Mod state. RPC checks
provide the separate definition/state comparison. These inspections are not
additional played turns.

## Failures retained and boundaries

`repair9` room arrival and `repair10` turn 2 window approach are explicitly
invalid for acceptance: narration claimed actions without the corresponding
position/state receipts. They led to the missing-action and author-context
repairs; their original records were not rewritten.

Later failures exposed missing destination context in admission, native array/
boolean syntax envelopes, independent repairs being lost behind an unrelated
invalid parent, disclosure producers without consumers, and an excessive second
semantic movement veto. Repairs cover the system paths and retain canonical
validation and consent. Registration/time alone still cannot move the player.

The post-restart composite return failed on an unregistered feature spelling,
then an invalid NPC command. Both attempts rolled back. The next room arrival
committed, but its prose author received **MiniMax HTTP 504 Gateway Time-out**:
`.coc/expression-writes/ef4798cc-4f08-4c33-905e-dac734abc781/events.jsonl` in the
private workspace. The visible notice retained committed mechanics but its short
reason remained the less-specific `Direct prose generation did not complete`.
The following turn failed publication with `Expected a private composition
brief or reference answer`. Neither failed turn counts as a successful delivery.
Subsequent normal window approach and closure succeeded without state repair.
The upstream 504 is not quota exhaustion and did not authorize a model switch.

The fresh campaign also retained two failed deliveries. Turn 3 first supplied an
invalid item owner, corrected its transfer, and then encountered
`held_act_outcome`/`held_act_unconfirmed` at publication; seven committed receipts
were retained. Turn 7 produced no required native composition and failed with
`Expected a private composition brief or reference answer`. Its saved counter
position stayed unchanged (`live-cold-failed-look-position.json`), which proves
failure isolation, not a successfully played observation. Neither failure is
counted as location exploration success. The initial checkpoint deferred the
publication failures; the owner-requested follow-up below repairs those paths.

These observations do not establish that all compound player actions or model
tool arguments are reliable. They do establish the new place path, same-record
revisits, local-pose distinction and persisted consequences in actual play.
The follow-up repairs bounded author/provider failure reporting and native
publication; it does not redesign unrelated NPC behavior.
The kernel enforces a declared `through:{place,feature}` against persistent
passability; the Keeper still supplies the semantically appropriate route and
boundary binding. V1 does not infer complete physical geometry from prose.

## Initial checkpoint regression and context measurements

The initial quick gate is 130/130; TypeScript kernel checking passes. Location
units are 27/27, native correction components 2/2, read-only/write RPC regression
9/9 and cancellation guards 2/2. Historical migration originals remain unchanged.
That LAN snapshot's complete native-output file passes all 55 tests,
including both six-result pressure variants.

The six-result pressure fixture now captures the actual native call/results
rather than the projection's custom supplements. It retains six complete
26,000-character results, 500 expanded handles and the same 393,216-byte total
ceiling. Only capsule padding is recalibrated for added mandatory location
grammar. The expanded case must actually consolidate its obsolete capsule;
content equality and pair safety remain enforced. Production allocation and the
ceiling were not increased to pass it.

Second completed full LAN snapshot `run.bQ24V6XP` at `4756e31cd`: extension
6243 total / 6232 pass / 2 fail / 9 skipped; integration 2237/2237; routing 12/12;
overall exit 1, 1160 seconds. Its failures were the pressure fixture and the
pre-existing unused `turn_unfinished_notice` caption. Raw full-run exit codes are retained, including earlier
deliberately interrupted runs; an interruption is not a pass.
The unrelated caption's starting-point proof is
`.coc/test-runs/enhanced-locations-20261019/baseline-unused-caption.txt`; neither
its English source nor the exact-key guard changed at that checkpoint. The
owner-requested follow-up removes the unused key without weakening the guard.

Initial handoff's complete LAN snapshot **`run.sq9sNUff`**, source
`5d6a1a3082bff2d9911b31be954c8878fd00e4e4`, wall 1162 seconds:

| Phase | Result |
|---|---|
| Extension, 707 files | 6243 total / 6233 pass / 1 pre-existing failure / 9 skipped; exit 1 |
| Native TypeScript integration | 2237 pass / 0 fail; exit 0 |
| Routing loop | 12/12; exit 0 |
| Overall runner | Exit 1, solely the unchanged caption-key failure |

That snapshot had no new regression failures, but still had a real failing gate.
Local retained summary is
`.coc/test-runs/enhanced-locations-20261019/final3-lan-all.log`. The complete
remote archive is `/home/leehow/leehow/code/wt/codex-tests/.pytest-runs/chatrpgv4-wt-pi-coc-v2/run.sq9sNUff/`.
The native run metadata and JUnit XML are also retained locally as
`final3-integration-run.json` and `final3-integration-results.xml`. The real run
exit is zero and XML has no failure/error nodes; Node's 2237 pass summary comprises
2236 leaf testcase elements and one parent suite. The archived source SHA-256
manifest matches the local location accounting, context, extension gateway and
kernel handler sources. The full-run source diff is empty.

Observed host projection on the retained main run: spatial `system_bytes`
137143 versus quiet 126926 (a 10217-byte difference). This is a host projection
measurement, not HTTP payload/token accounting, cache-hit proof or a latency/
cost reduction claim. A small per-input applicability call remains a real cost.

`live-all-profile-audit.json` reads actual post-start assistant message metadata
for the Keeper, final author and NPC tasks. Every observed tuple is
`minimax-cn/MiniMax-M3.1-Flash-Preview` / `medium`. The two failed provider
messages are the initial missing-provider setup and the retained author 504;
neither is quota exhaustion. These are message counts, not played-turn counts.
Initial private workspace plus raw-run logical storage is 70,270,739 bytes
(approximately 67 MiB), below the admitted 512 MiB bound (`storage-final.json`).
No retained evidence was deleted.

## Initial source-only delivery boundary

All implementation commits are local. No push, App packaging/installation,
deployment, formal-campaign mutation, branch/worktree deletion or evidence GC
was performed. The installed App has not been used to claim this source change's
acceptance. The versioned Mod and source runtime are the delivered implementation.
The six linked issues remain open pending publication; their local implementation
and validation states are recorded in the ticket index. The initial checkpoint
above left known failures. Its completion claim is superseded by the owner
failure follow-up below.


## Owner failure follow-up (locally validated)

The first handoff overstated completion. The owner asked for the failures to be
fixed. The original records remain unchanged.

- Direct author: an actual upstream HTTP 504 was wrapped as a generic completion error. The provider status and bounded cause now survive through the native publication boundary into the readable notice, alongside canonical settlement status. Component verification covers failure before prose and after a partial stream without a second author request. The upstream service itself is outside this repair.
- Corrected handover: an invalid owner reference followed by a successful transfer still poisoned publication. A complete atomic apply unknown-entity refusal can now project as an uncommitted failed attempt beside actual receipts; unknown execution/partial transport still cannot. The real native component transfers one item and completes publication. The original hold is not blanket-cleared.
- Native output: raw text_delta/text_end and private_reply proved complete M3 XML output frames were present; the post-filter thinking-only view was misleading. Both captured frames now restore exact arguments through the ordinary native boundary. Registration and text restoration now consume the same version-4 output schema. The actual product request test falsifies contradictory inherited compose/public instructions.
- Fresh follow-up observation, global turn 11: the model returned a bare complete v4 decision twice. This remains a failed live turn. A whole closed v4 envelope is now restored only when the offered output schema itself declares v4. Existing legacy/setup bare arguments, reference prose and unknown versions retain their prior behavior. Exact raw bodies, XML boundary/string protections and native publication are covered; no force-tool strategy, model switch or semantic interpretation is introduced.
- Unused caption: remove the unused generic unfinished key from the English source and the cached seed, leaving the exact-key test unchanged. A genuinely missing native output now reports that specific publication failure.

Current gates: fast 130/130, kernel TypeScript checking passed, native decision
file `turn-packet-prototype.test.mjs` 50/50, native handover recovery 5/5,
direct-author/held/notice focused group 97/97
before the additional native diagnostics, final diagnostic boundary 7/7,
text-call file 31/31 and exact wire/whole-packet cases 6/6. These are
deterministic/component evidence, not live play. The preliminary full run
`run.Nytvt0M5` was interrupted with exit 143 after a fresh real turn exposed the
bare-packet form; it is retained and is not a passing regression.

### Real continuation after the repairs

`enhanced-locations-followup-cold2-20261019` completed nine natural inputs on the
same cold campaign, with no unfinished delivery. The subsequent normal restart
run completed one further conversation. The initial failed follow-up global turn
11 remains failed; later success does not rewrite it.

| Behavior | Actual follow-up evidence |
|---|---|
| Repeat the previously failed observation without moving | Global 12 restores the exact whole v4 packet through the native boundary, publishes a real author response and preserves the pharmacy counter position |
| Show the existing address note | Globals 13–14 produce a normal response and committed document show/observe receipts; this is not a physical ownership transfer |
| Return to authored surroundings | Global 15 arrives at the existing Corbitt exterior |
| Establish and enter another inn | Global 16 commits `旅馆大堂`, its front desk and the position at that desk |
| Enter its unregistered child room | Global 17 commits `旅馆大堂 / 二楼空客房`, its parent and actual arrival |
| Approach a window without opening it | Global 18 corrects an omitted move in the same turn, commits the window-side pose and retains only the original three-minute activity receipt |
| Revisit the original pharmacy | Global 19 uses the separate place entry; definition/features compare equal and the counter-side pose is committed |
| Ask an OOC location question | Global 20 uses zero tools; canonical position and clock remain unchanged |
| Restart normally and resume conversation | Before/after startup position and clock compare equal; the next natural input delivers a normal response in the same pharmacy |

The corrected unknown-owner/valid-owner **physical transfer** is proved by the
real native component, not by the live note-showing turns. The OOC prose contains
a model-authored trailing reference marker; this cosmetic observation remains
outside F1–F4. These runs do not establish cross-place observation of an ongoing
street event.

Actual assistant metadata, rather than requested defaults, confirms Keeper,
sole author and NPC tasks all used MiniMax M3.1 Flash Preview / medium. No
provider error or quota exhaustion occurred in the successful follow-up runs.
Evidence is retained in `followup-live-summary.json`,
`followup-observation-telemetry.json`, `followup-spatial-receipts.json`,
`followup-local-window-correction.json`, `followup-pharmacy-revisit.json`,
`followup-after-reference.json`, `followup-after-restart.json` and
`followup-profile-audit.json` under the task's existing test-run directory.
All owned live driver processes were stopped normally. Combined private workspace
and raw live evidence totals 82,903,235 logical bytes, below the admitted 512 MiB
bound (`followup-final-capacity.json`); no evidence was deleted.

### Final follow-up regression

Full LAN `all` completed as **`run.8UX5Qp0X`**, source
`549a92bdad780c56dde8eafe92de7a5ecdc6aec6`, wall 1171 seconds:

| Phase | Result |
|---|---|
| Extension, 707 files | 6256 total / 6247 pass / 0 fail / 9 skipped; exit 0 |
| Native TypeScript integration | 2237 pass / 0 fail; exit 0 |
| Routing loop | 12 pass / 0 fail; exit 0 |
| Overall runner | Exit 0 |

Actual archived phase exits and native runner metadata all report zero. JUnit
contains 2236 leaf testcase elements, zero failure/error elements and one parent
suite, matching Node's 2237 pass count. The mirrored source overlay contains only
the two progress-report documents. All eight changed production/caption source
hashes match both the built runtime used by the real continuation and the full
test source. No production code changed after that snapshot.

The complete remote archive is
`/home/leehow/leehow/code/wt/codex-tests/.pytest-runs/chatrpgv4-wt-pi-coc-v2/run.8UX5Qp0X/`.
Local summary is `followup-lan-all2.log`; the actual exit files, native run
metadata, JUnit, source head/diff/manifest and per-file exit accounting are
retained in `followup-lan-final/`, including `verification.json`. The upstream
provider can still fail; the repaired contract reports its actual known cause
and preserves committed settlement instead of promising availability.

## Observation follow-up and canonical App acceptance

### Delivered extension

Mod 1.1.2 retains state version 1 and the additive locations schema. Its named
v1/v2 observation capabilities add directed, sense-specific relations, bounded
observations at exact target points, canonical observed clocks and stable named
situations. Containment alone grants neither passage nor sight/hearing. The
Keeper authors compatible public surroundings and progress; the kernel owns
identity, clocks, transactions, receipts, rollback and replay. There is no generic
offstage simulator or fixed elapsed-time event table.

The host derives an observation's source from the actual party position. The
optional target `at` never doubles as the observer's position. Ordinary `view`
authoring creates the matching sensory relation without making the Keeper copy
the source point. Remote newcomers use ordinary canonical NPC creation and retain
their identity at the target; viewing them does not place them in the room or
give the final author their private actor dossier.

`place` remains separate from general apply context. Detailed location grammar
and Mod sections are disclosed on relevant requests; the resident native schema
contains a compact entry. All complete writes reach the existing atomic handler.
Native explicit waiting now forwards the existing minutes path, and observation
consent retains the proposed execution order without changing either consent
threshold or adding a veto axis. The sole author receives committed findings and
is explicitly asked to render the selected look/listen result.

Normative details: location specification and kernel RPC section 243. The source
changes include `e666b2eea`, `f8fbac6a4`, `f6944e6cf`, `1940cbd74`, `e9f046173`,
`5b30dad0f`, `e44ebaf88` and the final history read-through `28c4a5df5`. The
final package includes independently committed mainline work through that
freeze, including scalar-transport repair `e92ab7601`. Subsequent concurrent
uncommitted dialogue changes are excluded from this release and remain owned
by their separate task.

The final read seam projects up to four delivered observations of the exact
target point and sense, with their original viewpoints, canonical public people
and observed clocks. Unpublished settlement never becomes player knowledge.
An actual focused read reaches the sole author for this input only, bounded to
two target/sense groups; it grants no remote actor card or fresh perception.
The existing answered location-context decision may prepare one unambiguous
current route through the normal bounded discovery read and packing budget.
Quiet, unavailable and ambiguous decisions do not automatically fetch history.
This adds neither a semantic classifier nor an observation/time effect.

### Actual Keeper decisions

The main agent supplied one natural player input per real RPC turn. The final
author and supporting live lanes used MiniMax M3.1 Flash Preview / medium. No
scripted player, synthetic Keeper, staged argument or hand-edited campaign was
used as play evidence. The retained workspace is
`.coc/test-workspaces/enhanced-locations-01a154d0`.

| Actual decision | Evidence and interpretation |
|---|---|
| Pharmacy doorway to street | Source global turn 25 establishes the real approach and observes an ordinary street, binding the new newspaper seller once as npc_13. |
| Tea-shop window overlooking the street | Installed-runtime global turn 27 enters the tea shop and observes that same npc_13 remotely, without moving him into the room. |
| Explicit waiting | Source turn 31 commits five minutes, from game minute 217 to 222, before the observation. Both consent lines pass; the author receives the committed facts. Its omission of those facts is preserved as failed narrative acceptance. |
| Later delivery progress | Package `e44ebaf88`, global turn 32, advances to minute 227 and actually narrates the same seller's progress outside the window. |
| Closing the window | Global turn 34 commits the window's closed state and retains the party at the window seat. |
| Looking through closed glass | Global turn 35 observes the same seller again at minute 233, narrating his route past the shops while glass remains closed. This is real sight continuity, not a completed separate hearing observation. |
| Refer to previous observations | Source global turn 40 identifies the same canonical person from four delivered records at minutes 217, 222, 227 and 233. The next quiet input uses no tools or history preparation. Clock, position, features and observations stay unchanged. |
| Repeat the reference through the final installed runtime | Release global turn 42 correctly identifies the same recorded person using those four observations. The sole author is MiniMax M3.1/medium; the only issued tool is output, with no settlement or new perception. |

Raw runs are `enhanced-locations-observation-live3-20261019`,
`enhanced-locations-observation-packaged2-20261019`,
`enhanced-locations-observation-ordered-20261019` and
`enhanced-locations-observation-packaged4-20261019` under `.coc/playtests/`.
History evidence is `enhanced-locations-observation-reference3-20261019` and
`enhanced-locations-observation-release-20261019`, with
`reference3-audit.json` and `release-reference-audit.json` in the audit directory.
Audits, failed attempts and package records are under
`.coc/test-runs/enhanced-locations-observations-20261019/`.

Failures remain evidence: an unresolved invented source point; an empty-parent
shape; an unconfirmed purchase correctly refused; an unissued communication
reference; repeated native commands with kind move plus place-only fields; and
the former uncertain observation consent. None is silently rewritten as success.
The failed compound close/look/listen retained its settled Listen failure but
did not close the window. Normal subsequent player choices closed it and then
looked through it successfully. The final prose includes a brief uncommitted
leaving-the-window phrase; canonical position remains the window seat. Model
protocol mistakes and small prose continuity errors remain possible.

Earlier history questions also remain failed: general recall lacked observation
identity, a focused read initially exposed only the latest record, and another
author received no actual history read. The repair connects delivered-history
projection, demand preparation and current-input author consumption. Their
incorrect answers are not rewritten or counted as passing reference turns.

Named incident phase/participant retention, separate hearing, blocked views,
elapsed arithmetic, failed publication, rollback/replay and privacy have direct
TS/component/RPC coverage. A controlled argument fixture is structural evidence;
this follow-up did not observe a naturally occurring live argument and does not
claim that exact live case.

### Native App and provenance

The one real bundle is `/Applications/PipiCOC.app`, with the build-directory
backlink pointing to it. The installed receipt identifies `28c4a5df5`, Mod 1.1.2,
arm64 and the stable PipiUI Dev certificate. Strict signing verification passes;
all five packaging runs remove their own staging directories. Cached local
runtime/Electron archives supplied packaging; no large Internet payload batch
was started.

Native UI acceptance uses a private product profile,
`Pipi/pipicoc-observation-acceptance-20261019`, and the retained test workspace.
With the running executable and private profile verified, PID 60929 prepares a
new built-in scenario through the actual UI. Its campaign is
`game-9824efe0-ad75-4197-8f22-3cbf5d51b40d`. The Mod panel shows Enhanced Locations
1.1.2 enabled in this campaign and retains that state after refresh. The actual
session JSONL records MiniMax M3.1 and medium. After normal quit and a new PID
75881, the same session, 10:00 clock, Mod and model return correctly. No player
fictional action was submitted through this UI setup check; actual fictional
acceptance remains the canonical driver method above.

The final release was then cold-launched as PID 26063 through that same private
profile. It restored the test session, its 10:00 clock, MiniMax M3.1/medium and
enabled Mod 1.1.2. Refresh completed through the real UI and the App quit
normally. `app-release-cold.png`, `app-release-cold-ax.txt` and
`app-release-audit.json` identify this final package separately from earlier
candidates. No fictional turn is claimed from the GUI setup campaign.

`app-private-mod112.png`, `app-private-cold.png`, their AX captures and
`app-private-audit.json` are the valid native evidence. Initial restored-window
captures had ambiguous process/profile provenance and are explicitly
invalid-for-acceptance; they remain retained. Nonblocking optional-provider
registration warnings in the private profile are retained in `app-process.log`;
this acceptance validates MiniMax, not those other providers.

The final installed kernel, host and table JavaScript bytes match the frozen
amax full-test snapshot exactly (`amax-compiled-parity.json`). All 660 tracked
source blobs and three immutable Mod files checked against the final receipt
commit match (`installed-source-audit-5.json`). Its only test-source overlay was
this progress report, not production code. The earlier
`lan-compiled-parity.json` belongs to an earlier candidate and is not attributed
to the final history repair.

`final-app-hygiene-5.json` verifies the real canonical bundle, stable certificate
leaf, deep strict signature, build-directory backlink, sole LaunchServices and
Spotlight root registration, all five removed staging directories and unchanged
installed runtime hashes. An initial audit invocation used an invalid inline
requirement specification; its error log is retained beside the corrected
verification, with no package mutation.

### Final validation gates

Typecheck, quick 130/130, ordered admission/concurrency/language 44/44 and author
components 68/68 pass. Earlier native-interface, privacy, explicit-wait and
transaction suites are retained with their actual outcomes. Final RPC
`run.lpByYTUr` passes 21/21. The complete earlier full run `run.vLk4T0ZP`, source
`e9f046173`, passes extension 6272 total / 6263 pass / 9 skipped, integration
2243/2243 and routing 12/12, overall exit 0 (1179 seconds).

The final full run `run.mWDp0tBc` and installed-runtime read-only continuation
were superseded by the frozen release validation. The leehow-pc host became
unreachable during collection of `run.mWDp0tBc`; its overall result remains
indeterminate. Only this task's stale local SSH client and wrappers were later
terminated; this does not establish a remote exit code. The interrupted obsolete
run `run.YMEnuGyf` remains exit 143, never a green run.

Final source `28c4a5df5`, amax **`run.Js73wt6w`**, wall 1153 seconds:

| Phase | Actual result |
|---|---|
| Extension, 710 files at 32-file concurrency | 6277 total / 6266 pass / 0 assertion failures / 2 cancelled at the existing 15-second limit / 9 skipped; exit 1 |
| Native TypeScript integration | 2243/2243; runner exit 0, JUnit 2242 leaf cases plus the parent, zero failures/errors |
| Routing loop | 12/12; exit 0 |
| Original overall runner | Exit 1; unchanged raw result |
| Same-source serial retry | memory-native-recovery.test.mjs 5/5 and parallel-reads.test.mjs 8/8; both exit 0, no cancellation |

The two first-run cancellations were the legacy native-recovery and overlapping
native-read cases. Serial retries used the same frozen production source and
compiled hashes, the same tests and their unchanged 15-second bounds. They
establish recovery at lower concurrency, not proof of the precise original
timeout cause or a passing original full-run exit. All other passing cases
remain from the complete run; no timeout/baseline was weakened to turn it green.

Local phase exits, runner metadata, JUnit, source overlay and retry logs are in
`lan-release-final/`, including `verification.json`. The retained remote archive
is `/home/lihao/chatrpgv4-testbox/wt/codex-tests/.pytest-runs/chatrpgv4-wt-pi-coc-v2/run.Js73wt6w/`.
Additional final checks pass: kernel typecheck, quick 130/130, interface/language
10/10, request pressure 2/2, the new native history/privacy/input-expiry component
and the actual-RPC delivered-history/bound/restart case. These controlled tests
remain distinct from the installed real play above.

`final-capacity-2.json` records a complete retained-tree logical-byte upper bound
of about 71.4 MiB, counting each path and including the reused seed, below the
admitted 512 MiB bound, with more than 125 GiB free at measurement. No campaign,
raw play evidence or shared object was removed. All task-owned live drivers and
GUI processes were stopped normally.
Implementation and acceptance documentation are committed locally; no push is
requested. Natural live argument/hearing acceptance and reliable arbitrary model
compound arguments remain outside the evidence established here.
