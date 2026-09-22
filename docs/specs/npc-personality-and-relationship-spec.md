# NPCs with personality, agency, and relationship memory

Tracker: [#102](https://github.com/Leehow/chatrpgv4/issues/102), labeled `ready-for-agent`.

Status: source implementation, scoped real-play verification and review are complete under #103–#107; broader performance, separate typed-loop and installed-App acceptance are not claimed. See [the active implementation record](../active-plans/npc-personality-and-relationships.md) for completed slices and remaining acceptance gates. The published parent specification remains unchanged. Prepared with the explicitly invoked to-spec workflow on 2026-09-21. This is the implementation specification for the agreed NPC experience; the earlier discussion document and prototype remain supporting evidence.

The main feature is a better NPC experience: a recognizable person with their own priorities, a memory of their relationship with the player, and continuity when they meet again. The player keeps the spotlight. This uses the existing NPC and Jev architecture, including issue [#101](https://github.com/Leehow/chatrpgv4/issues/101).

The user's additional requirements are implementation constraints in support of that feature: exploit many concurrent, independent Jev decisions; move deferrable NPC preparation and writes off the foreground path; and use the existing unified Jev authentication extension. They are not separate runtime-refactor deliverables or substitutes for NPC behavior acceptance.

## Problem Statement

Players should meet people with recognizable personalities, their own priorities, and memories of what happened between them. A cautious, loyal person and a pragmatic negotiator should not merely use different wording while making the same choices. Returning to someone who remembers help, betrayal or a kept promise should change the interaction in an understandable way.

The existing product already has authored NPC material, knowledge and belief relations, a receipt-backed ledger, memories, social mechanics, first impressions and voice. These supply useful context to the Keeper, but do not yet form a complete, tested path from individual personality and relationship evidence to bounded response choices. A party-wide attitude alone cannot express different relationships with different investigators.

The player should experience consequences through the person: gratitude can coexist with caution; a kept promise can make future cooperation easier; an unrepaired betrayal can change the conditions offered. These reactions should remain natural, rather than becoming numerical relationship menus or compulsory personality performances.

Attention remains on the player. NPCs can initiate relevant responses, refuse, help, or simply return to their work. They should not manufacture tasks or prolong a completed exchange to demonstrate autonomy. Nor does continuity require a continuously simulated offstage society: a plausible intervening story can be generated at the next encounter and preserved once established.

This experience should remain responsive. A greeting should not wait for a complete character sheet or unrelated background work, and an NPC should not forget a recent conversation while a derived memory index catches up.

## Solution

The player-facing feature has four parts:

1. **A recognizable personality.** Use authored descriptions first; generate a coherent, varied supplement when the source is silent. Preserve the accepted person across turns and reloads, with room for justified development.
2. **A relationship built through play.** Retain specific shared experiences, promises and conflicts, directed at the people involved. Bring the relevant causes back when they matter to the current exchange.
3. **A response chosen for this person and situation.** Combine personality, current goals, relationship, pressure and limited knowledge. NPCs can answer directly, set conditions, refuse, initiate something relevant or do nothing. The Keeper turns these intentions into natural speech and conduct.
4. **Continuity at reunion.** Generate the missing intervening story when needed from the last state, elapsed game time and established events. Save accepted details so subsequent meetings continue the same history, without offstage simulation.

For example, three people may respond to a request to keep a sensitive ledger by insisting on a proper custody record, offering discreet help, or negotiating terms. The same person's willingness to lend a cart can change because the player previously returned it responsibly or lied about returning it. Those differences must reach actual player-facing behavior, not remain unused fields.

Implementation supports those outcomes with concurrent Jev judgment over independent questions, background preparation and deferrable writes, and the existing shared Jev authentication extension. The Keeper remains responsible for semantic decisions and performance; the kernel remains responsible for mechanics, authorized changes and durable world state. None of these supporting mechanisms constitutes success without the four NPC experiences above.

## User Stories

1. As a player, I want NPCs with different personalities to weigh the same request differently, so that people feel distinct through behavior.
2. As a player, I want personality to influence conditions, refusals and initiative as well as wording, so that individuality is more than a voice effect.
3. As a player, I want a person's established character to survive reloads, so that I meet the same person again.
4. As a player, I want an NPC with little authored detail to gain a coherent personality, so that minor characters can become memorable.
5. As a player, I want generated traits to fit established descriptions, so that supplementation does not contradict the scenario.
6. As a player, I want nuanced personalities with competing values, so that characters can surprise me without becoming arbitrary.
7. As a player, I want major experiences to permit justified character development, so that stability does not prevent growth.
8. As a player, I want ordinary cooperation to remain possible for cautious or quiet people, so that personality labels do not force obstructive behavior.
9. As a player, I want an NPC to remember a specific favor, so that help can influence future choices.
10. As a player, I want an NPC to remember deception or a broken promise, so that my conduct has persistent consequences.
11. As a player, I want repaired relationships to reflect subsequent events, so that one mistake does not permanently flatten a person into hostility.
12. As a player, I want gratitude and fear to coexist, so that helping me need not be unconditional.
13. As a player, I want an NPC to distinguish different investigators, so that one person's history is not assigned to the entire party.
14. As a player, I want relationship direction to be preserved, so that my feelings do not determine another person's feelings.
15. As a player, I want remembered promises to retain their actual terms, so that a return visit does not rewrite what was agreed.
16. As a player, I want fulfilled promises to remain fulfilled, so that retries or reunions do not duplicate rewards.
17. As a player, I want NPCs to act only on information available to them, so that the mystery remains coherent.
18. As a player, I want hearsay and mistaken beliefs to remain attributed, so that a character can be wrong without changing world truth.
19. As a player, I want speculation to remain speculation, so that guessing a secret does not give an NPC new knowledge.
20. As a player, I want a character to admit uncertainty, so that missing knowledge does not produce invented testimony.
21. As a player, I want direct questions to receive direct answers when appropriate, so that every conversation does not become a negotiation.
22. As a player, I want NPCs to initiate relevant responses, so that they can have their own priorities.
23. As a player, I want NPCs to decline involvement when appropriate, so that independence does not become constant intervention.
24. As a player, I want a natural goodbye to end an exchange, so that characters do not create unnecessary obligations.
25. As a player, I want my actual words, including negation and hypotheticals, to matter, so that keyword matches do not invent actions.
26. As a player, I want my next decision to remain mine, so that an NPC suggestion does not authorize my behavior.
27. As a player, I want multiple NPCs to react coherently, so that independent suggestions do not create incompatible simultaneous outcomes.
28. As a player, I want voice to express the current response naturally, so that personality does not become repeated slogans.
29. As a player, I want routine conversation to start with the material already available, so that optional preparation does not make me wait.
30. As a player, I want missing irrelevant NPC statistics to be prepared later, so that a greeting does not require a complete character sheet.
31. As a player, I want an action to use a required NPC parameter once it is lawfully available, so that deferred work never produces fabricated rolls.
32. As a player, I want later choices to see recent committed interactions even if indexing is delayed, so that background processing does not make an NPC forget.
33. As a player, I want returning NPCs to have plausible intervening experiences, so that the world feels continuous without offstage simulation.
34. As a player, I want a quiet interval to remain possible, so that every reunion does not force a new subplot.
35. As a player, I want accepted reunion details to persist, so that another visit does not regenerate a different past.
36. As a player, I want generated offstage stories to respect elapsed game time and known events, so that the continuation is plausible.
37. As a player, I want my offstage decisions never to be invented, so that a reunion cannot retroactively spend my money or choose my actions.
38. As a player, I want an NPC's account to remain their account when unverified, so that statements and established events are not confused.
39. As a Keeper, I want concise personality, relationship and memory evidence, so that I can portray the person without reading a scoring dashboard.
40. As a Keeper, I want existing valid response candidates to be reusable, so that every exchange does not need a new planning call.
41. As a Keeper, I want new candidates when the existing set is inadequate, so that finite selection does not limit the fiction to fixed templates.
42. As a Keeper, I want a no-suitable-candidate result, so that the system does not force an irrelevant action.
43. As a Keeper, I want Jev suggestions to remain advisory, so that I can account for the current exchange and actual outcomes.
44. As a Keeper, I want exact existing material supplied by host references, so that models do not retype names, passages or identifiers.
45. As a player, I want the independent judgments behind a response evaluated together, so that a detailed character does not make every interaction slow.
46. As a player, I want only genuinely necessary missing information to delay an action, so that unrelated NPC work can finish later.
47. As a player, I want pending preparation to recover after restart without changing accepted history, so that background work remains dependable.
48. As an operator, I want NPC optimization to use the existing shared Jev extension, so that it requires no separate key or authentication setup.
49. As an operator, I want clearing, disabling and rotating that shared credential to retain its existing semantics, so that NPC work respects the same configuration as other Jev features.
50. As an operator, I want secrets absent from all NPC content and diagnostics, so that observation does not disclose credentials.
51. As a player, I want normal Keeper play to remain available when optional assistance fails, so that a classifier outage does not stop an answerable exchange.
52. As a player, I want accepted personality and history readable when the optimization is disabled, so that established people do not disappear.
53. As a player, I want an existing campaign to improve when I meet relevant people, so that enabling the feature does not rewrite everybody in advance.
54. As a tester, I want controlled evidence showing which inputs changed decisions, so that personality and relationship effects can be understood.
55. As a tester, I want genuine multi-turn interactions and reunions, so that richer data alone is not mistaken for better NPCs.
56. As a tester, I want actual response timing, concurrent dispatch and delayed-background behavior recorded, so that technical improvements support responsiveness.
57. As a tester, I want model, runtime, credential route and activation recorded without secrets, so that tests represent the intended product path.
58. As a tester, I want adverse examples and incomplete outcomes preserved, so that reported gains are bounded by the actual evidence.

## Implementation Decisions

### 1. Preserve existing authority and keep the feature cohesive

Extend the existing NPC material and projection module, memory owner, task runtime and canonical operation dispatcher. There is one identity per NPC and one accepted state per campaign scope. Do not create a second NPC graph, an independent world store or a new public gameplay verb family.

The externally visible behavior remains the existing Pi gameplay entry and its look/recall/resolve/apply/narrate/ask sequence. A private NPC decision task may be added to the unified task runtime. It owns evidence assembly, readiness, batching and advisory results behind that existing interface; it is not another autonomous Keeper.

The first implementation slice updates the governing NPC, memory, dossier, task and publication contracts before production code. Existing ontology, actor authority, source-reference, first-impression and social-mechanics contracts remain binding. The retired Python product is not an implementation source.

### 2. Separate durable character material from derived interpretations

The minimum semantic planes are: authored character evidence; accepted generated personality supplements; directed relationship events and interpretations; knowledge and beliefs with provenance; current situation and goals; pending commitments; and accepted reunion material. They are views over existing owners rather than copies of all history.

Each accepted supplement binds the canonical NPC identity, campaign/worldline/loop, source and material revisions, origin, acceptance operation and relevant evidence. Generated content is labeled generated, not source-authored. Existing statements are materialized through host-issued references. Opaque identities, digests, paths and offsets remain host-owned.

Relationships are directed and target-specific. A shared event has participants and source evidence; a derived interpretation identifies whose view it represents and may be disputed or superseded by later evidence. Existing party stance is retained for its current consumers but is not the only representation of personal relationships. Derived summaries cannot create world facts or overwrite the events they summarize.

Personality is a persistent tendency described in concrete prose, not a universal vector of mandatory numbers or a personality-type registry. Current mood, pressure and goals are interpreted in context. Major experiences may justify explicit, source-linked evolution without rewriting the original authored description or old turns.

### 3. Make NPC material a core persistence responsibility

Accepted personality, relationships and reunion history belong to the existing campaign NPC/memory authority and remain readable when Jev routing is disabled. Voice remains presentation owned by its existing mechanism.

Do not put the only copy of established personality or history in an optional package namespace whose disabled state hides the material. If an existing package contributes initial descriptive material, the accepted campaign material must retain its explicit origin and independent continuity semantics. Implement this as a declared extension of the current owner, not a direct write to storage.

Legacy campaigns are read compatibly and enriched only when relevant. No bulk re-generation, silent package upgrade or destructive migration is required. Existing source-authored and accepted values win over a new speculative proposal. Conflicts with later discovered source material remain explicit and retain the prior evidence.

### 4. Generate personality once, on demand or ahead of a relevant encounter

Extract personality implications from authored descriptions first. Where the source is sufficiently inspected and silent, a tool-enabled Keeper or existing Pi author task may supply a coherent, varied supplement constrained by known identity and circumstances. Source incompleteness is not proof of source silence.

Generation may express competing values and behavior under pressure, but does not silently create family members, secrets, capabilities, assets or scenario truths. Such additions require their ordinary owners when actually needed. No semantic classification is implemented with name, gender, language, occupation or keyword lookup tables.

The host pins one preparation identity for the missing material. Concurrent demand, retries and restarts reuse it. A ready result is published only against its current claim and dependencies. Once accepted, the same personality is read at later encounters; service failure and retry do not reroll it.

If no supplement is ready, the Keeper may use existing authored and committed material. First contact does not require waiting for a complete generated profile. A newly generated trait that is deliberately established during the turn must be recorded through the minimal accepted-material operation before delivery treats it as durable character history.

### 5. Build each NPC's authorized perspective before evaluating meaning

A memory about an NPC is not necessarily a memory known by that NPC. The perspective projection distinguishes authored knowledge, established perception or disclosure, attributed reports, beliefs and unknowns. It does not turn player assertions into shared facts or transfer another person's private knowledge merely because the people share a scene.

Existing evidence ownership and scope establish availability. Jev can judge relevance and attribution proposals, but cannot itself grant knowledge. Candidate descriptions must also be checked for unsupported factual premises; removing a secret from the facts list while leaving it in an offered response is insufficient.

Use separate batches for incompatible private views by default. Public scene material may be shared only when each consumer is entitled to it. A future optimization using question-local private supporting material requires proof of actual model and adapter isolation before use; it is not assumed by this specification.

### 6. Supply meaningful candidates without a mandatory extra planner round

Reuse current authored opportunities, legitimate existing intentions, unresolved commitments and valid previously prepared candidates. The Keeper can submit novel candidates during its ordinary tool-enabled work. An existing tool-enabled author can prepare missing candidates ahead of an encounter or fill a specific generation gap.

Candidates are semantic intentions: desired outcome, target, supported premises, constraints, applicable conditions and possible operation family. They are not prewritten dialogue or already executed actions. Host-issued aliases bind to full current material and legal operation options.

The repertoire is open: a fixed help/refuse/threaten template bank is not the feature. Every finite set provides a no-suitable-candidate escape; directly answering, continuing a valid plan, natural closure and non-intervention remain legitimate when the situation supports them.

Preparation is limited to relevant present or likely-next-encounter people and actual information gaps. This permits broad concurrent evaluation without full-world generation. Candidate coverage and omitted material are explicit. TTL alone does not prove a candidate's premises remain valid.

### 7. Treat all ready Jev questions as a parallel workload

Construct the ready question set before dispatch. Independent memory relevance, personality fit, relationship fit, situational fit, intention validity and applicable closed choices should fan out together whenever their required inputs already exist. An answer needed only in one possible branch can be computed speculatively and ignored when that branch is not used.

There are two complementary levels of parallelism:

- Within one authorized, immutable state, pack many independent questions into the same provider request, subject to shared model and packing limits.
- Across independent views or capacity-split batches, submit ready batches concurrently through the shared decision runtime and provider budget, instead of awaiting each NPC or batch in a loop.

The prototype's two-worker queue, 34 requests and 430 questions are observations, not limits or target architecture. A ready set of 430 independent questions should be eligible for concurrent evaluation as soon as the authorized state and provider capacity permit. It need not fit one HTTP request, and it must not be flattened into one shared private state merely to reduce request count.

Use the shared adapter's configurable concurrency and task decision-group support. Do not freeze the implementation at prototype concurrency two or at the adapter's current default merely because it exists. Size shared capacity using actual service limits, packing estimates, budgets and measured contention. There is one shared concurrency owner; a per-NPC adapter must not multiply the global quota invisibly.

Question packing preserves full candidate sets and required answer coverage. Partition independent questions without dropping answers. A single Choice whose candidate set exceeds its supported bound cannot be split into separately normalized groups and treated as a proven global winner; use an explicit, evaluated staged selection or return insufficient coverage.

Only real dependencies introduce another wave: an answer identifies source material that must be fetched; new candidates must first be generated; an actual roll or world effect changes the state; or a later Choice genuinely requires earlier scores. Choice and Score asked together remain independent. The host may compose scores under an explicit policy, but may not pretend the same-batch Choice consumed them.

### 8. Do not impose a global completion barrier

Each foreground response depends only on the questions and material required for that current decision. Optional analysis for another NPC, speculative alternatives, parameter enrichment and writeback do not become prerequisites for narrate/ask.

The shared runtime may wait for a declared required decision group to produce complete coverage. Optional work is assigned a separate group or background task; it must not be included in that required barrier merely because all work was dispatched together.

Foreground work receives priority and reserved capacity under the existing budget owner. Background work is admitted with bounded concurrency and fairness, yields capacity under contention and never consumes the writer's reserved budget. Rate limiting follows shared bounded policy and deadlines; it does not introduce uncontrolled retries or a new NPC-specific credential pool.

Cancel or retire stale task ownership when input, relevant facts, scene, identity or source revisions change. Ignore late results for the old scope. A reusable result records its actual dependencies; unrelated derived presentation changes should not invalidate it, while mechanically relevant parameter changes must not be mislabeled as presentation to hide invalidation.

### 9. Move deferrable preparation and writes off the foreground path

Background work includes optional personality enrichment, rule-authorized parameter preparation, voice and journal generation, committed-turn memory extraction, relationship indexing or summaries, candidate replenishment and storage of nonessential diagnostic detail. It is scheduled from real demand or committed events, not an offstage simulation timer.

| Work | Foreground behavior | Background responsibility |
| --- | --- | --- |
| Ordinary conversation with adequate current material | Answer normally | Fill optional profile, voice and journal gaps |
| Missing NPC parameters not used by this action | Do not wait for the sheet | Prepare only relevant lawful parameters for future use |
| A required value for the current roll or effect | Reuse/promote the exact owned preparation; wait only for the required value or report the current missing requirement | Continue unrelated values independently |
| Recent relationship event with extraction still pending | Read the committed original and preserve its attribution | Publish annotations and update derived views |
| New durable personality or reunion detail being established now | Accept its minimal authoritative record as part of the normal operation/turn route | Build expanded summaries, indexes and presentation afterward |
| Actual resource, location, knowledge-disclosure or promise-fulfillment effect | Settle through the existing canonical operation and receipt before describing completion | Update derived projections and diagnostics |

Jev selects supplied parameter sources, archetypes or existing scalar alternatives; it does not invent a numeric stat through a Score. Printed values, rule-generated values and lawful Keeper rulings retain their distinct provenance. Missing required numbers are not fabricated, borrowed from the investigator or silently substituted while a background job is pending.

Deferring a write means separating nonessential work from the durable acceptance needed for continuity. It does not mean returning an acknowledged world change before its canonical receipt and existing synchronous turn commit. The existing per-turn history decision remains intact. No LLM/provider request or long computation runs while holding the campaign writer lock.

### 10. Publish background results through recoverable existing owners

Extend the current preparation/job owners with durable intent, claim, dependencies, prepared artifact, acceptance identity and completion status where the NPC work requires them. Derive this work from committed records or persist its minimal job reference in the existing transaction; do not rely only on an in-memory callback that vanishes after delivery.

Generation and evaluation happen outside the writer critical section. The kernel owner rechecks the claim and exact dependencies, accepts compatible results under a short transaction, then acknowledges completion. Retry reuses the same identity; a lost response queries or recovers the existing outcome rather than publishing again.

Draft/prepared work is not world state. Pending, running, ready, accepted, stale, failed and cancelled outcomes must be distinguishable by their existing owner interfaces. Failed optional work leaves existing play available and remains observable. Restart recovery resumes owned durable jobs or uses retained committed originals for derived reads; it never starts duplicate jobs to make an empty queue look complete.

Serialize conflicting publication, not all NPC reasoning. Independent actors or nonoverlapping preparation may compute concurrently. If a relevant field changed, discard/reprepare that result or use an explicitly supported merge; never last-write-wins over a newer personality, relationship, stat or accepted reunion detail.

### 11. Use the unified Jev authentication extension exclusively

All production NPC decision, background, preparation and new diagnostic consumers obtain Jev credentials through the existing shared `readJevApiKey` resolver and shared decision adapter. The existing `jev` extension owns the secret setting `ext.jev.apiKey`; the host vault and launch assembly own delivery through `EXT_JEV_APIKEY`.

There is no NPC-specific key field, settings screen, credential file, token copy or direct vault/credential-file reader. Production callers do not bypass the resolver by supplying a separately sourced adapter key. The adapter's explicit test injection remains limited to isolated transport tests.

Managed sessions must obey extension mount and enabled state. Clearing the setting, disabling the extension or omitting its mount cannot be overridden by an inherited `TYPESAFE_API_KEY` or a copied key embedded in settings JSON. Source CLI compatibility with `TYPESAFE_API_KEY` is allowed only through the same resolver; it is not a second authentication implementation.

Credential rotation and clearing follow the existing session refresh boundary. A started attempt uses its captured credential and budget; refreshed sessions and new work use the current mounted configuration. Do not introduce a mid-attempt credential swap or new hot-reload semantics in the NPC feature.

Record only nonsecret provenance: source versus App runtime, credential route, configured/unconfigured status and extension activation. No token values, fragments or fingerprints belong in model state, artifacts, telemetry, frontend output or issues. A source-process error must not be presented as failure of a separately authenticated running App.

### 12. Keep suggestions, performance and world effects distinct

The Keeper receives a bounded view of relevant personality, relationship causes, selected intention, supporting evidence, restrictions and unknowns. Full scoring matrices remain diagnostic. Scores are not permanent attributes, mechanical targets or knowledge authority; low model confidence is not the NPC's emotional hesitation.

The Keeper may adopt, adjust or replace a suggestion using current evidence. Voice follows the current utterance and response, never a compulsory phrase bank. A choice probability distribution is not automatically a behavioral randomizer.

Actual changes use the canonical dispatcher and retain existing admission, Mod and kernel checks. Multiple NPC suggestions may be evaluated concurrently, but conflicting actions and actions dependent on new receipts settle in valid order. Player choices are never inferred from the NPC's preferred outcome.

Ignored offers are diagnostic only. They do not create future narrative debt, force a scene event or require the Keeper to compensate for a person who stayed quiet.

### 13. Generate intervening history at reunion

Retain the last established state, stable personality, directed relationships, commitments and relevant game time. At a reunion, the Keeper or an existing tool-enabled Pi author may fill an unestablished interval as needed using current events and encounter context. No real-time timer, per-day NPC execution or fabricated turn log is required.

Ordinary daily developments, modest progress and no significant change are all valid. The generated continuation cannot rewrite settled history, grant unavailable knowledge, invent player consent, transfer player resources or resolve an unchosen player objective. Important world effects still require their existing owners.

A draft may contain proposed background facts, attributed NPC reports and open next actions. Accepted background material is recorded as table-authored continuity with provenance; a report remains attributed. Store and reuse the accepted interval so reloads and repeated encounters do not regenerate its past. Additional content may fill still-open details without rewriting accepted ones.

Preparation and derived storage are background-capable when the interval and constraints are already known. First use may generate just the necessary continuation within the current Keeper work; it must not block on a full biography, unrelated stat block or all background projections. Minimal acceptance of adopted durable details precedes their treatment as established history.

### 14. Define failure and rollback per owner

Optional decision assistance, extra personality detail, indexing and presentation may fall back to current source material and normal Keeper behavior. Missing answers remain unknown or incomplete, not affirmative authorization. A new unsupported candidate or unavailable author result is never silently accepted.

Required source readiness, admission, missing mechanical values, canonical mutation and turn commit keep their existing refusal/recovery behavior. Asynchronous processing does not weaken them. Cancellation after a settled operation retains that receipt; retry cannot reroll or duplicate its effects.

Rollout is incremental and reversible at task/session boundaries. Disabling new routing keeps accepted character history, generated supplements, exact references and prior receipts readable. No save deletion, evidence cleanup or bulk rewrite is part of rollback.

### 15. Deliver vertical NPC experience slices

The scope contains the complete feature, with onstage behavior and relationship continuity first, and reunion continuation as a later independently accepted slice. Each slice begins with its required contract changes and ends at a real NPC consumer. Parallel scheduling, background publication and shared authentication are requirements within these slices, not a separate infrastructure-first workstream.

| Slice | Implementation result | Required gate |
| --- | --- | --- |
| A: meet a recognizable person | Source-aware personality, missing-detail generation, one accepted identity, and actual Keeper use | Personality affects an interaction and remains the same after reload; optional enrichment does not delay a greeting |
| B: change the relationship through play | Directed event evidence, recent-history access despite indexing lag, and meaningful current candidates | Help, betrayal or a kept promise changes a later response to the relevant investigator |
| C: let the person choose and respond | Personality/relationship/situation judgments, parallel Jev suggestions using shared auth, and normal Keeper performance/effects | Distinct, reasonable choices and natural closure in real interactions; no forced player action or foreground queue drain |
| D: meet again | Just-in-time continuation and durable interval acceptance using the same person and history | A later reencounter continues accepted details consistently without offstage simulation |
| E: accept the complete experience | Genuine multi-turn evaluation of the above interactions, with correctness and responsiveness measurements | Coherent individuality and relationships, player spotlight and acceptable latency; technical metrics alone cannot pass |

## Testing Decisions

NPC experience is the primary acceptance target: stable individuality, remembered relationships, meaningful responses and coherent reunions with the player in control. Concurrency, deferred writes and shared authentication are supporting checks. Passing those checks cannot compensate for absent or poor NPC behavior.

### 1. Primary test interface and evidence levels

Use the existing real Pi gameplay entry, canonical kernel operations and delivered player response as the highest integration interface. This follows the main NPC experience objective in the discussion. Shared runtime checks exercise the existing decision adapter/task scheduler, background publication owner and Jev credential resolver rather than inventing separate NPC test-only entry points.

Good tests assert externally visible choices, retained identity/history, legal effects, publication behavior and timing of delivery relative to pending work. They do not mirror a scoring formula, inspect a private map to claim player knowledge, or infer adoption from a populated field. Deterministic interface tests, real provider diagnostics and genuine play each retain a separate status.

### 2. Personality, relationships and candidate supply

Use matched situations that vary one meaningful trait or one shared event, plus weak/ambiguous descriptions. Permit multiple reasonable responses instead of encoding a universal stereotype. Include direct help, conditional cooperation, refusal, natural closure and no suitable candidate.

Verify target-specific and asymmetric relationships, unresolved and fulfilled commitments, later repair of a breach, and coexistence of gratitude with fear. Preserve contrary evidence and original terms. Confirm that the resulting material reaches the actual outgoing Keeper context and changes a delivered interaction when relevant.

Evaluate automatically supplied candidates separately from Jev selection. Hand-authored candidates may diagnose the selector but cannot close this gate. Inspect whether a good available response is missing, whether candidates differ in actual consequences, and whether Keeper generation is unnecessarily invoked on every turn.

### 3. Knowledge and player control

Include NPC-known facts, party-only facts, another NPC's secrets, false beliefs, uncertain reports and player guesses. Inspect the actual outgoing state and candidate premises, not just the host's source lists. Classification does not authorize knowledge or disclosure.

Test negation, quoted threats, hypothetical actions, a direct goodbye, and an adversarial request to invent knowledge. Verify no unselected player action, forced side quest, duplicate reward or incompatible multi-NPC effect. Preserve existing admission and receipt authority in the real dispatcher trace.

### 4. Reunion continuity

Start from an established personality and last encounter, advance game time through normal play, then revisit. Verify a plausible continuation or quiet interval, no invented player decisions, and a clear distinction between NPC claims and accepted world details.

Reload and revisit the same interval. The accepted continuation must remain the same; it must not require fabricated intermediate turns. Also test late source conflicts, an already fulfilled promise and changed resources that invalidate an old proposal.

### 5. Genuine play and performance gates

Follow the project's real-play method: the ordinary driver launches the current runtime in RPC mode, configured Grok is Keeper, and the main controlling session is the sole player. Play one natural input at a time, preserve all evidence, and resume an existing campaign through its required resume operation before any other campaign operation. No scripted player, fake Keeper or bulk settlement substitutes for this gate.

Observe multiple meaningful onstage encounters and at least one real return encounter where the table permits it. Assess stable individuality, relevant history, understandable conditions or refusals, natural language, appropriate silence and continued player agency. More actions, more analysis or longer dialogue are not success metrics.

Measure full player-turn latency, first useful narrative, foreground queue time, decision time, required generation, background lag, token/cost usage and failure/recovery. Keep source/build, model/thinking, actual feature activation, source readiness and credential route comparable. Report sparse samples individually rather than claiming a reliable p95 from a few turns.

Quality, authority and responsiveness are separate gates. The ready-for-agent label authorizes planned implementation work, not a claim that the original prototype completed these gates.

### 6. Background work must not delay normal play

Artificially delay or pause optional parameter preparation, voice generation, memory indexing and relationship projection. Drive a real ordinary conversation through the supported interface and verify delivery occurs while these tasks remain pending.

Then require one specific missing parameter for an actual action. Verify the exact owned job is reused or promoted, that only its required dependency is awaited, and that a missing value produces the current honest missing-requirement behavior rather than an invented roll. Unrelated stat preparation must remain outside the wait.

A fresh turn must recover a recent relation or promise from its committed original while extraction is delayed. No test passes by simply hiding the loading indicator or serving an outdated memory projection.

### 7. Parallelism must be directly observed

Exercise a wide ready workload, including a 430-question diagnostic when suitable, through the shared runtime. Record question/batch count, grouping reason, queue-enter time, dispatch time, first answer, required-group completion, optional-work completion, retries and actual token/cost usage.

Show that multiple independent requests are in flight at once within the configured shared capacity and that same-state questions are batched. Demonstrate that a slow optional NPC batch does not block an unrelated ready response. Preserve complete coverage across capacity partitions.

Use a deliberately dependent case to show the second wave starts only after the required new evidence exists. Test cancellation, partial failure and rate limiting without inventing clean answers or bypassing global concurrency. Do not claim all 430 questions are concurrent if they were actually driven by a serial loop or blocked behind an unrelated global barrier.

Compare serial and concurrent scheduling on the same bounded workload where useful, with actual provider load recorded. The prototype's two-concurrent-request timing is a baseline observation, not a promised service limit or final throughput result.

### 8. Durable publication and crash recovery

Exercise restart before claim, during generation, after prepared output, after acceptance but before acknowledgement, and during derived-index update. Verify one accepted personality/parameter/interval, recoverable pending work, retained original evidence and no duplicate effect.

Change relevant input or NPC state while a job runs. The late result must not overwrite current material. Run concurrent nonconflicting NPC preparations and conflicting publications to show that long computation overlaps while short authoritative writes remain serialized correctly.

Existing task ownership, queued budget, source publication, voice/job generation, committed-memory recovery and receipt idempotency tests are prior art. Extend their actual interfaces; do not build another persistence simulator as acceptance evidence.

### 9. Unified authentication

Exercise an enabled mounted extension with a vault-delivered key; missing configuration; cleared key; disabled extension; missing mount; and a conflicting inherited CLI key. Assert the real adapter either uses the shared resolver's result or sends no request, without logging the secret.

Verify source CLI compatibility only through the shared resolver. Confirm that new NPC consumers do not directly read a credential file, parse a different environment variable themselves or inject a manually sourced production adapter key. Keep isolated test injection separate.

Record safe provenance for real calls and verify source/App setup differences are reported honestly. Credential-change tests use the existing safe session refresh boundary rather than changing authentication while an attempt is in flight. Existing shared Jev credential and launch-assembly tests are the baseline.

## Out of Scope

- Continuous offstage NPC simulation, world ticking, day-by-day generated lives or an autonomous social world.
- A new NPC graph, separate truth database, message broker, database migration platform or general-purpose job infrastructure replacement.
- New public Keeper verbs, a player-facing personality dashboard, numeric personality sliders or an NPC-specific Jev settings panel.
- A fixed semantic trait taxonomy, keyword-based intent classifier, hardcoded profession-to-personality mapping or universal relationship formula.
- Replacing the Keeper's open-ended generation with chained Jev choices, generating statistics through score interpolation, or making Jev an authority for consent, facts or effects.
- Rewriting social mechanics, first-impression rules, existing authored character facts or the synchronous canonical turn-commit contract.
- Global NPC pre-generation, automatic upgrades of all Mods, rewriting old turns, deleting retained evidence or resurrecting the Python production kernel.
- An automatic rewrite or rerun of the retained prototype to make its measurements resemble the eventual production architecture.

## Further Notes

### Evidence and what it supports

The retained prototype made 34 real Jev requests containing 430 questions. Its median request time was 375 ms and its two-request-concurrency batch took 6.817 seconds. Three personalities chose different custody responses; removing personality made them converge. A kept promise and an unrepaired breach changed an unsecured-loan response. These are small authored diagnostics, not 430 independent behavioral cases, proof of automatic candidate generation or full-turn performance.

Personality and dialogue authoring used tool-enabled Sol after two source-home Grok attempts failed before tool use. Those source-home OAuth credentials differed from the running App's credentials. Neither the failures nor the Sol success prove the App's Grok behavior; genuine product validation must record the actual route without secrets.

Local companion documents: `docs/specs/npc-personality-and-relationship.md` and `docs/research/npc-jev-prototype-20260921.md`. Local implementation/evidence: `experiments/npc-jev-prototype/` and the retained NPC prototype run directory. These local artifacts are not assumed to be published on the remote branch. The historical direct-environment credential injection in that prototype is not a production pattern; new consumers follow the unified resolver contract above.

### Existing implementation constraints checked for this specification

The current task runtime already supports independent decision groups through concurrent dispatch; the decision adapter has configurable concurrency with a current default of four. The existing lane queue drains jobs serially within a lane while running after delivery. Reusing these modules is required, but neither existing default is accepted as a reason to serialize all new independent NPC work. Extend the existing scheduling seam only where the feature needs it, and retain its global accounting and cancellation ownership.

The current packing guard uses a conservative total serialized-byte upper bound. Respect it until the shared owner deliberately changes and verifies it. Do not silently truncate questions or bypass the packer in an NPC-specific client to reach an advertised model limit.

The existing Jev extension owns the secret setting, safe configured-status view, vault delivery and mount-aware resolver. Reuse that completed work. This feature requires no new credential from the user and no copy of any supplied key into the issue or repository.

The campaign history decision requires a synchronous canonical turn commit before delivery. Background preparation therefore moves optional generation, materialization and projections out of the critical path while retaining the small durable acceptance that makes delivered changes recoverable. Any broader change to that rule is outside this specification.

### Primary-source cross-check

[TypeSafe's primitive contract](https://docs.typesafe.ai/primitives) supports independent questions over a shared state and distinguishes them from genuinely dependent requests. Its [fan-out guidance](https://docs.typesafe.ai/patterns/fan-out) supports asking ready speculative questions together and selecting relevant results afterward. These support the concurrent question design, but do not remove privacy, request-size, budget or service limits, nor guarantee this product's end-to-end latency.

The [transactional outbox pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html) supports recording durable intent with the authoritative change and processing it asynchronously, while anticipating duplicate delivery. This project applies that principle through its existing filesystem transactions and job owners; it does not adopt AWS infrastructure or a second state store.

The earlier NPC research also compared [Utility AI](https://www.gameaipro.com/GameAIPro3/GameAIPro3_Chapter13_Choosing_Effective_Utility-Based_Considerations.pdf), [Versu](https://cs.uky.edu/~sgware/reading/papers/evans2014versu.pdf), [CiF](https://ojs.aaai.org/index.php/AIIDE/article/download/12454/12313/15982) and [Generative Agents](https://arxiv.org/html/2304.03442v2). Their useful precedents are meaningful alternatives, distinct character preferences, attributed social history and continuity. Continuous simulation and hand-authored semantic rule banks are not adopted.
