# Doctor request latency and stable decision parameters

Owner scope: explain the doctor KP's10.936 ->27.746seconds, optimize a proven
cause, add no judgment model, preserve the sole author's direct plain-text SSE,
run consecutive MiniMax intentions, package and operate the canonical App.

## Historical request split

These are actual primary requests in the same four-input retained-seed sequence,
not the author, a material lookup, or an aggregate of several KP generations.

| Doctor request | Control edb705 | Slow a93e9d7 | First candidate 48155 |
|---|---:|---:|---:|
| Request to HTTP headers, seconds |3.816|15.733|3.628|
| Headers to first nonempty delta, seconds |0.002|0.002|0.002|
| First delta to KP completion, seconds |7.118|12.011|7.675|
| Total KP seconds |10.936|27.746|11.305|
| Serialized payload bytes |393,993|400,235|312,171|
| Tool bytes |121,234|121,414|111,487|
| Uncached input tokens |91,358|92,722|71,934|
| Reported cache-read tokens |128|190|190|
| Output tokens |1,101|751|508|

11.917seconds of the16.810second increase occurs before HTTP headers;4.893seconds
occurs during the remaining generation. The host starts consuming content within
2ms of headers in both historical requests. Material preparation takes41ms in the
slow turn. More output cannot explain it: the slower response contains fewer
output tokens. Both doctor requests are almost completely cold; the128 ->190
cache-read change is not a cache-hit collapse between those two calls.

The transport disables SDK retries and the retained agent profile has no
retry.provider override. There is one primary request and no agent retry event
for this turn. Existing logs cannot distinguish network establishment, upstream
queueing and prefill within the request-to-headers interval. They also cannot
assign the slower output rate to a specific provider scheduler operation. Do not
claim an upstream queue diagnosis or a causal latency gain from one sample.

The first candidate doctor's shorter context is a capacity checkpoint after a
movement parameter retry, not proof that stabilizing tools removed88KB of useful
current material. Preserve that confound in comparisons.

## Confirmed local defect and repair

Before the change, cache telemetry repeatedly reports first_changed=tools/6.
The v4 schema interpolates current NPCs, material aliases, destinations and time
bands into output.input_schema. A changed tool head invalidates reusable system
and history prefixes, despite request-journal material reuse.

[MiniMax's current documentation](https://platform.minimax.io/docs/api-reference/text-prompt-caching)
describes automatic prefix matching in tools -> system -> messages order, and
monitoring actual usage rather than assuming a hit. Independently,
[Anthropic's tool-caching documentation](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-use-with-prompt-caching)
documents tool-definition invalidation of later cached prefixes. MiniMax's current
page emphasizes automatic caching; older explicit-marker/TTL behavior is not a
guarantee of a warm M3.1 request. No cache policy, model or inference setting is
changed here.

The structural tool schema now stays fixed. Current output_parameter_schema JSON data
contains an exact schema for issued references, movement choices, NPC destinations,
time bands, scene requirements and whether travel is already settled. Existing
deterministic reference, route and scene preflight remains authoritative.
Canonical route, disclosure, admission, failure-state and publication guards
remain. No prompt reminder or semantic keyword classifier is added.

The first candidate moved an entire exact schema to the tail. It repaired the
head but repeated21,429bytes on its first request. An intermediate163672/d977
trial sends only variable parameter data; it is withdrawn after the live failure
below. Final3a1ac54b6 retains the precise tail schema and original kernel path.
Its kernel extension is byte-identical to pre-task dea5d5ff3; there is no added
validation pass or runtime state field. The candidates retain their actual source.

The new prefix test is red on the original code and green after the change.
Deterministic gates also reject retired facts/people, unissued destinations,
extra route fields, missing scene assessment and a second settled journey.

## First candidate live evidence

Run kp-cache-head-20261019 uses the same1,076,405,624byte/4,614file retained seed
with a private forced-CoW view, MiniMax-M3.1-Flash-Preview/medium for primary,
author and support lanes.131GiB free at admission; ordinary4GiB seed/512MiB
growth/10GiB free-space bounds apply. Each input is submitted by the main player
after reading the real previous response. The daemon is stopped after six turns.

| Complete player intent | Seconds | KP / author / tool calls | Result |
|---|---:|---:|---|
| Confirm paid pickup and retained spare film |13.323|1/1/1|Confirmed, no payment or handover |
| Ask directions without leaving |12.973|1/1/1|South toward Cafe; remains in shop |
| Return to Cafe and greet |19.140|2/1/2|First greet incorrectly supplies empty content; refused, then corrected; one30minute move |
| Ask where to find the doctor |20.293|1/1/1|Existing north-road address report; today's presence uncertain; no move |
| Return to shop without collecting or paying |18.738|1/1/1|One30minute return; original clerk |
| Confirm next-day pickup |14.384|1/1/1|No duplicate payment;2minutes conversation time |

First four total65.729s versus original69.567s and preceding final79.194s.
All six total98.851s versus preceding112.227s. These are observed samples, not
a controlled proof of a cache-driven speedup; this candidate has7 KP requests
versus6 in the preceding final. The parameter retry is included. All six sole
authors are MiniMax and deliver actual text deltas, not a buffered typewriter.

All seven actual tool/system hashes are invariant; cache first-change moves into
messages. Reported reads still vary from128 to65,792tokens. Thus repairing the
local prefix does not guarantee provider cache retention or routing. The author
is deliberately not warmed by extra model calls.

Final candidate state: photo shop, clock497, cash178.5USD. Exactly two30minute
movements plus one2minute conversation; spare film36charges and receipt remain
with the investigator, exposed film31charges remains with the clerk. Six new
memory jobs87-92 are done; four inherited deferred jobs39/46/52/58 remain separate.
Recorded memory batches are3/2/2/3/2/3,2.298/2.434/2.107/2.930/1.844/2.471seconds.
These are bounded memory-lane counts; the old experimental HTTP observer is
incomplete, so global Jev HTTP totals are unknown.

## Canonical App first-candidate verification

48155ba01 is actually packaged and launched from /Applications/PipiCOC.app,
signed with PipiUI Dev leaf108232C5A713C15A869FC4C267E18D2E35CD276C.
121runtime files byte-match the validation checkout; strict signature passes,
staging is empty, Spotlight finds only the canonical App and the legacy build
path is a backlink. Archives are pinned existing local caches. Product defaults
are untouched; test overrides apply only to this App process.

Native Computer Use selects the existing Canonical App validation game and checks
the MiniMax3.1 selected model and medium effort. Actual NPC consultation and a
library-to-archive move complete, with UI16/12seconds and kernel primary-to-final
delivery11.538/11.619seconds. Each uses one KP/one author/one output. Movement is
one30minute receipt; no research or payment occurs.

An additional request to explain uncertain form fields fails at the existing
typed Jev consent check for a speak_briefly time effect: admit.81, scope.59,
restriction.41 -> uncertain. It executes nothing and creates no author. Native
UI shows the readable refusal. A natural clarification authorizes ordinary
conversation time; it publishes after18.122seconds, two KP calls (apply then
output), one author and14 actual deltas over923ms. The answer repeats required
fields but does not fully explain how uncertain values should be filled in, so
the original expanded question remains partial. Do not count the failed and
partial sequence as a clean successful intention or change admission thresholds
as part of this cache repair. State is archive/12:06/cash15dollars, with no
application/research/payment. Screenshot inspection confirms the actual UI.

Transport deltas are proven, but the short increment windows were not captured
as successive partial GUI frames before completion; do not claim visual streaming
painting from the final screenshot. The author generation/publication path itself
is unchanged and its65 existing regressions pass in the140-test targeted set.

## Withdrawn compact trial and regression findings

163672 completes one preliminary12.8s turn in kp-cache-bindings-final-20261019.
After binding the temporary generic gate to actual requests, d97727d85 passes
198/198 targeted tests in LAN run.sxwSw136, but its real compact-data run
kp-cache-bindings-verified-20261019 is not acceptable. The first pickup reply
omits the time, requiring an11.941s follow-up after13.648s. The next direction
intent fails after11.435s and two KP/output attempts: both select an unissued
waypoint. The generic schema error reports unrelated union alternatives rather
than the useful existing native waypoint-binding failure. Preserve these logs;
this is not a speed/correctness win despite a5,008byte parameter tail.

Broad LAN run.WNLguDHL on48155 exits1 after1217s:4029 extension tests,
4019pass/10fail; integration2223tests,2221pass/1fail/1skip; routing12pass.
Eight failures assert dynamic constraints at the former tool-head location;
those assertions now test the exact current schema and actual transported tail.
The ninth new extension failure is substantive: the added full-schema gate
blocks a zero-KP settled native routine using pre-move scene metadata, causing
an extra inference. An isolated red reproduction confirms it. Binding that
schema to an actual request fixes it, but the entire duplicate gate is then
withdrawn: existing canonical checks already cover this responsibility.
The remaining extension failure is the prior unused turn_unfinished_notice key.
Integration campaign.create times out under the broad run's load; time-until
reruns pass in the198-case targeted batch, without changing kernel/test timeouts.
No failure baseline or unrelated caption is edited.

Final3a1ac54b6 returns to the exact-schema tail and removes the redundant gate.
The kernel extension has no net changes against dea5d5ff3. Build run.5H7rR5in
passes and is fetched. Final live and canonical App evidence is appended next;
preceding trials retain their actual model/source attribution.

## Final retained implementation and complete-intent measurements

Final3a1ac54b6 builds on LAN run.5H7rR5in. Extended targeted run.jdNW1WRj
passes198/198 in178seconds, including all previously failing schema-location
assertions, the zero-KP routine regression and time-until. Fast130/130 and
system-language5/5 pass. The earlier broad red result remains historical; this
is not a claim that every repository test is green.

Run kp-cache-schema-final-20261019 uses the same retained seed and explicit
MiniMax3.1/medium profile. Five genuine inputs form four player intentions:

| Player intention | Full observed seconds | KP / author / output | Outcome |
|---|---:|---:|---|
| Confirm pickup, payment and retained spare |24.355|2/2/2|13.965s first reply omits pickup time;10.390s natural clarification confirms tomorrow/joint retention, but noon is not explicitly repeated |
| Ask directions while remaining in shop |14.845|1/1/1|Retrace the known route; no unissued waypoint or move |
| Return to Cafe and greet |15.416|1/1/1|One30minute move; present attendant responds |
| Ask where to find doctor without departing |13.317|1/1/1|Existing north-road address report and uncertainty about today's presence |

Total67.933seconds versus69.567 in the original four-response control and79.194
in the preceding final. The final measurement includes the pickup clarification;
it does not remove that extra round to improve the figure. Five KP/five authors
versus four/four in the control is not a round-count improvement. Exact noon
wording remains a clarity limitation; there is no claim of universal correctness
or a statistically established whole-intent speedup. All five output calls
succeed, with zero parameter refusal or foreground retrieval.

Final doctor KP:4.245s, request-to-headers1.859s, headers-to-first-delta.086s,
first-delta-to-completion2.300s. Wire payload312,383bytes, tools111,487bytes,
uncached input72,040tokens, cache read128tokens, output357tokens. The journal
records a capacity checkpoint; the prior extra clarification changes the context
trajectory, so this smaller request is not a matched context-size ablation.
Cache writes remain unreported. All five actual tool/system hashes are stable.

Compare the first exact-schema candidate doctor:312,171bytes,71,934uncached
tokens,190cache-read tokens and11.305s KP. Nearly identical size/cold-cache
conditions still have materially different headers and output-phase timings.
This further rules out treating local cache loss alone as the explanation for
every slow request. The provider's queue/prefill/decoding internals are unavailable.

Final driver state: Cafe/clock465, cash178.5USD, exactly one30minute movement.
Spare film36charges and receipt stay with the investigator; exposed film31charges
stays with the clerk. Five new memory jobs87-91 are done with no deferred rows.
Four inherited pending/deferred jobs39/46/52/58 remain unchanged. The daemon is
stopped cleanly. Original raw evidence and all failed trial runs are retained.

## Final canonical App and visible SSE

The installed and running canonical App is3a1ac54b6, signed with the same stable
PipiUI Dev identity.121runtime files byte-match the validation build; strict
signature validation passes, staging is empty and Spotlight resolves only
/Applications/PipiCOC.app. The build-home path is a backlink. No product model
default or credential is changed; the App uses a process-scoped MiniMax test
profile. Source archives and Electron are reused from existing local caches.

Native Computer Use completes two actual intentions in the existing test game:
return from archive to the library entrance, then spend a few minutes thanking
the attendant. Each uses one KP/one author/one output, with no refusal or lookup.
The UI shows21s/12s; kernel-input-to-published-delivery is16.164s/10.969s.
Those boundaries differ and are not interchangeable. Primary/author MiniMax3.1
and medium effort are verified in the actual runtime evidence. Final state is
central-library/clock159, cash15dollars, with one30minute move and3minutes of
authorized conversation, no research/application/payment. Both new background
memory jobs are complete, with two recorded requests each.

This time continuous native AX/screenshot observations capture actual growing
public prose:14:07:35.434Z shows only the first clause;35.666Z shows a longer
incomplete sentence;35.884Z shows the full paragraphs. The first partial frame
precedes the last provider text delta at35.639Z. Publication completes at36.098Z
and UI working state clears by36.968Z. This proves visible incremental generation
for that actual App turn, rather than post-completion character splitting.
Evidence: app-visible-sse-3a1ac5.json and app-cache-schema-final-metrics.json.

The earlier App refusal/partial explanation remains an independent known
limitation in the retained first-candidate section. Admission was neither
bypassed nor loosened, and no judgment model or prompt patch was added.

The owned validation checkout is terminal and lifecycle closeout classifies it
retained_verification_failed because the broad verification is not green.
Its two existing dependency symlinks and all failure evidence remain; no forced
cleanup or other-owner source changes are performed. The final focused green
result does not relabel that broad failure as a full-suite pass.

## Evidence

- Raw historical runs: .coc/playtests/kp-preparation-{before,final}-20261019.
- First candidate: .coc/playtests/kp-cache-head-20261019.
- Withdrawn compact runs: .coc/playtests/kp-cache-bindings-{final,verified}-20261019.
- Final retained source: .coc/playtests/kp-cache-schema-final-20261019.
- Read-only timeline helper: .coc/experiments/npc-action-contract-20261018/browser-seams/prose-contract-20261019/doctor-cache-timeline.mjs.
- Derived candidate and App metrics: cache-head-metrics.json and app-cache-head-metrics.json in that experiment directory.
- LAN build run.YXvAZNJ5; targeted140/140 run.2Jphghq1 on48155ba01.
- Fast130/130 and language5/5; compact parameter/prefix and language tests7/7 on163672cec.
