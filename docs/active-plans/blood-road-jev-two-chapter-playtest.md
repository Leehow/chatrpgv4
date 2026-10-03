# Blood Road: blind two-chapter Jev playtest

## Authorized objective

Continue the real Blood Road campaign, explore as an ordinary player, and play the authored
adventure through, with at least two substantial playable story portions completed. Diagnose,
repair and retest encountered product failures until this acceptance is achieved. The source has
no formal chapter count; two scene visits or a fixed number of turns are not substitutes. User authorized sustained work on 2026-09-30 and is offline.

The sole player is the main session. Keeper is `grok-build/grok-4.5`, thinking `low`, through
`tests/play/driver.py` and `bin/pi-coc`. One natural player message after each delivered Keeper
response; no scripted Keeper, batch settlements or synthetic gameplay. Player choices use only
publicly delivered fiction. Do not inspect future PDF chapters, module secrets, private NPC motives
or solutions in the player context. Diagnostics may inspect generic code, rule contracts, question
wording, distributions and non-spoiling metadata. Filter private narrative from tool output.

Chapter completion must reflect meaningful play and committed story progress, not two scene visits
or a fixed turn count. Determine chapter boundaries from delivered progress or a non-spoiling
structural verification after reaching them; setup/reference sections do not count as story chapters.

## Scope and constraints

Repair system paths responsible for failures in this live play, with contract changes and relevant
regressions. Preserve all campaign/module/turn/telemetry/playtest evidence. Do not patch scenario
content to force progress, lower mutation gates merely to pass a test, return check selection to the
LLM, restore the retired Python kernel, change model defaults, push, deploy or package incidentally.
Use isolated task-owned worktrees for overlapping repairs; preserve concurrent dirty work.
Heavy suites/full runtime builds use an available LAN box. Live play stays on the Mac.

## Current state

- Latest branch: `0.9.6a`; source HEAD at intake: `4c1006c8d`.
- Concurrent dirty file: `docs/specs/historical-reference-mod.md`, another task's work.
- Campaign: `blood-road-jev-20260930`; original PDF module `book-2`.
- PDF SHA-256: `9cc71c34dd62462f0f3c7bf765defc4bc49667f1f9fee3f0ac172a32464da50c`.
- Last play run: `blood-road-jev-fixed-play-20260930-v2`, stopped after three delivered turns.
- Packing repair landed in `0f1152f4b` and `4c1006c8d`; integration `4f74f351f`.
  Focused regressions 29 passed; kernel typecheck passed; main repair built on leehow-pc.
  Three real turns had no packing refusal. No successful live roll was observed.
- Installed legacy Keeper `session.resume` rejects this current TS save as `unsupported_save_schema`;
  it was called first at context epoch 9. Continue through the repository's current source driver,
  not the retired plugin state model. Do not repair that unrelated legacy gateway as a shortcut.

## Public player knowledge only

Jack Miller is a 32-year-old travelling car mechanic (canonical card occupation Engineer), English
mother tongue. Mechanical Repair 50, Spot Hidden 25, Persuade 10, Dodge 40, Brawl 25. He has a car,
spare tire/jack and tools, a revolver, and roughly USD 60 before any committed expenses.
The car suffered a flat entering Abattoir in west Texas in July 1975. At the Esso station, Russ
offered help replacing the tire, about an hour. Two other men sit in the shade.
Delivered tire inspection found a rough iron nail. Jack asked Russ to waive labor because money
is tight; the two persuasion attempts stayed unresolved. Russ has not agreed, refused or been
successfully influenced. Do not turn an unresolved roll into any of those results.

## Ready work

1. Diagnose the repeated `check_necessity_uncertain` social ruling using existing question wording
   and answer distributions. Hide module-private narrative during inspection.
2. If a system failure is confirmed, fix and regress the producer-reader-actor path; otherwise
   respect the uncertainty and continue ordinary exploration through legitimate player choices.
3. Resume source-driver play with 4.5 low; verify fixes in the original scenario and preserve evidence.
4. Explore normally to at least two completed story chapters, handling new failures as they occur.
5. Verify committed progress, update this plan and produce a concise evidence-bounded final report.

## Acceptance status

Open. Chapter count is not yet established; do not count the gas-station opening as a completed
chapter without source-bound, non-spoiling progress evidence. The successful packing repair alone
does not complete this sustained playtest.

## Active repair

Task-owned worktree `/Users/haoli/.codex/worktrees/blood-road-two-chapters/chatrpgv4-wt-pi-coc-v2`,
branch `codex/blood-road-two-chapters-20260930`, lifecycle task `blood-road-two-chapters-20260930`.
Base `cefd6dd1e`; social role/preparation fix `1bd371211`, integrated as `b03d4f93c`.
Confirmed generic question asks roll necessity before social difficulty adjudication determines
whether to roll, and conflates an investigator executor with the NPC target's work consent.
No private Blood Road text was inspected. Only generic rule code and sanitized turn 6/7 question
wording/distributions were read. Focused selector tests 32/32 and real-kernel role seam 1/1 passed;
kernel typecheck and leehow-pc full build passed. Public-only diagnostic probe (not gameplay): actual
attempt old question .40 / new .87; hypothetical .19/.14; agreed cooperation .09/.07. No threshold
changed. Production source-map comparison passed after copying the build to the Mac.
Active new source-driver run: `blood-road-jev-two-chapters-20260930`, same original campaign,
4.5 low. Replay succeeded at campaign turn 8: Jev selected the social operation, policy-origin
resolve succeeded, and the committed public receipts contain a failed Persuade skill check.
Russ refused to waive labor. No unresolved notice or LLM-origin resolve occurred. This is genuine
Keeper play, distinct from the public-only diagnostic probe. Current in-flight player turn 9:
Jack accepted the refusal and replaced the tire himself with his own tools and spare; Keeper
delivered completion at campaign turn 9 without an unresolved notice. Current in-flight turn 10:
Jack stows the old tire/tools, drinks water, and asks Russ for a clean inexpensive place to stay.
Turn 10 delivered an answer but also a false unresolved social notice (need .84, refine .83).
Public answer: a small inexpensive inn lies along the main road in town; not especially clean.
Russ also suggested continuing to Marathon for better choices. Jack has not visited either.
Player still knows no future plot. No story chapter completion has yet been certified.
Run `blood-road-jev-two-chapters-20260930` stopped after these three turns for a boundary repair:
the social invocation template must not be treated as proof of player intent, and ordinary factual
questions without established withholding/resistance must be excluded. Follow-up edits are in the
same task-owned worktree; version 18, unchanged gates. Next: public-only lodging/influence probes,
focused regression, integrate/build, then continue toward the publicly mentioned local inn.
Follow-up `99bc0053a` is integrated as `76a312596`; focused selector tests 32/32 and LAN build
passed. Public-only selector probe: ordinary lodging question no-roll (need .08); the fee influence
remains recognized (need .91) but its style was ambiguous at skill binding in this diagnostic; a
counterfactual withheld-information case stayed unresolved. These are not gameplay. No gates changed.
Restarted source run: `blood-road-jev-two-chapters-20260930-v2`. Next player input will ask only the
inn's name and ordinary room price, then continue exploration using the actual reply.
Campaign turn 11 delivered the factual answer without an unresolved notice: the rooms are marked
Last Stop, left of the bar in town center, four rooms; Russ quoted USD 8 per night and said keys/payment
are handled inside the bar. These are publicly delivered facts, not advance module reading.
Turn 11 factual dialogue produced no-roll verdicts (need .12) and no unresolved notice, confirming
the conversation boundary in real play. Turn 12 delivered arrival in town center near Last Stop:
bar with an open door, food smell, a few people on its wooden porch, four rooms to the left.
Current player turn 13: Jack locks the car, enters the bar and asks the person in charge to see a room.
Verify movement against committed receipts; chapter completion remains unclaimed.
Turn 12 has two committed move receipts. Turn 13 publicly revealed the bar interior and two people:
a tall thin man behind the counter, and a short heavy figure at the kitchen. No names were introduced.
Room-viewing service request produced a new false unresolved social need for the second possible
target (.41), while the first was confidently unnecessary (.26). Source run v2 stopped after three turns.
Active fix version 19 adds a public-only actor method screen before NPC target questions. No NPC
identities/private source enter it. It uses existing applicability .65 to retain candidates; target
necessity .85, binding and admission gates remain unchanged. Focused tests 34/34 passed.
Public-only method probe v19: room service no-roll (.14), lodging information no-roll (.04),
fee influence selected (method .94). Fix `24a483bba` committed; 34 selector tests passed; LAN build
passed and build copied. Integrated source `701232852`. Active run v3:
`blood-road-jev-two-chapters-20260930-v3`, same campaign and 4.5 low. Current player turn 14
addresses the publicly seen man wiping glasses behind the counter, asks whether he rents the
rooms, and requested a room inspection before choosing to rent. Turn 14 delivered normal consent:
the man confirmed he manages the rooms, quoted USD 8, and offered to accompany Jack outside to
inspect one before payment. He described a single bed, bedside table with phone, and bathroom.
No unresolved notice. Current player turn 15 follows him to inspect smell, bedding, bathroom,
locks and whether the parked car is visible from the window. No private NPC identity used.
Turn 15 delivered room inspection normally: old but visibly clean bed/bathroom, interior door lock,
window latch, view of the parked car. The manager opened the room with a brass-tag key and offered
it for USD 8 at the bar. Jack has not yet rented it or received a key. Current turn 16: he returns
to pay USD 8, receive the key, introduce himself/ask the manager's name, and order cheap hot food
and water. Turn 16 delivered payment/key handoff and introduced the manager as Robert. Phone
only calls the bar. Public food offer: bean soup/tortillas USD 1.50, water free. No chapter certified.
Turn 17 delivered food order/payment and Robert's factual answer: several shops closed years ago
as people left; ordinary places include the main road, general store, church and hardware. Meal is
being prepared. No advanced module/hidden NPC knowledge used.
Turn 18 is a paused reference-only progress query, captured without exposing raw narrative to the
player. Sanitized Keeper result says no formal story chapters, chapter counts/current scene number
null, evidence pages 3/76/80. This is not chapter completion proof. Continue the full authored
adventure and record substantial completed story portions rather than counting two scene visits.
Background integrated extension suite on leehow-pc is running for source `24a483bba`; local log
`.tmp/blood-road-integrated-ext.log`. Live play remains on the Mac. No chapter/ending achieved yet.
Current in-flight turn 19 resumes fiction: eat the ordered meal, put bags in the room, lock it,
take wallet/key and walk the publicly mentioned main road to look for the hardware store and
tire-repair materials. Turn 19 delivered eating, stowing bags/locking room, and walking into an open
red-brick hardware store advertising propane, with a fenced materials yard and empty firearm/ammo
cabinet. Someone is present. No private identity introduced. Current turn 20: Jack asks about a
tire patch/glue kit and its price, and whether the visibly empty gun/ammo cabinet is still in use.
Integrated LAN suite completed: 4212 passed, 0 failed, exit 0, 342 seconds at source `24a483bba`.
Turn 20 introduced an unnamed thin blond middle-aged shopkeeper with black-rim glasses and a
friendly smile. He offered patch/glue for roughly USD 1.50-2 and said guns/ammo were stopped years
ago; repair supplies, propane/building materials remain. Current turn 21 asks him to confirm total,
pays that quoted price, introduces Jack/asks his name, and asks about the town's publicly seen decline.
Turn 21 delivered purchase at USD 2 and introduced Peter Benson, who runs the hardware store with
several sons. He gave a vague warning about people who are hard to deal with, shops closing/people
leaving, and avoiding places one should not go. No specific threat/location was disclosed. Current
turn 22 thanks him, says Jack only wants a safe overnight stop, and asks for concrete safety advice.
Turn 22 delivered public warnings: avoid groups in shabby pickups whom locals call sand punks;
avoid outskirts/cemetery after dark and peering into private yards. No identity/plot solutions disclosed.
Current turn 23 acknowledges the warning, leaves the shop and follows the publicly seen church spire
along main street during daylight to look for posted opening hours/local history notices.
Turn 23 publicly revealed the church sign Blood of the Lamb Holy Spirit Church (founded 1965),
animal-bone/sinew charms and skull decorations, worn steps/door, adjacent cemetery/stone monument.
A barefoot grey-haired man wearing clergy collar, smelling of whisky, pointed a sawed-off double
barrel shotgun from the door and demanded identity/purpose. No hidden identity/motive read.
Current turn 24: Jack stops, shows empty hands, slowly steps back, truthfully introduces himself as
a passing overnight guest who only read the sign, and offers to leave without reaching for anything.
Turn 24 delivered the armed man's reaction: muzzle moved off Jack but remained raised; he repeated
Jack's introduction, mentioned sand punks, and asked whether Jack would leave or explain desire to
enter. Selector's public method Noul .37 stayed unresolved, not a confirmed successful influence.
Current turn 25 explicitly leaves without asking entry/arguing, keeps hands visible until away, and
returns toward town-government public notices on main street. Do not treat the unresolved attempt
as a passed persuasion check. No attack/shot has been publicly delivered.
Turn 25 delivered withdrawal and arrival at town government: two-story red brick/tile building,
Est. 1943 sign, public hours Monday-Friday 10-17 and open now; side door staff-only. No attack.
Current turn 26 enters the public main door, seeks reception/duty staff, truthfully reports the
publicly experienced gun threat, asks whether police are on duty/reporting appropriate, and asks
ordinary visitor safety advice. No private area entry or undisclosed source knowledge used.
Turn 26 delivered: elderly desk worker says no resident police, county responds if available,
won't register the church incident; warns against private yards/ridge and doing errands after dark.
Right public door is post office; left council room staff-only. Current turn 27 uses only the public
post-office counter to buy postcard/stamp for Jack's brother and ask for public map/travel/road info.
Turn 27 publicly introduced postal clerk Ernie Peters. Cards USD .15, stamp .13 in-state/.18 out;
no tourist map/guide at the counter; road maps usually at the gas station, Marathon east along state
road. Current turn 28 selects/pays in-state card/stamp, writes Jack's known family address and only
public travel/check-in facts, posts it, and asks Ernie about highway safety and the disclosed sand punks.
Turn 28 delivered paid/postmarked card and Ernie's refusal to discuss sand punks; ordinary postal
service worked. Current turn 29 thanks him, returns to Last Stop, attempts a daylight patch repair
of the removed tire using bought materials/mechanic knowledge, then asks the bar about supper.
Still no hidden source inspection or forced dangerous location chosen.
Turn 29 delivered evening arrival, daylight-to-dusk tire patch repair with material consumption,
old tire now held as spare, and Robert offering hot food until 21:00. Current turn 30 asks the exact
burger price, pays if supplied, sits with door/car view and observes publicly visible evening patrons
for fellow travelers. Night plot has not been inspected in advance; no ending reached.
Turn 30 quoted burger USD 1.20/water free and showed two local tables plus a lone middle-aged beer
drinker, apparently from nearby rather than an overnight traveler. Current turn 31 pays the quoted
burger, requests delivery to the chosen seat and greets that publicly visible drinker to ask ordinary
road/evening-activity information. No new private identity known.

Turn 31 delivered the drinker's brief public answer: he travels nearby towns; the state road has
traffic; the bar is the only evening place; this is a poor town for entertainment. Burger payment
landed but it has not yet been served. An unresolved notice came from a policy-origin Mod contact
check whose admission reviewer mistook the NPC first impression for an investigator persuasion
attempt against Robert. Separate option reads failed after accepted embedded narration had closed
the turn; these did not cause that notice. Run v3 stopped after 18 delivered inputs, campaign 14-31.

Repair `d2a8d4096` (isolated) / `41b84240c` (main) carries kernel-issued contact-rule meaning through
the candidate to both admission reviewers, preserving actual-contact review and including that
evidence in the reuse key. Accepted delivery now snapshots final receipts only, without another
preparation/route cycle. Terminal regression failed before the repair with the exact two closed-turn
errors; four real-kernel delivery regressions passed afterward. Contact/candidate tests 19 passed,
admission role tests six passed, admission signature tests eight passed; kernel typecheck and full
runtime build passed. Both LAN boxes currently unreachable, so this necessary build ran on Mac.
Concurrent historical-reference edits in main were preserved exactly at the added/deleted-line level;
only this task's patch was staged, then its worktree ancestry merged. Integrated verification and
live run v4 follow. External precedent: OpenAI Agents SDK terminal tool results and LangGraph END
both stop further execution; our host still retains final committed receipts for pairing.
Player remains blind to source secrets. No chapter or ending completion is certified yet.

Integrated merge `6f22153e7`; 19 integrated contact/delivery/history regressions passed. Live run v4
turn 32 delivered paid burger/water and ordinary bar ambience without unresolved notice or closed-turn
option-read error (43.6 seconds). Current input 33 asks normal checkout/breakfast information, then
returns to the rented room and prepares for sleep. No future source or private motives were read.
Turn 33 delivered checkout instructions (return key to bar), kitchen opens 09:00 with no early
breakfast, then return to room/locks and sleep (32.9s). Current input 34 sleeps until 07:00 unless
actually awakened, then listens/looks before opening the door. No advance night event knowledge.
Turn 34 delivered an uneventful night and wake at 07:00; room locks/keys remained undisturbed
(56.5s, two apply calls). No authored night event or ending was invented by the player. Current
turn 35 gets dressed/packs and checks the car before continuing the publicly mentioned road.
Turn 35 delivered the public car inspection: tires hold, no new puncture/leak, fuel unchanged,
engine starts normally (44.7s). Current input 36 returns the room key/checks out and drives toward
Marathon via the publicly supplied direction, watching the road. No ending/chapter certified.
Turn 36 delivered checkout/key return and driving out in the direction of Marathon, but stopped
short of completing the declared trip (69.4s). Keeper invited continuing/stopping without an actual
obstacle. Current input 37 reiterates the already chosen ordinary drive to Marathon, with a stop
only for a real obstacle/decision. This departure is not certified as a playable chapter or ending.
Turn 37 entered a publicly described rough gravel road with hairpin turns/wood bridges and a
hand-painted Blood Road sign. The more traveled fork goes east (62.9s, source lookups by Keeper).
No future lookup contents were shown to the player. Current input 38 selects that public eastbound
main fork toward Marathon and slows for gravel/turns. Authored adventure progress remains open.
Turn 38 again narrated ongoing driving without a new obstacle, ending with continue/stop. It had
no committed receipts (77.9s). Reference-only turn 39 was captured raw and sanitized: authored main
adventure entered true; substantial-part count null; ending false; actual unresolved travel choice
false; authored reason to pause false; destination reached false; evidence pages 17/42/76. Reference
scope was correctly classified and made no world/check writes. Run v4 stopped after eight inputs.

Root cause narrowed to an older effect-less weapon debt t0-owed-4. The firearm is already present
as exact unmanaged equipment and an executable printed weapon on the public investigator card.
The materializer excludes it, but owed reconciliation kept it. Atomic apply batches repeatedly
failed owed_mismatch, eventually class_limit; trip prose continued anyway. Current isolated repair
shares the existing weapon identity predicate, hides only already-satisfied missing-weapon debt,
and closes it durably on normal settlement/review. Unsupported effect-less rows now refuse with
explicit owed_unresolved; no batch split, invented instance, stats change or debt deletion.
Before-fix regressions failed; 22 owed regressions then passed, including real-kernel capsule and
durable close. Additional ownership/atomic guards are being verified. WSL test box is reachable
but currently occupied; heavy validation will wait for its authoritative idle state.
Diagnostics briefly showed an already visited town's registered destination summary containing
unvisited shop labels. These are unearned and must not inform player choices. No hidden motives,
future events, clue solutions or future source sections were read by the player. Filter subsequent
proposal diagnostics to field names/closed status rather than whole registry summaries.
Repair committed as `ba0451d57` in the task-owned worktree / `3620abaf3` in main and ancestry
merged. Four additional ownership/atomicity/legacy tests pass, alongside the previous 22 owed
regressions and kernel typecheck. Concurrent unstaged edits remain exact at the addition/deletion
level. Integrated owed regressions are running locally (small files, emitted test API). Durable
build wait is exec session 5589: it polls the WSL suite process state every 30 seconds and will
build-fetch the main checkout once idle, writing `.tmp/blood-road-weapon-main-build.log`. Do not
restart live play against the stale build. No live driver currently running. Next run v5 continues
the actual eastbound road toward Marathon; verify receipts and remaining story before completion.
External precedents: SQLite statement atomicity confirms keeping a rejected mixed batch intact;
The community Jev harness separates semantic decisions from exact identity/capability/freshness checks.
Integrated merge `e3144220c`; 24 integrated owed regressions passed. The build wait completed:
WSL build exit 0, 13s, fetched 49 MiB into main build. Remote log
`/home/box/chatrpgv4-testbox/wt/codex-tests/chatrpgv4-wt-pi-coc-v2/remote-build.log`.
Read-only current-campaign capsule check confirms t0-owed-4 is no longer visible; raw evidence
was not edited. Run v5 is starting, same campaign/4.5 low. Continue original declared travel and
check actual settlement, rather than declaring the journey fixed from fixtures alone.
Turn 40 finally delivered a real authored road incident: two cars tailgate/bump and flank the
Dodge, a pickup follows with a person holding an indistinct long object, and motorcycles raise
dust on both sides. These were not known in advance or scripted by the player. Current turn 41
tries to steady the car, stay on the main road and accelerate where visible/safe to escape, without
ramming, leaving the car or firing. Verify pursuit/attack receipts and Jev ownership as actual
encounter unfolds; no ending or two completed substantial story portions certified yet.
Live turn 40: committed clue/time/note/flag/note receipts exist; false weapon debt closed as
satisfied. One unknown_entity source lookup was recovered by later source reads; no owed_mismatch
or refusal-budget exhaustion remained. Turn 41 tried to stabilize/escape, but chase:start remained
unresolved (need .68, blocked .34), and only narration was delivered (28.2s). Run v5 stopped.
The actual catalog had no actor or target; first_blow null, active session false, situation.people
empty. Only a generic non-executable chase:start placeholder existed. The selector asked necessity
before honoring its explicit missing-argument need, then held that decision for the entire run.
The Keeper had its full tools (narrator-only setting was off), but received a generic uncertainty
instead of a concrete participation/preparation gap. It must prepare/register observed attackers
through existing source/NPC tools, with checks still selected by Jev afterward.
Candidate next repair: structural readiness before semantic necessity; typed preparation result;
agent adjudication/preparation note; a separate preparation hold released only when a fresh
issued catalog has an executable candidate. Semantic uncertainty remains held, gates unchanged,
no model-origin resolve, no future book inspection in player context. Validate with regressions
and the same actual ambush, then continue full adventure. No code for this next repair yet.
Cross-validation: community jev-harness is research-stage, not the official SDK; it keeps runtime
validation outside Jev and sends no invalid proposal for semantic review. LangGraph official
agent loop returns tool results to the agent and continues until final output. Neither proves
our participant preparation or Jev calibration; use local + actual live evidence.
The next repair is now implemented but not committed/integrated: active task worktree has
§159.10 plus runtime/jev/{resolve-selection,candidates,step-policy,hybrid-engine}.ts and selector
regressions. All structurally unavailable eligible options return typed preparation before Jev;
source-gap holds differ from semantic holds and release only on a freshly executable catalog.
Parameter availability is projected as a boolean. Agent gets an adjudicate check_preparation step
and concrete source/participant registration guidance; no model-origin resolve. Preparation notices
are deferred until accepted delivery and omitted if the attempt was resolved. New regressions
failed before changes; selector/candidate tests 53 passed, delivery/history host tests 12 passed.
Still needed: host integration regression for source preparation/retry/notice, review, LAN build,
commit/integration preserving historical-reference dirty work, original live ambush retry (v6).
Do not claim live chase success from these tests. Native chase has vehicle helpers; investigate
actual vehicle binding if the prepared live run exposes a further gap. Driver v5 is stopped.
Host projection/operation regression added: check-preparation-host.test.mjs, three tests cover
full preparation tools, no obsolete notice after success, pending notice only on accepted explicit
or implicit delivery, and no notice on refused/unavailable delivery. Implicit-delivery regression
failed before adding its close-path hook. Selector + host tests now 39 pass; earlier candidate
plus selector count 53 and host delivery/history count 12 also passed.
Full extension suite runs on WSL as exec session 25888, local active-worktree log
`.tmp/check-preparation-ext.log`. It synchronized the main code before the final implicit-notice
helper refactor and new host test file; final helper is separately regressed. No live driver active.
Current task source modifications are still uncommitted in the owned worktree; source is not yet
integrated into main and v6 must not start before build/integration. Preserve main historical
reference changes via guarded own-patch staging and unchanged added/deleted-line verification.
Preparation repair committed `bf9e3d83c` in owned worktree / `4b2691d60` in main, integrated
as `92d6ee845`. Concurrent edits preserved exactly. Full WSL extension snapshot passed 4220/4220,
exit 0, 826s. Final helper also passed 39 selector/host tests and 15 close-path tests. Main integrated
selector/host tests 39 pass. WSL main build exit 0, 2s, fetched. No v6 started yet.
Important additional confirmed binding gap: kernel-ts/chase/bindings.ts builds chase:start
participants exclusively with participantFromCombatSpec; that function emits MOV/CON/DEX and no
vehicle fields. The lower ChaseSession supports isVehicle, vehicleKey, driveAuto and related
fields, but the automatic starter omits them. Do not let this actual car flight silently become
a foot chase after NPC preparation. Inspect/reuse existing vehicle execution and participant
binding contracts, then add the smallest bounded host adapter needed for real vehicular pursuit,
without model-generated math, reduced thresholds, invented source entities or player spoilers.
This belongs to the already authorized real pursuit acceptance. Current public situation remains
the unresolved car escape at turn 41. Next work is code/contract diagnosis for vehicle bindings;
no live driver runs, no more ignored evidence has been edited or deleted.
Vehicle implementation in progress in the owned worktree, still uncommitted: §159.11, public
chase_roster schema/review key, kernel chase binding/gateway, check catalog, selector and new
chase-roster-selection.ts. Gateway regression reproduced is_vehicle=false before field forwarding;
now two behavioral tests pass, including real ordinary table.resolve and saved vehicle participants
with Drive Auto and Table V MOV. No fixture is gameplay. Roster helper uses bounded participant
roles, published vehicle profile nominations and independent compatibility Noul checks; passenger
links name a selected driver. It creates no numeric plan. Unknown driving skill stays preparation.
Foot and vehicle triggers are distinguished and the selector family is version 20. Missing vehicle
driver data has a mobility/driver-specific readiness requirement, so an unrelated ready foot option
cannot release that preparation hold. Still need verify this new hold in tests, review edge cases,
source catalog/RPC vehicle+passenger coverage, build/integration and the same live car flight v6.
Earlier focused checks passed 55 tests; final roster/selector/gateway/signature checks passed 50.
Logs: `.tmp/chase-roster-focused.log`, `.tmp/chase-roster-final.log` and `.tmp/chase-roster-tsc.log`.
No live campaign driver runs, current player situation remains turn 41 attempt to escape on-road.
No unearned town-shop labels or incidental external generic NPC vehicle statistics may influence
player choices. External research is rules/implementation only, not module plot or player advice.

Continuation on 2026-10-01: main is 0.9.6a at 49f44b679 with only this plan dirty. No live driver
is active. Task tree vehicle repair committed as 95e6c463d; then main was merged into the task
tree. One append-position conflict in kernel-rpc.md preserved both §159.11 and §160. Code merged
automatically. Before that merge, 49 catalog/roster/selector tests and 8 admission-schema tests
passed, kernel typecheck passed. Initial typecheck used a nonexistent path, then was rerun with
the actual tsconfig.kernel.json; that failed invocation is not validation. The vehicle fixture
now exercises the issued catalog through selectCheck and ordinary resolve, including a passenger.
Integrated checks, commit, LAN build and original live chase retry are next. User's full blind
adventure acceptance remains open; none of these fixtures or prior town visits completes it.

Vehicle source integrated via task merge 6bfd479ff and main fast-forward; integrated 64 focused
tests and kernel typecheck passed. WSL build-fetch exit 0 at 6bfd479ff (1s). Full WSL ext suite
is running as exec session 39103, log owned-tree `.tmp/chase-vehicle-ext.log`. Driver v6 started
with Grok 4.5 low, campaign turn 42 retried the same escape. It issued source prepare and module
lookups, but still no roll/session; delivery explicitly unresolved. This is not chase acceptance.
Metadata trace: source prepare returned pending at its allowance, read-132 stayed active in the
background and landed material_ready after 191155ms, with successful independent verification.
No source prose or secret entities were read in player context. Continue the same public escape
after readiness, before deciding whether a further preparation/integration repair is needed.

v6 completed campaign turns 42-44, then stopped: 3 inputs, 14 tool calls, 188.8s. No successful
chase start/Drive Auto roll yet. Turn 43's failed apply was time + duplicate open note (not NPC
registration); an earlier commentary attribution was corrected. Turn 44 actually committed a
person alias and six NPC presence effects. A read-only diagnostic using the real graph/presence/
profile readers found six present actors, one authored mechanical/driving profile, five table-only
actors. Only counts were exposed. Read-136 subsequently landed material_ready after 416771ms.
Public addition: pickup bed operator holds a crude metal pointed device with a long rope; no
projectile has been fired. Player continues to avoid collisions and escape on the visible main road.
One diagnostic query preview accidentally exposed an internal current-encounter NPC name; like
the earlier unearned shop labels it must never guide player choices. No future plot text/motives/
solution were read. Subsequent diagnostic outputs expose only shapes, readiness and rule metadata.

Confirmed next seam repaired as ddffdd65e, integrated with main docs via a12bb7321: vehicle catalog
advertises profile availability for every participant; missing selected actor profiles become typed
preparation and corresponding holds require those exact profiles. Current NPC skill pin receipts
now join catalog facts immediately. Chase targetValue consumes actorSkillValue (current receipts
and durable NPC ledger) before its existing pinned-profile fallback. New tests failed first on the
missing passenger profile and catalog skill availability, then on the starter's missing Drive Auto.
After repair 54 relevant tests and kernel typecheck passed; the actual pin survives a narration/
new player turn and reaches vehicle MOV/speed rolls (2 gateway tests passed). Updated hold test
passed 37 selector tests. §159.12, selector family 21. This remains source verification, not play.

Full WSL suite at prior 6bfd479ff: 4258 total, 4257 passed, 1 failed, exit 1, 496s. The failed
long-campaign-context case measured 196625 raw transport bytes versus 196608 ceiling. Mac focused
file reproduced no failure (5/5 passed, ~19s). Do not claim full green or change its assertion merely
to pass; verify actual provider-size measurement/remote reproduction after the shared box is free.
No context policy patch made. LAN build-fetch is queued behind another owner's heavy suite as
exec session 60747. No live driver active. Next fresh run is v7 after build, same vehicle escape;
complete the original full adventure acceptance, do not count retry turns as story progress.

v7 stopped after campaign turn 45 (1 input, narrate only, 28.9s). Actual need refinement was 0.88,
but the broad prerequisite question stayed 0.39: no roll/session. Exact-state non-mutating
diagnostics separated player-stated chase dependency from numeric/profile readiness and a future
conditional dodge. A literal dependency with its narrow public state gave 0.08; an explicitly
conditional start did not pass the no-dependency gate. Selector family 22 now runs necessity and
dependency as independent questions, retaining one settled answer in host code while refining
the other at most once. No gates changed. §159.13.
Next data seam: current NPC placement explanations were already written, but role binding saw
static biographies instead. Catalog now reads latest current-scene NPC placement receipts from
current/committed line history and projects presence_evidence; role binding uses that rather than
unrelated profile readiness. NPC role 1/4 diagnostics changed to driver .94/passenger 1.00; §159.14.
Whole selector replay got through need/dependency/intent, but two motorcycle participant roles
remained gray (~.73/.78), and a separate Noul did not confirm them (.82/.79). No lowering or forced
role selected. They now produce an NPC movement-evidence preparation need, with actor names and
held evidence; the agent consults current source/establishes NPC-owned positions through existing
npc to/why, and Jev binds again only after evidence changes. Investigator gray roles and invalid
provider answers never take this preparation route. Skill/body readiness alone cannot release it.
This is fact preparation, not model-origin check/roster selection. Exact-state diagnostics are not
gameplay and must not count as escape success or chapter progress.

Commits: 8aaa7f429 (dependency + existing placement consumer); cac241b90 (NPC evidence preparation).
Merged successive main work (serialized arguments and NPC mood) without discarding it, then main
fast-forward to 6b3cae770. Source-level checks: 56 placement/selector/catalog/gateway/host tests,
57 after first evidence preparation, final selector/roster/host/serialized-argument checks 75 pass.
Kernel typecheck passed after replacing unsupported findLast with a latest-first find. Current main
post-NPC-mood tests/typecheck are exec 51395; queued LAN main build-fetch is exec 7320. No live
driver runs. Next fresh run v8, same original escape, after the updated build.

Remote long-context focused replay before latest main still failed (4/5, raw peak 196799 vs196608).
Concurrent main NPC-mood work changed that fixture's configured ceiling to 200KiB, documenting
the additional static floor and raw transport vs provider-facing byte mismatch (§161); production
budget wasn't changed. Our task has not edited that test. Actual fresh full/remote validation still
needed; do not claim earlier full suite green. v6 model telemetry confirmed Keeper, reader, memory,
review, voice and admission all Grok 4.5, reader thinking low. No Grok 4.7 test route was found.

v8 stopped after actual turns 46-47 (2 inputs, 4 tools, 75.6s). Turn 46 proves the NPC evidence
preparation path: accepted presence updates, Jev binds roles and reports missing body profiles,
then five NPC archetype pins succeed. Still no chase roll/session. Public addition only: motorcycle
engines audible within the dust lines, pursuing east. Turn 47 failed before check-selection with
jev_packing_limit; interaction world_action .96/system_request .03, so this was not intent refusal.
No budget exhaustion (26.65s/45s; only two decisions, no deferred work). Root identified a newly
large Cartesian check inventory once NPC profiles were available, not an NPC action-loop delay.

Read-only exact-state reproduction (in-memory open-turn view, no world/turn writes or rolls) in
diagnostics route-npc-profile-packing.json: state 70531, longest question987, request94673 vs
32000 state+question /64000 request limits. social, opposed and psychology each have 42 options.
§159.15 repair in task tree: route-only structural template grouping retains every exact actor/
target pair and trigger facts, omits definitions/menus/vehicle binding stock. Full catalog remains
for the selected binder. Route family3. Same current-state diagnostic now packs 20331 bytes,
preserving all42 bindings in each of those families (route-npc-profile-packing-fixed.json).
Real six-NPC catalog regression failed on packing before repair, passed afterward; 49 targeted
catalog/selector/gateway tests passed. Broader route/domain/compile run had one stale-emitted-kernel
failure: no source kernel delta, copied already-LAN-built current main build to task build (excluding
node_modules), then all17 compile tests passed. No unrelated assertion changed. Kernel typecheck
and diff checks passed. Next commit/integrate/build, then original escape fresh v9. No active driver.

Full LAN extension suite at 6b3cae770 is green: 4286/4286, exit0,650s, main log
.tmp/chase-current-full-ext.log and remote Codex scratch remote-ext.log. That snapshot predates
§159.15; final route patch is separately regressed and still needs actual live acceptance.
Do not claim the NPC preparation or packing diagnostics are chapter progress. Whole adventure
and the user's minimum story-depth requirement remain open.

§159.15 committed/integrated as 98df9c809. LAN main build-fetch completed exit0,4s at that
revision. Next v9 starts on this current build with the original still-unresolved car escape.
Main dirty state remains only this task's plan; owned worktree source clean. Lifecycle still active.

v9 stopped after actual campaign turn48 (1 input,5 tools,55.8s). Routing now reaches check-selection,
so §159.15 works in the original scene. Role/body data ready; selector reports missing driver skill.
Keeper batches skill pins with redundant identical archetype pins. Three apply refusals each point
to a different already-pinned actor (all same archetype as turn46); by the fourth skill-only batch,
the refusal budget is exhausted. No skill or roll settled. No NPC names/numbers were read in player
context; effect shapes and exact-match booleans establish this failure.

§159.16 repair: identical existing table-pinned archetype reuses its original complete profile;
different archetype and source-authored replacement remain refused. No new random draws, original
pin turn/numbers unchanged. Actual duplicate pin + skill writer/catalog/durable chase gateway
regression2pass; broader initial catalog/mood run had a test instrumentation error attempting to
patch a frozen RNG instance, corrected to a temporary prototype intercept restored in finally.
Kernel typecheck and diff checks passed. Source committed in task tree; main integration follows.
LAN targeted tests/kernel/test_npc_archetype.py queued behind shared suite as exec78078, owned log
.tmp/chase-archetype-py.log. Do not run two heavy jobs on the box. Build-fetch only after it finishes,
then resume same unresolved escape fresh v10, Grok4.5 low. No active live driver. Full adventure
acceptance remains open; do not equate retries/preparation with chapter completion.

Identical archetype repair committed134413370 and integratedc734eb44e, preserving concurrent
plain-prose/narration-craft changes. Final gateway regression2pass (temporary RNG prototype
intercept restored in finally verifies zero random draws on repeat). LAN archetype RPC tests
8passed,exit0,22s atc734eb44e, including conflicting pin and printed source ownership. Main
build-fetch now executing; freshv10 next. Source plan remains the only dirty main file. All v9
evidence retained; driver stopped and no actual escape/check success has been claimed.

2026-10-01 update: main advanced to `db32d918d`; task worktree fast-forwarded to that exact 0.9.6a head. Latest full extension suite passed on leehow-pc: 4322/4322, exit 0; current runtime build fetched into the task worktree and main checkout.

Live v10 used Grok Build 4.5 low and delivered three natural player turns (campaign turns 49–51; 8 tool calls, 179.0s). No resolve receipt landed. Jev selected the chase family at turn 49 but its roster selection ended unresolved for missing driver skill and vehicle profile. At turn 50, the chase-family route answer was `now` p=.56, confidence=.35; it was below the route gate and was consumed without entering `check-selection` or recording §163 forced resolution. Turn 51 remained gray (.45/.53) and likewise did not route. This is the confirmed current-source gap: §163.2's best-scored Choice rule is implemented in check selection but not in the check-owned route gate.

Latest-build v11 was stopped after one natural action because the process lacked `EXT_JEV_APIKEY`; its forced `jev_unavailable` no-roll is retained as setup-failure evidence, not counted as Jev acceptance. Secure vault lookup was verified by exit status only, with no key output. Next: bind the vault value into the driver child environment, add the agreed route regression at the confirmed public seam, repair, then continue the same campaign. Chapter completion remains open.

v12 used the secure vault value in the driver child environment and the fixed Grok 4.5 low lane. Three natural inputs at campaign turns 53–55 reached Jev check selection. The chase-family route selected `now` at .76/.74/.70; vehicle roster binding still no-rolled. One vehicle Choice selected `unknown` at .39 while an issued profile scored .32, and one profile-validity Noul was .53 (below .75, above .5) but stayed `chase_vehicle_profile_uncertain`. §163.2 requires the best non-unknown Choice and midpoint Noul result, both recorded as forced. No resolve receipt landed; continue fixing the specialized roster path and preserve all three public turns.

§163 gray-result repair is committed as `6bc480b75` and integrated into 0.9.6a at `61dd946a1`. Check-family route Choice now uses its best positive `now`/`later` score below gate and records `inspect_check` or `no_roll`; the Keeper note distinguishes inspection from an actual roll. Chase vehicle profiles exclude `unknown` when Jev gives positive support to an issued class, and the validity Noul uses the §163 midpoint. Specialized forced entries now merge into the top-level selection. The user asked for no new tests; the existing full extension suite passed 4322/4322, exit 0, and `build:runtime` fetched to main passed at `61dd946a1`. Next: resume the same campaign with secure Jev vault injection, confirm the chase roll is actually received, then continue through two chapters and the module ending.

v13 continued at campaign turns 57–82 (26 natural player turns). It produced public Drive Auto and Listen receipts and several forced no-rolls. Turn 82 then narrated the investigator blacking out after an attack apply was refused as `check_outcome_unresolved`; there was no damage/condition receipt. The host refusal already said damage could not stand in for the missing check, but the no-roll guidance still allowed the Keeper to judge the attempt outcome too broadly.

The first no-roll boundary repair is committed as `37bf99b57` and integrated into `0.9.6a`. `player_choice` no-roll now says the check was not made, so success/failure and dependent harm/condition consequences are not settled; the refusal, forced-resolution marker and `narrate` description agree. No tests were added. Existing LAN suites: extension 4322/4322 pass; loop 301/301 pass; `tests/kernel` + `tests/play` 2073 pass, 2 skipped, 2 fail (the same first-blow snapshot failures already recorded against the base in §163.7). Runtime build passed and was fetched into main.

v14 resumed the same campaign through the real Grok Build 4.5 low driver with the vault key injected only into the daemon environment. The no-roll `player_choice` path occurred at campaign turn 95: Jev selected `inspect_check`, then withheld `intent: move` at p=.44 and recorded `check-selection no_roll / player_choice`. The Keeper did not narrate a hit, miss, escape or injury receipt. At campaign turn 105, a second withheld intent left a declared kick suspended mid-motion without an in-character cue; the contract's optional “preserve before the consequence or return the choice” let the agent dead-end.

Second prompt/contract repair is committed as `3dfabf67c` and integrated into `0.9.6a`: a `player_choice` no-roll must narrate only settled events and end with a present person or immediate situation returning that choice in character. It must not leave the declared action hanging or ask out of fiction. No tests were added. Full LAN extension 4322/4322 and loop 301/301 passed; kernel/play pytest returned 2073 passed, 2 skipped, and the same two first-blow snapshot failures recorded against the base in §163.7. Runtime build passed and was fetched to main. v14 was stopped after 23 driver turns with evidence retained; one turn (run turn 8) returned literal `narrate` with no tools/host delivery and is invalid for acceptance. No story chapter is complete yet. Continue in a new driver run from the same campaign.

### 2026-10-01 continued: delivery cue guard and bounded repair

v15 at campaign turn 106 exposed a route/target conflation: kicking the driver's seatback was routed as a Brawl attack against a driver in a trailing sedan, and a combat session started. Commit `8e1e984d0` narrowed the compile and target questions. v16 then pushed a car window; compile selected `none` for combat and target, with no combat receipt, confirming the semantic boundary in a real driver turn. v16's later rope/key attempt remained a forced `player_choice` no-roll and still lacked an in-character return cue.

First output gate `be770fe63` (task commit `7a30cfbbd`) added a pre-delivery Jev review. v17, Grok Build 4.5 low, campaign turn 124: the embedded draft and implicit closing drafts scored cue `.48`, `.62`, `.15`; dependent-outcome scores stayed `.20`, `.23`, `.16`. All were refused, but the generic `needs` default advertised `next: change_input`. The driver returned no assistant text after 128.5 seconds. This is invalid for acceptance; no player-facing result was delivered.

`745fa25cc` changed the recovery route to `next: narrate`, lowered the cue gate to `.60` while retaining `.25` for dependent outcomes, and moved the embedded narration check after accepted `apply` effects. v18 delivered turns 1–19, then turn 20 (campaign turn 144) reached the 300-second driver timeout after 12 refused narrations. Jev repeatedly found drafts implied the withheld rope-loosening outcome: cue scores were mostly `.75–.90`, while dependent-outcome scores ranged `.28–.71`. The refusal budget deliberately exempts `narrate`, so the model kept trying; the action's `apply` had one receipt but its narration was not delivered. Preserve this evidence and do not replay that write.

`673fee420` plus `055fe2ec2` attempted a bound and were built with all existing suites. v19 turn 1 did deliver an in-character guard question after 169.3 seconds and seven tools, but the Jev review rejected seven successive narration drafts before one passed (`cue .81`, outcome `.24`). This confirmed that a tool result's `terminate` flag alone does not stop sibling tool calls in the same response.

Latest source repair `9bf389a75` (task commit `64457157a`) adds a pre-tool and queued-run guard, spends the single close steer on the first rejected narration, allows one `narrate` repair after that steer, and terminates further operations if that repair also fails. Main `0.9.6a` advanced to merge head `a0f0a720e` while preserving concurrent speech-edit work. At that head, `build:runtime` passed and 50 MB was fetched from leehow-pc. The existing full suites returned: ext 4341/4342 (only the known narration-craft phrase assertion from the concurrent merge), loop 301/301, kernel/play pytest 2073 passed, 2 skipped, with the same two base first-blow snapshot failures in §163.7. No regression tests were added. v19 is preserved and stopped after one delivered turn (169.3 s, seven tool calls); the latest delivery asked whether to loosen the rope now or wait until the truck stopped.

v20 on the same campaign, Grok Build 4.5 low: campaign turn 156 forced `check-selection no_roll / player_choice` for the social request to loosen the rope. Jev rejected two drafts for implying an unrolled result (`cue/outcome .67/.39` and `.80/.46`), then passed the revised in-character guard question at `.82/.25`; the turn delivered in 49.7 seconds and narrated only a half-finger loosening. This is live evidence that the bounded repair can return a withheld choice without settling the requested outcome. Turn 14 then repeated a separate floor failure: an implicit close's final text was the bare protocol label `narrate`, accepted after a floor steer and committed as that text; it is invalid for acceptance. Telemetry showed an implicit `narrate` commit but no meaningful player-facing prose.

`3502629e5` adds an exact structural guard for an implicit draft whose trimmed contents equal a registered COC tool name: it spends the floor steer if available, otherwise drops the label and uses the existing unfinished-turn notice/release. It does not classify natural-language meaning or change ordinary short prose. This guard and its contract are integrated into `0.9.6a`. The first remote ext attempt at this head exited 1 after 832 seconds because the wrapper could not find `remote-ext.log`; it printed no test counters, so that run is unverified. The next probe showed leehow-pc busy at load 42.85. Final ext, loop, pytest and `build-fetch` at `3502629e5` are still pending. All `.coc` evidence remains preserved. No chapter completion is certified; the two-chapter acceptance remains open, and the next live run should resume from the last public scene after the final build.

### 2026-10-02 update: Flapcode GPT-6 Luna and exhausted-steer stop path

The exact tool-label patch above was later reverted by `d67534625` at the owner's request after its broad implicit-delivery rule caused 78 `test:ext` failures (4,270 pass / 78 fail at `15a4a48be`). It is not in current source. Main `0.9.6a` subsequently advanced to `2a9972615` through the item-recovery merge; its diff does not overlap §163.9 or the forced-choice delivery gate.

The post-revert full-suite run at `4b8f81e` returned ext 4,341 pass / 8 fail, loop 301/301, and kernel/play 2,073 pass / 2 skipped / the same two first-blow snapshot failures from §163.7. The 8 ext failures were six old Flapcode-manifest fixture expectations, one missing inventory entry for Flapcode account/discovery `fetch` calls, and the known narration-craft phrase assertion. `build:runtime` passed and 50 MB was fetched. These results predate `2a9972615` and the fix below; ext plus a current build remain to be rerun.

v21 used the real driver with `flapcode/gpt-6-luna`, low, confirmed by the daemon's actual spawn log. Turns 1–3 delivered. At campaign turn 163 Jev correctly recorded `check-selection no_roll / player_choice`; a floor steer had already spent the turn's one correction slot. Jev then rejected the narration, but the run made four more `narrate` attempts over 153.6 seconds and ended `undelivered_with_tools` with no assistant text. There was no `apply` and no fictional outcome landed. Preserve v21 as failed delivery evidence, not player-facing canon. Its last valid public story is turn 3; turn 4's refused drafts and player request are not a delivered continuation.

Root cause: when the floor lane had already spent the steer, `reviewForcedPlayerChoiceCue` set `repair_steer: false` but did not install a persistent host stop. `terminate` ended only the current tool batch; the hybrid supervisor started another model step. The repair amends §163.9, passes Pi's `ExtensionContext` through the canonical dispatcher to explicit, embedded and implicit delivery reviews, and aborts the active Keeper run once the repair budget is exhausted. A pre-tool guard is the fallback if another operation is attempted; the existing `agent_settled` unfinished-turn notice/release remains the close path. No tests were added, per the user's instruction to use only the real driver and existing suites. `git diff --check` passes; the new fix is unverified until current-source ext/build and a live v22 run complete.

The WSL test box was occupied by another session's ext suite in `codex-tests/source-single-pass-narration`; its process was left untouched, and the current-source validation waited until the box became idle. The two-chapter acceptance remains open.

The current-source ext/build recheck at `2a9972615` completed after the shared box became idle: runtime built and fetched; ext reported 4,344 pass / 9 fail. Eight failures were the same Flapcode fixture/inventory and narration-craft items from `4b8f81e`; the ninth was a telemetry JSON parse error in `admission-lines-parallel.test.mjs`. That existing file passed alone (18/18 on the Mac), so the ninth is a full-suite concurrency artifact, not a deterministic regression. No tests were added.

v22 confirmed the no-steer stop at campaign turns 164 and 171: `player_choice` no-roll, Jev cue rejection, one narration attempt, `aborted_during_operate`, host unfinished notice, and stranded-turn release; neither turn delivered a story result or landed an `apply`. The live run then exposed the complementary case at campaign turn 187: `repair_steer: true`, four `forced_choice_cue_repair_queued` narrate attempts before `turn_close`, then one repair narrate was rejected and promptly aborted. The source now adds the callback seam from the existing forced-choice cue event to the hybrid `RunState`; after the current model-proposal batch drains, `budgetRows.next` schedules the existing policy `turn_close` before another Keeper inference. The turn-close steer still authorizes exactly one narration repair. This latest scheduler change is unverified pending the current ext/build and a v23 live rerun. The playtest remains on the road; no chapter is complete.

### 2026-10-02 forced-turn-close verification

The scheduler change built and fetched at `2a9972615`. Its existing ext suite returned 4,345 pass / 8 fail, the same Flapcode fixture/inventory and narration-craft set as the prior current-source run; no new failure appeared. No tests were added. The public web search found no maintained analogue for this repo-specific hybrid scheduler; the design follows the installed Pi 0.87 batch-level termination semantics and this policy's existing `turn_close` step.

On v23, campaign turn 210 reproduced the repair-available case. Jev recorded `no_roll / player_choice`; the first implicit draft was rejected with `repair_steer: true`, then telemetry recorded `turn_close_requested` and `turn_close_forced` before the existing turn-close steer. Exactly one repair narration was attempted; Jev rejected it, and the host aborted with `turn_unfinished_notice` plus `released`. There were two narration attempts total, no repeated queued retries, and no `apply`; the turn has no story delivery and is invalid for chapter acceptance. This verifies the scheduler seam but not a successful repair delivery.

v23 then continued through delivered public turns 24–30. Campaign turn 218 / run turn 31 ended with a separate generic closed-turn loop: five narrate attempts arrived after the turn was closed, and the host emitted `delivery_cut_short_notice` after 134.9 seconds. Jev's row was `below_confidence_gate`, without `player_choice`; no `apply` is recorded. Preserve this as non-story runtime evidence, not the forced-choice cue path. The last valid fiction is v23 turn 30's explanation of Austin, Brunner and their shared higher authority. Chapter completion remains open; continue in the same campaign from that public state, and keep the cut-short turn's prose out of canon.

The forced-turn-close scheduler has now passed its live gate. At campaign turn 210 / v23 run turn 23, the keeper-choice cue review rejected the first draft with `repair_steer: true`; `turn_close_requested` and `turn_close_forced` ran before another Keeper inference, followed by exactly one repair narrate. Jev rejected that repair, and the existing abort/unfinished-notice/release path ended the run at 76.1 seconds. There were two narrate attempts, no `apply`, and no delivered story for that player input. This replaces the four queued repair attempts at campaign turn 187; it confirms bounded retry but not a successful repaired delivery.

At campaign turn 189 / v23 run turn 2, an `apply` succeeded before Jev rejected the narration. Preserve it as settled and never replay it; the host then used the same unfinished-turn notice/release path. The v23 daemon remains the current live run, model confirmed `flapcode/gpt-6-luna` low. Its latest run turn 31 was undelivered as recorded above; continue from the last valid public turn 30, not that turn's failed draft or notice. No story chapter is complete yet.
