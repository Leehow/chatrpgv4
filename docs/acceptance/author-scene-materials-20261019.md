# Author scenery, characterization and dialogue continuity

## Result and boundary

Implementation through `771fe8c622975ff40e0cdf76b0f3250478789c2b` is committed on
`0.9.8a`, built and installed in the canonical stable-signed App. Material wiring
is repaired. Actual MiniMax prose regains concrete scenery and expressive actions;
the final App dialogue also answers a causal question using the earlier exchange.
This is not evidence that naturalness is universally restored or that latency fell.
The matched driver comparison is 56.694s before versus 57.585s after, with an
additional thinking-only KP completion in the latter. No new judgment model,
prompt reminder, author rewrite or inference lane was introduced. The author
instruction is byte-identical to the baseline.

The current production design remains a structured KP packet, canonical execution,
then one prose author generating direct SSE. Current state owns the scene;
historical public material remains attributed context or explicitly selected
supplemental material, never an automatic transaction or current pose.

## Producer, reader and actor repairs

- The existing in-flight first-sight view now reaches `decisionScene`; previously
  it was computed and logged but discarded at this boundary. Current explicit
  `properties.description` also survives after first-sight retirement through
  `public_scene.description`. General summaries are not promoted into that public
  projection. Already-issued first-sight material retains its existing contract.
- Character projection reads the actual `personality.description`, variation,
  mood, directed relationships, reunion metadata and current activity. It omits
  expired activity, private dossiers and unselected knowledge. Existing style
  configuration reaches the author as data, without changing its instructions.
- The last two exchanges retain only attributed words of supplied participants.
  A participant's latest committed own public exchange supplies a bounded fallback
  across an intervening visit elsewhere. Current public names replace old source
  names; ambiguous public names do not acquire another identity. Old rendered
  arrivals and poses are excluded. Speech is emitted once, not duplicated on the
  characterization card. The combined dialogue window is at most four groups.
- Same-place historical prose is available as a low-priority selectable narration
  reference. It cannot grant an NPC knowledge or displace higher-priority catalog
  items.
- Capacity regression exposed by the additions: a complete native result batch
  fit after capsule consolidation, but an omission diagnostic then consumed its
  remaining space and caused all six answers to be dropped. The optional notice
  now yields to those answers; required package-unavailability notices retain
  their authority. Neither result bodies nor the request ceiling were reduced.

The capacity failure was reproduced against this change and compared with a
freshly built `af211c243` baseline, where both original pressure cases passed.
The first hypothesis, material-name hint sizing, did not fix the failure and was
withdrawn. Retained telemetry shows consolidation fitting 288091 bytes into a
288288-byte message budget before notice reservation. Both original pressure
cases pass after the actual notice-priority repair, with the unchanged fixtures.

This follows the existing separation between source context, attributed claims,
read projections and authoritative state; useful external checks were
[RDF literal/source distinctions](https://www.w3.org/TR/rdf11-concepts/#section-Graph-Literal)
and [CQRS read projections](https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs).
No additional orchestration architecture was adopted.

## Matched real-driver comparison

All arms use the same retained seed through the canonical driver's CoW admission,
campaign `game-5e7c1a3a-abe6-485c-a5bd-bfe280bc3063`, MiniMax M3.1 Flash Preview /
medium, including the sole author and supporting lanes. This session submitted
one natural player input, read its real response, then chose the next input.

| Complete player intent | Before 617b | Material build ad1f | KP requests before/after | Authors before/after |
| --- | ---: | ---: | ---: | ---: |
| Return to cafe, look inside, greet waitress | 15.410s | 14.075s | 1 / 1 | 1 / 1 |
| Ask whether the doctor's earlier address remains a useful lead | 13.886s | 12.323s | 1 / 1 | 1 / 1 |
| Return to photo clerk, without collection or another payment | 14.346s | 14.061s | 1 / 1 | 1 / 1 |
| Confirm receipt, film and prints for tomorrow | 13.052s | 17.126s | 1 / 2 | 1 / 1 |
| Total | 56.694s | 57.585s | 4 / 5 | 4 / 4 |

Both arms use zero foreground retrieval tools and four successful output calls.
The final arm's extra KP response contains only thinking and stops without a tool;
the existing native-output recovery asks again within the same player intent.
This is included in latency and inference counts, not hidden as preparation.
An earlier material candidate `a6da` takes 59.381s and retries one supplied
`travel_band` on a host-timed route. Its complete failed attempt is retained.
The matched comparison precedes the final capacity-notice patch; the final App
tests below run the installed `771fe8` build. These evidence sets are distinct.

Narrative assessment of the actual delivered text:

- Cafe entry improves from generic quiet service to white window lettering,
  OPEN sign, tables, fan, kitchen and food/coffee smells. The author task contains
  the corresponding first-sight description and current population.
- The doctor's answer distinguishes an address from an appointment or guaranteed
  presence. It still repeats extra old laboratory/pickup/past-dispute material:
  stronger focus and conversational economy are not established by this repair.
- Photo-shop return now recognizes a return and the existing arrangement rather
  than merely saying the clerk greeted the player. The author receives turn 86's
  own attributed words about the receipt despite the intervening cafe turns.
- Clerk pronouns drift between two turns. Characterization and gestures are
  present, but portrait continuity is not universally reliable. This sample is
  not reported as four flawless narrative responses.
- Exactly two thirty-minute moves commit; questions do not advance the clock or
  cause another payment/collection. No extra player clarification is required.

The driver author's first visible transport delta arrives after 12.002, 10.246,
12.632 and 15.636 seconds; it emits 17/34/8/21 deltas over 1.166/1.410/0.547/0.963s.
Cache-read bytes are not used as a proxy for quality or speed. Total Jev HTTP
counts remain unknown because the older experimental observer misses a confirmed
admission call; recorded admission telemetry is only a subset.

## Canonical App, final build 771fe8

Computer Use operates the existing isolated acceptance conversation in the real
`/Applications/PipiCOC.app`. Actual UI shows MiniMax M3.1 / medium; persisted model
and thinking records and actual author telemetry agree. Three consecutive inputs:

| Intent | UI elapsed | KP inference steps | Sole author |
| --- | ---: | ---: | ---: |
| Leave Knott, enter library, look without starting research | 23s | 2 | 1 |
| Return to Knott, knock and greet, still without accepting | 12s | 1 | 1 |
| Ask what to establish first and why, referring to his earlier advice | 14s | 1 | 1 |

Library prose supplies high windows, wooden tables, catalog cabinets, paper/leather
smells, distant page sounds and a present duty librarian. Return prose shows
Knott stopping his pen and recognizing the player. The third answer explains
checking reports, ownership and records to establish a verifiable account and
restore the property's reputation. It retains the player's unaccepted commission;
the dialogue records no payment or research result. The clock advances thirty
minutes per actual move, then stays still during the question.

Visible SSE is verified rather than inferred from logs. Entry screenshot 45 at
17:01:57.764Z ends partway through the reading-room description; screenshot 46
at 17:01:58.239Z continues through the service desk. The provider's final delta
arrives at 17:01:58.427Z, publication completes at 17:01:58.948Z. Both screenshots
therefore show real progressive body painting before generation completes.
App turns 20/21/22 retain 14/10/35 native author deltas, respectively.

The stable signing leaf is `108232C5A713C15A869FC4C267E18D2E35CD276C`; all 121
runtime files match. Staging is empty, LaunchServices and Spotlight find only the
canonical App, and the build-directory link points back to `/Applications`.
The pre-existing generic scene-caption issue and occasional mixed-language terms
remain visible; this change does not modify those UI or language policies.

## Verification and retained evidence

Final focused checks pass: fast 130; materials/author/first-sight/language 119;
context/disclosure 34; original capacity cases 2; actual native accepted output 1.
LAN related integration passes 12 on `ad1f` (the final kernel is unchanged).

The broader `a6da` run is not green: extension 4135 total, 4124 pass, 3 fail,
8 skip, zero cancelled; integration 2223 total, 2221 pass, 1 fail, 1 skip;
routing 12 pass. The new style-comparison test, public-summary regression and
capacity regression are repaired and rerun above. The remaining caption inventory
failure (`turn_unfinished_notice`) also reproduces on the before-change `af211`
baseline and is not patched here. A full final-build broad suite was not rerun.
Local tests accidentally using the primary checkout's older compiled kernel are
retained as stale-build verification failures, not final product results.

Evidence root: `.coc/experiments/npc-action-contract-20261018/browser-seams/prose-contract-20261019/`.
It contains all three `kp-render-*-metrics.json` summaries, raw driver workspaces
under `.coc/playtests/`, `app-material-771fe8-summary.json`, native screenshot
frames, canonical launch/signing evidence and the packaging log. Thirteen final
and failed diagnostic logs are retained through `shareTestTree` in
`render-material-logs/`, including storage admission hashes (257645 logical bytes).
The two frame sequences total 63798164 bytes. Existing seed, failures and raw
campaign evidence are preserved.

LAN broad evidence: `kp-blood-road-20261018/run.Mi7gQ2EG`; final related integration:
`run.tzEvnwpc`; final runtime build: `run.3Dawp2wu`, under the box's retained
`codex-tests/.pytest-runs/` directories. Both owned verification checkouts are
terminal and classified `retained:verification_failed` because the broad check
is not wholly green. They are not claimed removed; audit still lists the retained
paths. The canonical App stays open and idle. Concurrent location-system work in
the primary checkout remains its owner's uncommitted work, outside this repair.
