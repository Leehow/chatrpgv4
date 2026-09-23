# NPC reactions in shared Keeper preparation

Tracker: [#109](https://github.com/Leehow/chatrpgv4/issues/109), labeled `ready-for-agent`.

Status: **Ready for implementation planning. This integration is specified, not implemented or performance-accepted.** Prepared with the explicitly requested to-spec workflow on 2026-09-22. The user confirmed the primary acceptance seam: actual outgoing Keeper requests and real player turns, including personality/relationship continuity and total player wait. Authentication, concurrency and background persistence support that outcome.

This is a focused integration of [NPC personality and relationship continuity #102](https://github.com/Leehow/chatrpgv4/issues/102) and [Jev material preselection #108](https://github.com/Leehow/chatrpgv4/issues/108), under the existing [Jev architecture #101](https://github.com/Leehow/chatrpgv4/issues/101). It preserves the current kernel, Keeper and source authorities. It does not reopen the original NPC implementation or replace the material-supply design.

## Problem Statement

Players want timely responses from people who have recognizable personalities, their own priorities and memories of their relationship with the player. The Keeper also needs relevant source material, rules and history to make those responses coherent. Preparing those two kinds of support independently repeats state reads, creates separate scheduling and waiting allowances, and risks delivering obsolete NPC advice after other preparation has finished.

The current preselector already discovers named NPCs and distinguishes those marked present from other module NPCs. A selected NPC read can include the implemented personality, directed relationship evidence, promises, recent speech and reunion history. However, discovering an NPC dossier is different from deciding whether that person should respond and which intention fits. The current NPC response owner runs before the later context preselection, with its own decision adapter and optional wait. Thus the data has useful overlap while the work is still scheduled separately.

Success is one coherent preparation pass: relevant material and appropriate NPC intentions are supplied to the Keeper without repeated discovery or additive automatic waits; the people remain distinct and remember actual shared history; the player retains the choice of what to do next. Useful prepared work must survive an unrelated optional timeout, but stale work and private knowledge must never cross their authority boundaries.

An empty implementation would merely put two calls under one function, append another packet, or report many concurrent questions while the player still waits through both stages, the Keeper ignores the result, or NPCs acquire information they could not know.

## Solution

Extend the existing host preparation and final context projection into the single owner for foreground material preselection and automatic NPC response advice. Reuse one immutable authoritative snapshot where possible. Start independent, already-supported questions together. Supply a full Keeper evidence projection to material selection and separate limited perspectives to NPC decisions. Reuse the existing Jev credential resolver, decision adapter, task budgets and canonical read interfaces.

An onstage person with ready character material and response candidates can be considered immediately, alongside material selection. Their response need not wait for a relevance result about their dossier. A referenced person elsewhere can contribute history without being made to act. If character material or candidates are missing, their existing tool-enabled background author can continue preparing them while ordinary Keeper play proceeds.

The final projection combines current evidence and advisory NPC intentions under one request budget, preserving their different authority and avoiding duplicate text. The Keeper remains responsible for speech, action and interpretation; world consequences still require the existing resolve/apply and delivery paths. No NPC is obliged to speak merely because the preparation considered them.

## User Stories

1. As a player, I want the Keeper to receive useful evidence and NPC intentions together, so that I do not wait through two independent preparation phases before a response.
2. As a player, I want a person's established personality to continue shaping their response, so that integration does not flatten everyone into the same helpful assistant.
3. As a player, I want specific shared events and promises to affect later cooperation, so that the person remembers our relationship rather than only a party-wide attitude.
4. As a player, I want relevant NPCs to answer, set conditions, refuse or allow natural closure, so that their own priorities remain visible without taking over the scene.
5. As a player, I want a completed decision or departure respected, so that preparation does not invent another confirmation or errand.
6. As a player, I want ordinary greetings and already-supported questions to remain light, so that extra planning is not required merely to demonstrate the optimization.
7. As a player, I want an NPC mentioned in conversation to remain where the world state places them, so that discussing someone does not summon them or give them a remote response.
8. As a player, I want whispering, private discoveries and another person's secrets kept out of an NPC's perspective, so that optimized decisions do not make that person omniscient.
9. As a player, I want unavailable or incapacitated people excluded from executable response suggestions, so that death, unconsciousness or absence cannot be ignored for narrative convenience.
10. As a player, I want a slow optional document read to preserve an independently ready NPC suggestion, so that unrelated work does not erase useful preparation.
11. As a player, I want a slow NPC judgment to leave other ready evidence usable, so that one person does not block all preparation.
12. As a player, I want missing personality or response candidates prepared in the background, so that first contact does not wait for a full character profile.
13. As a player, I want accepted personality and reunion history to survive reload and feature toggles, so that optimizing delivery does not reroll the person I met.
14. As a player, I want on-demand reunion continuity preserved, so that nobody needs to simulate offstage turns before I can meet an NPC again.
15. As a player, I want provider failure to preserve normal Keeper play, so that an optional optimization does not turn into a new gameplay gate.
16. As a player, I want actual end-to-end waiting measured, so that fewer tool calls or faster component timings do not conceal a slower experience.
17. As a Keeper, I want authoritative presence and identity supplied by the kernel, so that I do not need a model to rediscover the roster from prose.
18. As a Keeper, I want dossier relevance and response relevance distinguished, so that already having an NPC's facts does not suppress that person's appropriate reaction.
19. As a Keeper, I want a useful non-present person's history without an action suggestion, so that evidence retrieval and onstage behavior remain separate decisions.
20. As a Keeper, I want each ready NPC's response applicability and intention considered together where independent, so that the host avoids serial classification roundtrips.
21. As a Keeper, I want no-response and no-suitable-candidate outcomes available, so that finite candidate sets cannot force behavior.
22. As a Keeper, I want suggestions grounded only in each person's legitimate perspective, so that my private briefing does not become their knowledge.
23. As a Keeper, I want reports, beliefs, commitments and accepted world facts visibly distinguished, so that preparation does not silently promote uncertain information.
24. As a Keeper, I want response suggestions treated as possible intentions, so that a selected intention is not mistaken for something already done or said.
25. As a Keeper, I want an explicit response-evaluation read to reuse current preparation, so that I can inspect alternatives without duplicating compatible automatic work.
26. As a Keeper, I want to answer directly or choose another response, so that optional advice supports judgment without becoming an obligation.
27. As a Keeper, I want exact promises and their attribution preserved when context is deduplicated, so that shorter packets retain who promised what to whom.
28. As a Keeper, I want missing, failed, timed-out and stale evidence distinguished, so that an unfinished decision is never represented as irrelevance or silence.
29. As a maintainer, I want shared source/world/memory reads reused at their existing owners, so that the same snapshot is not loaded once per NPC and again for preselection.
30. As a maintainer, I want one shared foreground Jev capacity owner, so that combining features does not multiply independent concurrency pools.
31. As a maintainer, I want every nested call charged once to its actual owner, so that cancelled or partially completed work does not acquire a fresh hidden budget.
32. As a maintainer, I want one automatic preparation deadline per accepted input, so that repeated context hooks, tools and retries cannot renew the wait allowance.
33. As a maintainer, I want finalization time reserved inside that allowance, so that completed work can still be checked and delivered when another group is slow.
34. As a maintainer, I want NPC advice revalidated at the final handoff, so that background relationship or candidate updates cannot make an early result stale while other work runs.
35. As a maintainer, I want cancellation, session changes and worldline changes to invalidate the correct work, so that one input or campaign never receives another's suggestions.
36. As a maintainer, I want repeated identical preparation requests to share current work, so that context reconstruction does not duplicate provider calls or background authors.
37. As an operator, I want preselection and NPC advice activation to retain their separate meaning, so that disabling material preselection does not unexpectedly disable existing NPC behavior.
38. As an operator, I want all Jev consumers to use the established credential extension, so that disabled, cleared or unmounted credentials cannot be revived by another route.
39. As a tester, I want proof of actual request delivery and observed Keeper use, so that a selected or prepared packet cannot stand in for an improved interaction.
40. As a tester, I want matched configurations and adverse runs retained, so that unrelated provider, model, source or build differences do not masquerade as integration benefits.
41. As a maintainer, I want changes coordinated with the material-supply owner, so that a shared checkout does not lose another task's ongoing repairs.
42. As a maintainer, I want this integration to reuse the current preparation interface, so that the feature does not introduce another orchestration framework or gameplay authority.

## Implementation Decisions

### 1. Integrate at the existing host preparation seam

The existing Keeper preparation/context owner coordinates both foreground branches. The NPC module continues to own limited perspectives, response evaluation, readiness and background preparation. The material-supply module continues to own discovery, actual evidence, source qualification and material validation. Internal calls replace the independent automatic NPC wait followed by a separate preselection wait.

Prefer composing the existing read, decision and projection interfaces. Do not add a public Keeper verb, a second context policy, a general workflow engine or another fact store. Publish required contract changes before code changes. The integration must work on the current TypeScript production path; the retired Python kernel is not an implementation option.

### 2. Distinguish data already present from behavior still needed

The kernel's current roster and canonical identity resolution establish existence and presence. A model may judge conversational relevance, but may not create presence, grant perception, revive an incapacitated person or treat a proposed player action as settled.

Material preselection asks whether the Keeper lacks useful evidence. NPC evaluation asks whether and how this person could respond to the current input. A material skip caused by evidence already being supplied cannot suppress a response decision. Conversely, relevant history about an absent person does not authorize an offstage reaction. Ordinary direct answers, non-intervention and natural closure remain valid outcomes.

### 3. Share authoritative loading without sharing private model views

Reuse a compatible immutable world/graph/memory/record snapshot through its current reader. Avoid rediscovering names and repeatedly loading the same evidence for the two branches. Extend the existing snapshot interface only where the current public behaviors cannot be composed safely.

From that shared input, create distinct projections: the Keeper can receive its full private evidence; each NPC decision receives only its established personality, goals, legitimate knowledge, attributed reports, directed relationship history, commitments, recent own speech and compatible continuity. A full NPC dossier may contain Keeper-only commentary and cannot simply become the NPC decision prompt. Reuse is permitted only for identical authority, scope and content, not because two objects have the same name.

Presence alone is not proof that every part of a player utterance was perceived. Existing knowledge/disclosure authority remains binding, including private or proposed acts. This integration must not infer perception from keyword rules or treat the whole Keeper context as public scene knowledge. If the existing owner cannot establish a safe perceived fragment, withhold the affected suggestion rather than introducing a new general perception system.

### 4. Dispatch independent questions immediately

For a prepared NPC, assess response relevance, conditional applicability and offered intentions concurrently where all judgments can use the same known input. A host may discard a speculative intention when the simultaneous relevance result says it is unnecessary. The choice does not consume scores that have not yet returned. Keep an explicit none/unknown exit.

Independent material groups and compatible NPC groups use the same scheduler concurrently. Incompatible private perspectives use separate batches, also concurrently. The user's 430-question example illustrates that many independent judgments are affordable in parallel; it is not a fixed batch size, a promise of 430 HTTP requests or a reason to make every NPC act. Packing, actual provider limits, budgets and load govern capacity.

Dependencies remain real. If a response requires missing evidence or a new candidate, its dependent judgment cannot use the absent result speculatively as fact. Optional source work does not become a prerequisite for all already-ready NPC groups. Omit unconsumed diagnostic scores from the critical path while preserving the explicit diagnostic read.

### 5. Use one foreground decision and budget owner

Inject the same configured decision adapter/capacity owner into the material and NPC branches. Reuse the existing shared Jev credential resolver and task/provider-budget interfaces. Do not retain a private NPC concurrency pool alongside a private preselection pool for the same preparation epoch.

If a canonical foreground task exists, its remaining capacity and writer reserve govern the combined work. Otherwise declare one bounded owner for automatic preparation. Child work receives a share of remaining limits, never an independent replacement budget. Record dispatched/undispatched and known/unknown usage conservatively; reservations must not be charged twice or refunded merely because no packet was delivered.

Reuse the current scheduler's foreground priority for time-sensitive work. Tool-enabled background authors retain their own existing bounded scheduling and publication ownership; adding this integration must not wait for them, spawn a second author for an already-owned claim, or spend the foreground writer reserve on speculative preparation.

### 6. Replace additive automatic waits with one absolute deadline

Start the shared automatic allowance once after mandatory baseline preparation for the accepted input and before either optional branch begins. Mandatory input/preflight time is measured separately. When both features are enabled, the initial total allowance is at most the existing six-second prescreen allowance, not six seconds plus the old NPC wait. NPC-only mode retains its existing configured allowance; the current default is 1250 ms, capped at 2000 ms. These are initial ceilings, not minimum waits, speed claims or a player-facing SLA.

When both branches run, the NPC child retains its shorter configured limit inside the same outer deadline. Time spent queueing, reading, classifying or rechecking counts toward the relevant remaining allowance. Repeated contexts, retries, state invalidation and tool roundtrips in the same accepted input do not renew the outer deadline. Use existing configuration ownership; do not add a separate settings system to implement these rules.

Reserve finalization time within the outer allowance. Publish a valid partial result when optional semantic work exhausts its child budget, provided final owner checks finish before the original outer deadline. A ready child must not be discarded only because a peer timed out. Parent cancellation, stale ownership and outer expiry still forbid publication. Return early when useful work has settled; do not deliberately idle until a timer expires.

### 7. Preserve complete pieces and explicit gaps

Track results by their actual branch and authority. A completed NPC intention may remain usable when optional PDF material is unavailable; useful material may remain when NPC advice has no fit. An unfinished classification is unknown, not a negative relevance verdict or a decision for silence.

Only completed outputs with all of their own dependencies satisfied are eligible. A partial response bank, unchecked source claim or expired result cannot be dressed as a validated suggestion. Ordinary canonical reading remains available for genuinely required missing material; its later cost is measured in total player wait. The integration cannot bypass source/visual qualification just to finish preparation early.

### 8. Revalidate at final delivery, including early NPC results

An NPC result that was current when its short task finished may be stale after another branch has spent several seconds reading. Recheck its dependencies at final request assembly, inside the remaining finalization budget. Bind results to the exact player input, session, campaign/worldline/loop, NPC identity and availability, personality/source material, relevant memory/relationship/commitment state and candidate-bank revision. A memory-only or bank-only update can invalidate advice even if the world turn number is unchanged.

Material supply retains its existing source, rule, memory, record and state checks. Use the existing revision owners rather than creating another incompatible revision system. Compatible validated evidence may be reused; changed relevant dependencies require recomputation only if the existing budget permits, otherwise omit the stale piece and continue normally. Report final omission honestly.

Session restart, switch, fork, new player input and cancellation retire old work. Temporary advice is not campaign history. Canonically accepted personality, relationship evidence and reunion history remain durable and are not deleted when temporary preparation is retired.

### 9. Make reuse independent of packet self-injection

Bind same-input work to authoritative snapshot dependencies and declared configuration. Share in-flight and completed compatible work across repeated host contexts. The preparer's own optional message must not be mistaken for new player intent, new evidence or a reason to repeatedly rerun itself.

Compute actual retained context and its budget through the existing final projection. Byte-budget changes can require repacking without requiring another semantic call when evidence and judgments are unchanged. A removed body cannot continue to satisfy an evidence-availability claim. Advice remains advice even if it appears in a later selection preview.

### 10. Compose one handoff while preserving authority and important evidence

The current final context owner accounts for materials and NPC advice together with system, tool and output reserves. It may use the existing distinct private message types; one owner does not require flattening them into an indistinguishable text block. Facts, reports, suggestions, coverage gaps and ordinary follow-up reads remain recognizable.

Keep each NPC intention conditional and associated with the correct person. Do not include opaque host IDs, secret credentials or completion statistics in player-facing prose. Use exact host-controlled deduplication of evidence occurrences, preserving direction, attribution, targets, corrections and fulfillment state. In particular, do not repeat the same promise in a new NPC field until an older canonical promise is pushed out of the budget. Preserve complementary evidence and distinct repeated utterances.

If useful detail must be omitted, retain the established bounded-read route and explicit coverage. Integration may change packing but must not silently enlarge context limits, displace current player input/pending choices, or treat an omitted packet as delivered.

### 11. Keep authors and deferred writes in the background

Personality creation, response-bank creation/refresh, parameter work already supported by existing owners, derived memory indexing and nonessential writeback remain background work. Relevant current or upcoming encounters can request existing owned preparation; catalog discovery of every module NPC is not a command to generate every person.

Failures retry through existing claim, cancellation and stale-publication rules. Accepted personality is not rerolled, and source incompleteness is not automatically treated as source silence. No-fit can enqueue one compatible refresh rather than block the current Keeper response. Canonical gameplay effects still commit synchronously through their required owner; a promise, transfer or action cannot be narrated as completed while its necessary transaction is merely queued.

### 12. Preserve optional-feature semantics and the explicit read

Material preselection and automatic NPC advice retain their distinct activation meaning. Combining scheduling does not automatically enable preselection whenever a key exists, and disabling preselection must preserve currently enabled NPC advice. Disabling NPC advice leaves material retrieval available. With neither enabled, there is no automatic Jev preparation work; durable NPC material still reaches ordinary views.

Respect the current managed-session mount/settings rules and source-mode overrides. Credential clearing, unmounting and refresh follow the established resolver lifecycle; no direct compatibility-key reader or new auth store is permitted.

The Keeper's explicit NPC response-evaluation read remains available. Reuse a compatible completed result first. A genuinely new explicit request follows its normal tool/task budget; it does not silently reset the automatic allowance. There must be exactly one automatic owner after cutover, not both the old hook and the integrated path racing to supply advice.

### 13. Keep Keeper and kernel authority unchanged

The producer of a response intention is the existing NPC author/evaluator; its reader is the current Keeper request; its actor is the Keeper using normal tools and narration. The producer of evidence remains its source/state owner; the preparer reads and projects it without changing its truth or visibility.

The Keeper may use, adapt or reject advice. Source facts, player choices, action admission, Mod checks, rule arithmetic and canonical world writes remain authoritative. Considering an NPC is not forcing them to perform, and considering a player proposal does not authorize it. Adoption telemetry never becomes a later narrative obligation.

### 14. Observe delivery and use, then claim benefits only from matched evidence

Use the existing public request observation hook to establish what the actual provider payload retained after all projection and conversion. Record bounded correlations, branch outcomes, material/intent digests, source scope, timing, cancellations, omissions and actual costs. Never record credentials or arbitrary private prompts just to count delivery.

Distinguish discovered, selected, prepared, validated, retained, delivered and used. Actual Keeper behavior and canonical receipts establish use; inference from packet presence is insufficient. Measure accepted-input-to-first-provider-request and accepted-input-to-delivered-player-response, plus overlapping phase timings, duplicate reads, actual peak concurrency and background publication timing. Do not sum overlapping spans as elapsed player time.

### 15. Integrate with the current material-supply work without taking it over

The observed baseline is NPC implementation commit `fe8e92b45`, Pi 0.87.0 upgrade `60558af7d` and shared Jev credential/activation commit `85faec8b4`. Material supply for #108 is still being edited and accepted in the shared worktree. Its timeout/partial-delivery and source-qualification repairs must be respected; this specification does not declare them finished.

Before modifying overlapping contracts or preparation interfaces, establish one writer and a concrete interface handoff or accepted integration revision. Independently useful NPC-side work may proceed within approved scope. Do not absorb unrelated provider, SDK, packaging or driver work into this feature. Integration depends on the relevant #108 interfaces and finalization behavior being available and verified, not on pretending that every unrelated performance/release gate of #108 is already complete.

## Testing Decisions

### Primary seam and success criteria

The user confirmed the primary seam as the actual Keeper request followed by real player interaction. Test through the existing session/context hooks, real TypeScript kernel reads and canonical player-turn route. A good test observes delivered content, provider dispatch, retained authority, elapsed waiting or persistent state; it does not merely assert a helper was called, an event was emitted or a new field exists.

At the same seam, successful integration must show that material preparation and NPC decisions overlap where independent, do not duplicate the same snapshot/decision work, and produce useful content in the real outgoing request. The ensuing NPC behavior must preserve personality, concrete relationship causes and player choices. Performance acceptance additionally requires a measured player-wait benefit or a clearly reported unresolved result; functional integration alone cannot be called a speedup.

### Deterministic interface cases

Use actual host/kernel owners and controlled external-provider responses for timing, cancellation and failure cases. These are component/contract tests and must never be reported as gameplay.

| Case | Required observation |
| --- | --- |
| Ready NPC and ready material | Both independent branches dispatch before either must settle; the resulting request contains current evidence and a conditional NPC intention. |
| Same NPC data already supplied | The redundant dossier read is omitted/reused while an appropriate response can still be selected. |
| Relevant absent person | Their history can reach the Keeper, but they do not acquire presence or a remote response. |
| Distinct private views | Each NPC decision payload excludes other people's private discoveries and Keeper-only evidence, including unsupported premises hidden in candidate text. |
| Slow material branch | A ready NPC result survives as a candidate for partial delivery, subject to final freshness checks; no second automatic allowance is created. |
| Slow NPC branch | Useful checked material survives; an NPC timeout is an explicit unavailable result, not a fabricated choice. |
| Deadline and finalization | Remaining time propagates, final checks occur before the outer deadline, and parent cancellation or outer expiry prevents late publication. |
| Background update during preparation | A changed relationship, promise state, personality, presence or response bank invalidates affected early advice at final handoff. |
| Repeated contexts and explicit lookup | Compatible work is reused; host continuations and packet self-injection do not duplicate calls or renew the deadline. |
| Tight context budget | Exact promises, attribution and complementary evidence are preserved; omitted materials do not count as supplied or delivered. |
| Missing/failed preparation | Existing background owners publish after foreground progress; retry claims remain safe and accepted personality is not rerolled. |
| Activation combinations | Both-on, each-alone, both-off, missing/cleared credentials and unmounted managed sessions retain the declared semantics and ordinary game behavior. |
| Session/worldline transition | Old temporary results cannot enter the new context, while durable accepted character history remains available. |
| Shared capacity and accounting | Total actual concurrency obeys one configured limit, calls debit the proper owner once, and exhausted capacity cannot be replaced with an independent child allowance. |

Prior art is the existing final-payload material-supply tests, NPC real-RPC publication/read/reload tests, directed-knowledge tests, background claim-retry and session-isolation tests, concurrent decision/freshness tests, task-budget tests and capsule promise-preservation regressions. Extend those interfaces rather than introduce a separate orchestration simulator.

### Real experience and latency comparison

Use the project's canonical RPC play driver. Grok Build 4.7 fast with low thinking is the current default Keeper; the main session is the sole player, submitting one natural input at a time. Resume first when continuing a campaign. Do not use scripted players, synthetic turns, fake Keepers or edited campaign state as acceptance. Retain every campaign, source, turn and adverse result.

Cover a focused scenario set through normal play: a direct conversation with a ready NPC; a request whose response depends on a concrete shared event or promise; several present people with different priorities; mention of an absent person; natural refusal or farewell; and a reunion that reuses accepted continuity. At least one real turn must require both useful supplemental material and an NPC intention, so simultaneous packet delivery is not inferred from separate unrelated examples. Include an existing PDF-backed scenario where relevant material retrieval actually participates, without turning this feature into a broad source-import project.

Compare the existing separate preparation with the integrated preparation under the same frozen runtime, source, model/thinking, feature settings and accepted campaign basis. Begin timing only after any automatic opening settles. State whether starting histories are byte-equivalent or merely matched. Story/dice divergence, unequal caches, concurrent mutable builds or changed providers invalidate a strict causal speed comparison; retain them as qualitative observations instead. An NPC-only case also checks that integration does not add a material-preselection wait when that feature is disabled.

Report actual selected intention, what the Keeper did with it, relevant receipts, requested/settled player choices, actual materials in the outgoing payload, full player wait, request/phase timings and usage. A 430-question synthetic diagnostic can prove parallelism but cannot substitute for these scenes or establish player-experience improvement.

Run appropriate typechecks and focused integration regressions during implementation, then the required broad suites after stabilization. Report existing unrelated failures separately; never change a frozen oracle or baseline to conceal a regression. Source functionality, semantic quality, performance, separately enabled runtime routes and canonical installed-App acceptance remain distinct claims.

## Out of Scope

- Continuous offstage NPC simulation, separate full NPC agents, independently executed NPC actions or complete dialogue scripts generated outside the Keeper.
- Replacing source reading, visual qualification, rules, admission, Mods, memory authority, the task runtime or the existing context policy with another framework.
- Rewriting #108's source-supply work or solving its unrelated source-import/performance blockers under this ticket.
- A new global entity parser, keyword-based intent/perception classifier, hand-authored behavior bank or semantic rules table.
- Generating every NPC in a module, rerolling accepted personalities, rewriting established reunion history or migrating all old campaigns.
- New NPC statistics functionality, a new credential route, SDK upgrades, provider catalog changes or unrelated packaging fixes.
- A compulsory response from every considered NPC, a new player decision, or an obligation to follow every suggestion.
- Raising request/context budgets or per-turn wait limits to hide unsuccessful integration.
- A fixed speedup percentage, latency SLA or claim that more concurrent questions alone improve complete player turns.
- Push, deployment, App installation/restart or broad release work solely because this spec is published.

## Further Notes

**External cross-check.** [TypeSafe's speculative fan-out guidance](https://docs.typesafe.ai/patterns/fan-out) supports issuing independent questions together and using only relevant results afterward. It validates concurrent response relevance/applicability/choice where they share an already-known input; it does not establish privacy isolation between NPCs or justify evaluating a dependency before its evidence exists. The local design therefore batches within compatible perspectives and overlaps separate batches.

[gRPC deadline guidance](https://grpc.io/docs/guides/deadlines/) supports explicit deadlines, remaining-time propagation and realistic load-based tuning. It confirms the need to replace additive stage allowances with one outer budget. It does not prescribe six seconds or 1250 ms for this game, and does not guarantee speedup; the initial ceilings come from current product behavior and require player-wait measurement. This feature uses the existing runtime, not a new gRPC dependency.

**Current evidence versus future claims.** NPC material persistence and one live adopted Jev intention have scoped evidence from the prior feature. The current preselector already reads NPC dossiers. Neither observation proves the combined scheduler, privacy isolation across the combined pass, final-handoff freshness or latency improvement specified here. The material-supply acceptance record remains in progress. Publication of this spec must not change those statuses into an implementation or release claim.

**Implementation handoff.** First pin the relevant material-supply interface and contract changes. Then integrate shared lifecycle/reads/capacity with NPC-alone compatibility, exercise partial-result/freshness/output-budget cases, and finally run the agreed real-request/player-experience comparison. Keep the main success question visible throughout: does the player get a timely, coherent response from this particular person, with their relationship and choices intact?
