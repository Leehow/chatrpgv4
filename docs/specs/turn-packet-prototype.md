# Narrative and structured turn packet prototype (2026-10-17)

## Current compact decision and canonical result revision (2026-10-18)

### Stable NPC references (owner 2026-10-18)

#### Remaining seam repair (owner 2026-10-18)

#### Scene population correction (owner 2026-10-18)

Registered cast coverage is never population coverage. A missing person/name in
the module cannot establish an empty place. Reuse the existing section 208
`world.scene_activity` owner and clock applicability, not a second population
cache: Keeper scene commands assess service/crowd at the current place/time;
the host supplies an English summary, established basis and a 15-minute review
boundary (optional 1–60 minute override for a known change). The existing anchor/day/day-part/rewind/boundary checks invalidate it.
`crowd:empty` is an explicit assessment, not the absence of named cast.

Native commands add `scene` (service/crowd) and `walk_on` (new_1..new_4, public
role label, reason). Walk-ons use ordinary atomic `apply npc` with walk_on:true
at the resulting scene. They are improvised table people, not authored cast.
Their durable canonical identity/ref remains available after they leave; the
temporary presence is not a reason to delete encounter or memory evidence.
Selected responses may use their packet-local new_N slots. The host binds slots
to actual kernel-minted npc_N references after the same transaction, before
author startup. Unknown/duplicate/unbound slots never become identities. A new
slot cannot select an existing person by name. The host's `_new_person` and
`_population` flags bind call identity because they affect validation. Opening
creation is limited to a new table person seated at the active scene by this
same narrow walk-on shape; ordinary opening restrictions remain in force.

An unassessed or expired scene goes through the existing Keeper once, including
after an otherwise pure journey. An applicable assessment reuses the existing
zero-Keeper travel path. No new judgment model/request is inserted. The author
receives assessed population and registered public people separately; it cannot
derive emptiness from an empty list. This knowingly spends one existing Keeper
call when population is unknown rather than asking the prose author to decide it.
The packet author's after-delivery first-sight check uses that same settled
scene. Replace the run's accumulated pre-move review targets with current
capsule targets, respecting existing in-flight suppression. This changes no
kernel description debt: departure-scene items remain owed on their own visits.
It prevents checking departure people against arrival-only prose or postponing
a newly created person's first check until the following input.
Author clock material projects only the canonical anchored `at` and `day_part`;
elapsed duration is not a wall-clock alternative. Temporal scene material
exposes applicability plus current service/crowd/summary, omitting old clock,
anchor and expiry bookkeeping. Mechanics retain the full canonical clock.
The native walk-on label is an explicit public role appellation. Its creation
seeds existing person_labels in the same transaction. Journal jobs reuse this
canonical public word instead of requesting another nickname or treating its
own already-public pieces as an undisclosed personal name. Other aliases and
other people's unrevealed names retain their existing guards.
Time-band parameters select handles issued by rules.bands, not free-text
duration phrases. The host reads that existing registry once per input, bounds
the native enum and validates the same membership at owner preflight,
before consent or mutation. One closed-parameter correction is allowed before
execution; repeat invalidity terminates without publication or changes. This is
a local deterministic read. A host-settled
journey retains its time-free command schema.

The capsule projects bounded `public_scene` material from committed, on-line,
non-reference stationary deliveries whose canonical closing scene is current.
It carries exact delivered text and turn attribution, never a private module
summary. Travel deliveries are excluded because their prose may span two places.
The isolated author consumes this existing kernel projection alongside current
clock/results; public history supplies continuity, not new transaction authority.
The author scene also carries current recorded public NPC references/labels and
an explicit registered-coverage flag, even with no selected response. Old public prose
cannot establish absence or move a present person away. No private dossier or
undisclosed book name is copied into this scene projection.

Speech alone is not physical presence. Unrecorded-person rows report a ledger
discrepancy without instructing a move; known-reference rows expose recorded
location separately. Only an explicit NPC command changes that location through
the existing apply owner. Telephone/offstage speech must not auto-place anyone.

MiniMax M3.1 native routine requests require a tool using `tool_choice:any`,
preserving adaptive thinking and medium effort. Known reference-mode requests
and other providers retain their existing policy. Read tools remain available;
the host still validates and publishes output exactly once. A request constraint
is not a semantic judge or a reason to replay effects after a refusal.

Voice drafts and complete typed review results, including uncertainty, reuse
exact source/candidate/model/policy identity across restart. Uncertain reviews
stop this dispatch without burning an identical retry. Transport failures remain
retryable under the existing budget. Neither cache nor a terminal pending state
grants publication. Memory pending diagnostics expose precise deferred blockers;
no unknown attribution is guessed and no threshold is lowered.

The compact prototype does not mount background voice-card preparation: its
author consumes selected personality/social-role material, not generated cards.
Ordinary production mode retains the existing voice consumer and preparation.
This is a deterministic consumer/lifecycle decision, not clearing historical
pending evidence or substituting an unreviewed card.

Writers: committed deliveries, ordinary NPC apply, retained voice writer/reviewer.
Readers: capsule and author, native provider payload, background dispatch.
Actors: existing publication/apply owners only. No added judgment model.

The kernel allocates monotonically increasing `npc_1`, `npc_2`, ... references
for canonical NPC nodes in `world.npc_references`. Normal open/input/apply write
owners initialize and extend the registry; reads never allocate. Existing
bindings and the high-water mark survive rename, movement, restart and deletion;
an absent/deleted identity cannot be rebound. Worldline snapshots inherit the
registry and existing campaign/worldline/input revision gates remain binding.
This is a compact alias of the existing identity, not a second NPC identity.
Duplicate graph occurrences resolve to their canonical person before allocation.

NPC projections expose `ref`, `display_name`, `name_known` beside the existing
Keeper view. Public naming uses the existing committed-name/epithet authority;
an undisclosed book name is never the author's fallback. `name_known` describes
the current player-party projection, not global knowledge or another NPC's
cognition. A staged or failed disclosure cannot set it true.

The native routine wire's actor fields accept only these short references.
The host binds them against NPC material actually supplied during this input;
unknown/unissued references fail before speaker reads, writes or author startup.
The bounded capsule also supplies `npc_references.people` for identities in
committed public speech and table-established people, including those currently
off stage or unplaced. This catalog grants neither presence nor secret knowledge;
unencountered book people are excluded. Its 2 KiB allowance and omitted count
are explicit. Budgeted present stubs retain ref/public-name/knowledge fields.
The first MiniMax probe exposed an unplaced previously spoken-to clerk: supplying
only present[] left no legal actor ref and produced an empty response. Preserve
that failed semantic probe; known-identity material closes the missing consumer
without another model or retrieval request.
Knowing or guessing a reference is not a visibility or action grant. Existing
action admission and kernel transactions remain authoritative.
The author receives only selected references, public display names, projected
knowledge and optional style; no canonical name is copied as a fallback.
It uses `{{say:npc_1}}` for attribution, while the existing delivery catalog and
kernel speaker resolver project the permitted label without guessing names.
Public prose remains authored, never globally search-and-replaced.

Writer: existing kernel write owners and committed naming. Reader: NPC capsule/
look projections and routine-packet binding. Actor: existing apply and final
delivery owners. No semantic judge, new LLM request or independent state writer.

### Jev-first routine travel experiment (2026-10-18)

`PI_COC_PACKET_PRESCREEN=1`, with the existing packet prototype, reuses
ContinuousTurn's host-issued move candidates and canonical dispatcher. In one
bounded batch, the existing selection/restriction Nouls select each supplied
journey at the unchanged .6/.4 gates. One Noul asks only whether additional work
remains beyond that journey. Probability <= .4 permits skipping Keeper inference;
otherwise the Keeper handles the remainder. This routing answer never gates an
already-authorized journey. Conflicting selected destinations stay with the
Keeper. No independent retry or all-candidates-clear gate. The retained first
revision's five-way scope gate blocked a clear move and caused two requests;
that coupled gate is removed. A later .1 remainder threshold was overconservative
on the real pure-move input (.21); read-only calibration retained speech (.86),
inquiry (.92), pending condition (.92) and future plan (.56) above .4. This route
does not grant write authority and uses its own explicit probability threshold.

Only supplied, fully bound move candidates may execute automatically. Transactions,
new destinations, rule checks and new NPC decisions retain their current owners.
The prescreen classifies present authority/readiness, never historical completion.
Plans, quotations, recollections, inquiries and unmet conditions are not execution.
Their text remains available for NPC response and context.
Move candidates conclusively refused by the prescreen are omitted from the
Keeper's prepared-operation material. Selected and uncertain candidates remain
subject to the existing input/world/source revision binding; retained material
does not grant authority.
Known timed return roads remain candidates after a backtrack pops their
destination from the navigation stack. The ordinary kernel option projector
reads the current world's existing road cache and the executor's reverse-road
predicate, so a previously travelled trip needs neither scene rediscovery nor
a model-filled duration. This changes candidate coverage, not reachability.

Writer: ContinuousTurn records input/world-bound selection evidence and dispatches
ready moves. Reader: admission reuses an exact unchanged proposal's answer;
the final expression owner retains actual kernel outcomes. Actor: the existing
publication owner may publish routine-only travel without a Keeper inference;
mixed travel/dialogue invokes the Keeper for remaining decisions. Keeper output
cannot replay a settled journey or manufacture its success. The author still
receives actual travel outcomes when the Keeper submits no movement command.
After host travel, the provider declaration exposes NPC commands only, with a
matching local guard against another move/time command. The host derives
`decision_context.speech_allowed` from selected responses; false requests
narration only, without invented NPC dialogue or offers.

Measure pure movement and NPC conversation separately from the same retained
seed, including the extra prescreen cost on conversation, every recovery input,
all generation calls, Jev requests, tools and actual final state. Compare with
the frozen previous wire. No semantic judge is introduced.

The retained p5 key inquiry failed twice because the sole author omitted a
textual framing marker. The decision author now owns only the final prose body:
a nonempty assistant message ending normally in Pi's typed `stop` event is its
terminal body, and the host supplies publication framing. Unmarked text remains
private until that terminal event; tool-use preambles are discarded, streamed
and terminal bytes must agree, and error/abort/length completions cannot publish.
Existing explicit framing still streams; the legacy brief path still requires
it. This replaces the decision author's redundant marker protocol, without
retry, extra inference, semantic judgment or a change to settlement authority.
Unmarked delivery waits for completion, so first-byte latency may increase.

TypeSafe's Noul and speculative fan-out documentation support atomic questions
in one request with code-owned gates; Command's AI/actor separation supports
executing parameters outside the generator. These precedents do not establish
latency or semantic accuracy; genuine MiniMax play remains required.

Retained result: `.coc/experiments/packet-prescreen-20261018/report.txt` and
`comparison-p6.json`. From the same seed, seven genuine sequential MiniMax
M3.1/medium intents delivered 7/7 in both arms: 127.745s control vs 106.368s
p6, including the driver's fixed readiness waits. Three routine journeys
skipped Keeper inference; name repair and a thinking-only completion consumed
two extra requests, leaving Keeper counts 7 vs 6. Three dialogue intents were
slower (40.503s vs 50.543s). Foreground Jev batches rose 4 to 7, while measured
background memory requests were 21 vs 18. No new retrieval occurred in either
arm. Four actual 3-minute move receipts and no additional settlements were
verified, but cross-location descriptive bleed remains in the author material
projection. Arbitrary book summaries are not a public-safe remedy. Keep opt-in;
neither general latency improvement nor full semantic correctness is established.

The current wire is `{version:3,commands:[],responses:[]}`. Commands are the
existing move/NPC-presence/time-band operations; each response is
`{actor,act,points:string[],stance?}`. The host settles commands once, then
passes the kernel's actual `outcomes` (changed or unchanged), current scene and
clock, bound speakers, optional style and recent public context to the author.
It does not manufacture committed outcomes or empty legacy writing briefs.
Short points express selected NPC claims; they are not world-state assertions.
There is no interleaved program, universal relation vocabulary or new judge.
The host marks the actual player-action list complete. Response claims are
projected as speech-only, and offers explicitly await player acceptance; a
conditional offer is never an instruction for the author to perform its
dependent actions. Partial settlements remain preserved results and cannot
start a complete response.

NPC-only position assignments already at the recorded destination are checked
inside the existing transaction, produce an unchanged outcome and no change
receipt/event. Unknown speakers fail binding before any writes; absent style
for a known speaker is not a failure. Refused combined changes never start the
author, and publication recovery preserves prior settlement identities.

Consent version 5 uses one existing batch: selection plus an explicit current
restriction veto. Selection >= .6 and veto <= .4 admit; selection <= .4 or
veto >= .6 refuse; the remaining region is uncertain. These are the existing
gates expressed with veto polarity, not a lower confidence policy. Typed
host-projected operations replace embedded JSON strings when available.
The retained false-negative reproduces at unchanged gates after merely removing
history or changing the operation to an object. The focused veto question
admits the original and unrelated-limit control while retaining negative,
conditional, inquiry and future-only controls. Production-function live Jev
evidence is component evidence, separate from continuous MiniMax gameplay.

Acceptance is measured by completed player intent, counting every recovery
input, KP/author request, retrieval and foreground/background Jev batch. Use the
same retained seed, explicit MiniMax M3.1/medium and one natural input at a time.
Preserve earlier runs and do not reinterpret faster rejection as success.

## Historical decision-data revision (2026-10-18)

The next experiment replaces the v1 protocol described below; retained v1 runs
are unchanged. The question is whether removing duplicate prose generation,
rather than placing prose inside JSON, reduces work without extra judges.
The wire is `{version:2,actions:[...]}`. Closed commands are move (destination
and optional short route), time (rule band and reason), and respond (actor,
speech act, short subject/relation/value facts, optional stance). No finished
dialogue, scene paragraph, narrative list, personality transcription or author
instructions can be submitted. All free semantic atoms have explicit small
limits; these limits enforce size/shape, not semantic truth. The model still
decides open semantics; there is no keyword intent router.

The host executes move/time through existing consent and transactional apply,
then supplies actual location, clock, committed results and loaded NPC style
directly to the sole prose author. Only selected response facts are disclosed;
unselected NPC knowledge, secrets and source notes stay out. Ordinary replies
need neither event writes nor semantic review. The first decision-data trial
exposed a missing consumer: the author had no previous public exchange and
re-established an unchanged location. The corrected handoff reuses the existing
delivered/recent public context, last two exchanges with explicit per-message
8,000-character truncation. It adds no retrieval, inference or summary. Production mechanics already have structured resolve/apply interfaces. The
current routine prototype hides those direct write tools; integration of other
mechanics into the final command batch is not claimed. Failed operations cannot start
the author. The provider schema remains fixed and locally checked.

Two primary precedents inform this boundary. [Command](https://gameprogrammingpatterns.com/command.html)
explicitly uses data commands between AI and actors: decisions are parameters,
execution belongs to the actor. [Yarn Spinner](https://docs.yarnspinner.dev/components/dialogue-runner)
separates command handlers, variable storage and presenters. Both confirm
separating decisions/state/presentation. Yarn's authored lines differ from our
generated final prose; neither source proves LLM correctness or latency. Reuse
our existing kernel/publication owners instead of adding an event framework.

Acceptance: native closed-schema regressions, rejected-write/false-success
guard, actual completed delivery and inference counts; sequential real MiniMax
M3.1/medium movement and conversation from the retained seed. Compare actual
generated tokens, wall time, retrievals, foreground Jev and post-publication
inferences against retained v1. Record capacity before new CoW snapshots. Do not
change product defaults, weaken consent or call component fixtures live play.

## Question and acceptance

Can one Keeper inference describe a routine transition and NPC response, with
small typed state anchors, replace repeated tool/argument round trips without
adding a semantic reviewer? Compare current isolated-author mode and the opt-in
prototype from the same retained campaign seed, using MiniMax M3.1 / medium for
the Keeper, author and supporting lanes. This is a runtime prototype, not an HTML
simulation or a substitute Keeper. The main session remains the sole player.

## Protocol

`PI_COC_TURN_PACKET_PROTOTYPE=1` selects the existing isolated author and extends
its native `output` tool arguments with optional `movement` and `activity` objects.
The ordinary expression fields remain unchanged. A movement contains `to`,
`stage` (`arrived`, `planned`, `blocked`) and `passage`. The passage is natural
language describing this transition; the small anchor identifies its subject
as the current investigator party and disambiguates destination and completion.
The Keeper generates passage and anchor together. There is no separate
generative extraction call or semantic regular expression.

The native revision submits a typed `output` call, not assistant-text JSON or
`{{compose}}`. Root and nested packet objects reject additional fields. NPC
personality/emotion accept string or null and default locally to null when absent; optional writing is a string rather
than an unbounded object. Scene and actor candidates stay in the existing
materials, keeping the declaration identical between turns. Other operations
finish in earlier steps. Successful output terminates the Keeper leg after the
host's existing author/publication owner finishes; it does not require a Keeper
request to acknowledge the tool result. The operation port consumes the host-owned published:true result as accepted delivery; terminate alone does not set RunDriver delivery. Regression counts actual inference steps, including requests that exhaust a fixture queue. Text beside tool calls stays private;
direct `{{reference}}` answers retain their existing non-fiction path.

MiniMax endpoint probes and raw responses are retained under
`.coc/experiments/turn-packet-native-20261017/provider-probe.json`.
The actual Anthropic endpoint accepted native tools, but accepted an invalid
strict schema too. Its documented `output_config` is effort-only and its
documented tool choices are auto/none
(https://platform.minimax.cn/docs/api-reference/text-chat-anthropic).
No native strict guarantee, forced tool choice or unsupported format parameter
is inferred. Local structural validation is mandatory and adds no Jev/model
call. Pi's non-strict Anthropic conversion omits root schema keywords; the
project-owned request hook restores this one owned declaration, preserving
messages, thinking, cache annotations and other tools without modifying Pi.

Only `arrived` compiles to the existing move effect. The host derives the source
from canonical state, uses passage as the route, omits establishment, ids and
exact minutes, and lets the existing kernel resolve destination/reachability and
reuse authored or previously travelled duration. A missing duration stays
explicitly unknown under existing policy; this prototype does not invent one.
Planned and blocked transitions do not move the party. An optional activity
contains a rule-owned `band` and `why`; it compiles to existing banded time.
The rule registry owns admissible bands, ranges and seeded sampling. No model
min/max, arithmetic or retry resampling is introduced. A single transaction
retains existing travel/time double-count protection.

The host submits compiled effects through normal `runTool(apply)`, including
existing consent, Mods, transaction, receipt and failure owners. No admission
bypass or additional Jev call is introduced. Candidate preparation remains available as material, while the prototype skips
the speculative pre-Keeper candidate decision/execution. Only the resulting
proposal needs semantic consent; unchanged dialogue has no foreground decision.
The existing native input-scoped record call id provides idempotency. Failed proposals never start the author;
existing held-operation publication constraints remain effective across steps.
The host removes operational fields before the author, supplies host-owned
`settled_actions` confirming committed action kinds/destination or rule band,
and replaces scene with the actual post-settlement capsule scene. The model
cannot submit this confirmation field in its private brief. Dialogue with no change needs no
apply, event, retrieval or semantic review merely to record speech.

Rolls, purchases, inventory changes, newly established places and unknown rule
outcomes retain existing tools and actual results before their dependent brief.
This bounded prototype does not infer arbitrary world changes from unrestricted
prose. Exact anchors avoid adding an extraction/review loop; evidence must not
be described as proving fully free-text state extraction.

## Ownership and measurements

Writer: Keeper native tool arguments. Reader: Pi's typed argument validator and
the prototype compiler at the existing
composition seam. Actor: existing apply owner submits effects, then the existing
isolated author renders accepted content. Canonical receipts remain authority.

Retain each input, delivered text, before/after scene, receipts and actual model
attribution. Count Keeper requests, author requests (including author tools),
Keeper tools, retrievals, host apply operations, all foreground Jev requests,
refusals, total wall time and time to public bytes separately. These are related
measures, not interchangeable counts. Baseline and prototype both enable the
same author; old single-author timings are only historical context. The same
natural actions are attempted sequentially, adapting only to actual responses;
do not script player turns or synthesize game records. Small samples establish
observations, not a universal latency claim.

## Precedent and limits

JSON Schema conditional validation supports structural obligations, not consent
or narrative truth (https://json-schema.org/understanding-json-schema/reference/conditionals).
TypeSafe recommends atomic semantic questions composed in code in one batch
(https://docs.typesafe.ai/primitives/noul). These support reusing existing
admission rather than adding an extraction judge. MaaG separates event
recognition from external numerical calculation and persistent spatial memory
(https://www.microsoft.com/en-us/research/articles/maag-a-new-framework-for-consistent-ai-generated-games/);
its visual-world results do not establish reliability or speed for this text
protocol. Transactional publication guidance supports committing before public
success (https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html).

Primary risks: anchors can still misrepresent narrative intent; the existing
semantic consent gate can be uncertain; output authors can add unsupported
facts. This experiment removes mechanical parameter work, not those model
limitations. Never compensate by silently lowering thresholds or adding a
review/rewrite cascade.

## Observed result

Retained evidence: `.coc/experiments/turn-packet-20261017/report.md` and
`comparison.json`; original driver runs are
`turn-packet-baseline-minimax-20261017` and
`turn-packet-final-minimax-20261017`. Both used the same seven natural inputs,
actual MiniMax / medium, and delivered six results (three moves, three NPC
conversations). All three moves reused the same 3-minute road; no payment or
inventory change landed. Failed input five remained at the previous location.

| Measure | Existing isolated author | Prototype |
| --- | ---: | ---: |
| Total seconds, including failed input | 152.461 | 133.609 |
| Successful-input mean seconds | 21.195 | 20.558 |
| Successful first-public median seconds | 17.903 | 19.246 |
| Keeper / author requests | 13 / 6 | 9 / 6 |
| Model tool round trips | 6 | 0 |
| Actual movement submissions | 3 | 3 |
| Foreground Jev requests | 12 | 3 |
| Independent background memory requests | 19 | 16 |
| New retrieval tools | 0 | 0 |

The prototype still failed on an extra movement metadata field and used two
existing JSON corrections on later inputs. Both arms delivered 6/7; stronger
correctness is not established. Its text was 25% shorter, Keeper output tokens
increased from 5994 to 6580, and successful-turn latency improved only 3% while
first-public median worsened. The 12.4% total improvement is not a general
performance claim. Default enablement is rejected for this version.

This historical result required testing a native Pi typed submission instead of free-text
JSON plus parsing, preserving the same commit/publication seam and judge count.
MiniMax's official Anthropic compatibility documentation explicitly supports
tools and tool_choice (https://platform.minimax.cn/docs/api-reference/text-anthropic-api),
but does not establish strict schema decoding for this model/endpoint. Neither
strict decoding nor the next transport was implemented or claimed by that run.
The subsequent native revision is measured separately; historical evidence is
not relabeled or overwritten.

## Native revision result

Evidence: `.coc/experiments/turn-packet-native-20261017/report.md`,
`comparison.json`, `validation.json` and the retained driver run
`turn-packet-native-format-minimax-20261018`. Keeper and author both used actual
MiniMax M3.1 / medium. The same seven natural inputs yielded six deliveries,
three 3-minute move receipts, no payment/inventory receipts, and one uncertain
move held without public arrival. Clarifying the next player input completed it.

The final revision made eight Keeper requests and six author requests, versus
13 and six in the baseline. JSON/shape corrections, retrieval tools and
post-submission Keeper requests were all zero. Foreground Jev requests were
four: three successful moves and the held move; ordinary dialogue used none.
Eighteen independent background memory requests remain separately counted.

Total time was 158.069s, versus baseline 152.461s and text-packet prototype
133.609s. Delivered-input mean was 22.343s, versus 21.195s and 20.558s.
First-public median was 16.337s, versus 17.903s and 19.246s. Fewer requests did
not establish faster completed turns. Keeper output tokens increased to 7364
from baseline 5994; the planner still emits substantial narrative that the
separate author renders again. In the slowest 37.198s dialogue, Keeper generation
took 28.086s and author generation 4.616s, with no retrieval or foreground Jev.

The native protocol is repaired but stays opt-in on the hybrid engine. Existing
admission uncertainty and narrative time-of-day drift are still observable;
format validity is not a general semantic-correctness guarantee. The report
preserves the earlier completion-consumer failure, the nullable-field retry,
focused-suite failures and final targeted verification without relabeling them.

The decision-data adapter locally canonicalizes exact single-key `item` envelopes
only at declared command/fact array positions (at most four wrappers). Both a
single object and repeated items are arrays after transport decoding. Unknown
fields and scalar/ambiguous envelopes remain invalid under the closed schema.
This addresses the retained MiniMax facts.item retry loop without changing
semantic values, consent, bounds or adding inference. Repairs are counted.

NPC style lookup is optional material. An unknown person reference returns
style_available:false and uses existing public conversation; it must not block
writing, establish/move a person, infer an alias or add a semantic judge. Other
kernel errors still fail closed and publication retains its existing owner.

The v5 trial exposed an alternate-path defect: a takeaway inquiry went through
legacy cash quote/event tools and incurred three parameter corrections. The
current bounded routine profile therefore offers read tools and output only.
Party/time/NPC-presence commands compile together through the existing apply
owner; NPC replies are response data. Direct apply/resolve/ask are outside this
routine experiment, not removed from production. This makes the decision wire
the only foreground write route instead of asking the model to prefer it.

## Remaining-seam closure (2026-10-18)

Native MiniMax routine submission uses the supported auto tool strategy and a closed native schema. Both the earlier any-tool and named-output experiments failed to enforce submission: the endpoint-specific Messages API supports only auto and none (https://platform.minimax.io/docs/api-reference/text-chat-anthropic). The raw previous failure was prose discarded by the private protocol, not an empty provider response. The bounded routine model loadout contains only output; existing host preparation supplies state, NPC views and issued operations. Production non-routine tools and known reference answers are unchanged. Local validation and publication remain authoritative; existing one-shot protocol recovery is retained without claiming strict decoding.

Routine moves select exact issued destinations. Host-owned route data is rebound from that option, and free `via` is refused. Shared consent instructions explicitly distinguish approaching a graph location from entering its building. Exact input/world/source reuse retains its original confidence; changed routes or destinations are not declared equivalent. TypeSafe's state/question contract supports explicit operation meaning and independent questions; it does not justify inferring equivalence across different effects (https://docs.typesafe.ai/concepts/state, https://github.com/typesafe-ai/typesafe-sdk-js/blob/main/src/questions.ts).

## Overnight integration: close NPC action channels (2026-10-18)

Replace the accidental silent free-prose channel with {actor,act:"silent"} only.
Movement and other actual world changes belong to commands; speech claims remain
speech. Current here/away plus issued move destinations form NPC destination
capabilities in both the wire schema and owner preflight. Share the existing
one-shot parameter correction across syntax, NPC capability and time band errors,
before any writes or author generation. Canonical NPC outcome projection, not
submitted commands or nonverbal prose, tells the author who moved.

Primary-source comparison: JSON Schema enumerations/disjoint object shapes
(https://json-schema.org/understanding-json-schema/reference/conditionals),
Ink's game-state/text and variable-observer boundary
(https://github.com/inkle/ink/blob/master/Documentation/RunningYourInk.md),
and CQRS command/read projection separation
(https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs) support
closing capabilities and projecting actual executed state. They do not guarantee
semantic truth in arbitrary prose. Keep one existing kernel and no added judge.

Chapter integration restores look/lookup/recall/resolve/apply/ask alongside
native output. All successful input-bound apply outcomes reach the author,
including operations before the final packet; replayed receipts are not new
transitions. Unsettled failures still prevent publication. Only a matching
complete operation, with the same canonical arguments and input scope and a
successful canonical receipt result, can discharge its own failure. Changed
arguments, unrelated success and partial settlement cannot clear it.

Ordinary hybrid play now enables this path and the existing prescreen; setup
does not. The explicit environment opt-out remains. This supersedes the earlier
opt-in/output-only experiment, without changing product model preferences.
Live-test overrides pin MiniMax/medium or the documented quota fallback
Grok/high for the author, readers, supporting lanes and driver alike.
