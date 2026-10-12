# Module-derived NPC character profiles

Status: source implemented; profile diagnostics complete; scoped memory attribution/reload acceptance passed; comparative superiority and installed-App acceptance remain open. Prepared with the explicitly invoked to-spec workflow on 2026-10-11.
Tracker: [#113](https://github.com/Leehow/chatrpgv4/issues/113), labeled `ready-for-agent`.
Related work: [NPC continuity #102](https://github.com/Leehow/chatrpgv4/issues/102).

This specification records the agreed next design: generate a compact character profile while reading a module,
publish it in the ModuleGraph as derived interpretation, and combine it with campaign-local relationships and
current circumstances when producing NPC behavior and speech. The existing prototype supports feasibility,
not a claim that structured profiles already improve the product. The user subsequently authorized implementation.

## Problem Statement

Players should encounter recognizable people who respond differently for understandable reasons and retain
their identities through pressure, reconciliation, topic changes and reunions. Different wording alone does
not demonstrate different priorities; repeatedly announcing a fear is not convincing characterization.

The product already has source NPC descriptions, a persistent concise personality supplement, directed
relationship evidence, limited perspectives, action generation and voice preparation. However, a brief source
personality can satisfy preparation without any further interpretation; relationship material is not explicitly
assembled with all personality inputs; and voice preparation does not directly share the full persistent
personality and directed relationship view. A profile stored without these consumers would not solve the problem.

Generating a new interpretation separately in every campaign wastes reusable source work and can produce a
different version of the same person. Storing changing trust or current emotion in the shared module would
instead leak one campaign's history into another. The design must support stable reusable interpretation and
independent campaign development without turning interpretation into source truth.

## Solution

During ordinary progressive module reading, the tool-enabled Pi reader prepares a small character profile once
the relevant person's identity, description and available relationships have been established. The profile is
published through the existing ModuleGraph owner, with its evidence and derivation clearly identified. The
reader does not need to finish the whole book or fill every field before a person can appear.

The profile contains only core tradeoffs, a few conditional tendencies with exceptions, and flexible expression
guidance. Source identities, facts, secrets, knowledge ownership and initial relationship edges remain in their
existing graph records. Actual shared experiences, promises, trust changes and current circumstances remain
in the campaign. A ready graph profile is reused; missing or rejected optional enrichment never blocks play.

At an encounter, the existing NPC projection supplies the same accepted profile to the action author, the
Keeper and voice preparation, together with the relevant campaign evidence. The Keeper remains the prose
author, the kernel owns mechanics and transactions, and the player retains every decision boundary.

## User Stories

1. As a player, I want an NPC to have a coherent initial character when first encountered, so that a greeting does not wait for optional personality generation.
2. As a player, I want different NPCs to weigh a common request according to their own priorities, so that individuality affects conduct as well as wording.
3. As a player, I want a person's motives to guide behavior without being recited every turn, so that dialogue sounds like an exchange rather than a character explanation.
4. As a player, I want source-specified voice and inability to speak preserved, so that enrichment cannot overwrite explicit characterization.
5. As a player, I want a reserved or suspicious person to allow ordinary conversation when appropriate, so that a trait does not mandate refusal.
6. As a player, I want an apology or change of topic to affect the current exchange, so that an NPC does not remain mechanically stuck in anger.
7. As a player, I want formal, extended, brief and silent replies all to remain possible, so that distinct people are not forced into one rhythm.
8. As a player, I want the same person to remain recognizable after reload or reunion, so that continuity survives process and session boundaries.
9. As a player, I want meaningful experiences to change a relationship without replacing the person's identity, so that stability still permits development.
10. As a player, I want a kept promise to support limited trust and a broken promise to justify caution, so that reactions have remembered causes.
11. As a player, I want relationships directed at particular people, so that one investigator's conduct is not assigned to the entire party.
12. As a player, I want an NPC's beliefs and knowledge limited to their own perspective, so that a character profile cannot reveal someone else's secrets.
13. As a player, I want denial, evasion and intentional lies to remain possible, so that a frightened witness is not forced to disclose everything they know.
14. As a player, I want missing source detail to remain uncertain, so that a sparse description does not acquire invented relatives, crimes or possessions.
15. As a player, I want a natural goodbye to end the exchange, so that the profile creates neither obligations nor unsolicited subplots.
16. As a player, I want NPC suggestions and attempts to respect my next choice, so that characterization does not move my investigator or accept an offer for me.
17. As a returning player, I want new source reading to preserve my established campaign, so that later interpretation does not silently rewrite played events.
18. As a player starting another campaign, I want the module's accepted initial interpretation to be reusable, so that the same source NPC does not reroll without reason.
19. As a player starting another campaign, I want its relationships independent of previous campaigns, so that another investigator's favors do not affect my first meeting.
20. As a Keeper, I want behavior and speech to use the same character basis, so that one lane does not make a different person from another.
21. As a Keeper, I want source facts, paraphrases and interpretive additions distinguishable, so that advice does not acquire world authority.
22. As a Keeper, I want progressive reading to prepare only the currently relevant people, so that enrichment does not require a whole-book pass.
23. As a Keeper, I want newly read evidence to identify affected profiles, so that unrelated people do not regenerate after every graph publication.
24. As a maintainer, I want exact provenance and rejected attempts retained, so that interpretation failures can be diagnosed without rewriting evidence.
25. As a maintainer, I want end-to-end evidence that the profile reaches the real model request and affects actual play, so that a valid stored JSON object is not mistaken for success.
26. As a maintainer, I want legacy modules and campaigns to remain playable, so that adopting the feature does not require a destructive migration.

## Implementation Decisions

### 1. Ownership and contract amendments

This extends the existing visual-source publication, core NPC personality, NPC situation and voice-preparation
contracts. It does not restore the retired response-bank design. The production implementation remains
TypeScript; historical Python code and oracle data are not implementation inputs.

Before implementation, fold the relevant interface amendments into the canonical contract's sections 22,
123.1–123.2, 143.1 and 170, preserving sections 31, 180 and 192. This standalone specification is the proposed
contract change; it does not claim those interfaces have already changed. The shared contract currently has
unrelated concurrent edits and is deliberately not rewritten by this specification task.

The three ends are explicit:

| Material | Producer and durable writer | Reader | Actor and observable consequence |
| --- | --- | --- | --- |
| Source identity, goals, knowledge and initial directed relationships | Existing tool-enabled module reader, source review and ModuleGraph publisher | Existing graph and perspective projection | Keeper and NPC action author use source-grounded circumstances |
| Compact derived character profile | Same reader task, accepted only by the existing module publication owner | One shared core personality projection, consumed by NPC situation, Keeper context and voice preparation | NPC intentions and delivered speech show context-sensitive choices; effects still require canonical receipts |
| Played relationships, promises, current state and recent speech | Existing campaign memory, transaction and committed-turn owners | Existing per-person perspective and current situation | Later conduct responds to what actually happened, without mutating the shared module |

### 2. Graph representation and compact payload

Add an optional `character_profile` envelope to an NPC node's properties. This is derived advisory material,
not another NPC node, an authored-fact claim, a stat block or a new relationship graph. Creatures and investigator
templates are excluded. Reuse the graph's canonical person identity and survivor mapping.

The envelope has `schema_version` 1 and contains a `profile` with only these content sections:

- `priorities`: zero to two concise English statements identifying the person's important tradeoffs.
- `tendencies`: zero to three entries, each with `context`, `inclination` and optional `exception`; these are
  natural-language guidance interpreted by a model, not executable conditions or keyword routing.
- `expression`: an optional concise English statement about flexible register and listener-relative expression.

The profile content, including field names when serialized, is bounded by 1,200 Unicode code points, preserving
the existing personality ceiling. This is a maximum, not a filling target. Empty sections may be omitted; a wholly
empty profile is represented by absence. No fixed count of traits or minimum richness is required. A single
useful tradeoff may be enough. This reduced shape replaces the prototype's overlapping six-section organization;
it has not yet been validated as an improvement.

Do not duplicate current emotion, party stance, live trust scores, goals for this turn or a snapshot of all
relationships in this stable payload. Relational evidence can inform a conditional tendency, but initial
stranger status must not become a permanent instruction to distrust an investigator after shared experience.
No personality meters, numerical trust generation, compulsory catchphrases or fixed dialogue examples are added.

The host-owned envelope also records `origin` as `module_derived`, source/dependency revision, profile-content
revision, generation-policy version, author model provenance, and `basis` entries. Each basis entry identifies
the supported profile field, supporting source references and/or existing relationship evidence, and whether
the field is a source paraphrase or an interpretation. These labels do not promote interpretation to fact.
Names and short evidence aliases are model-facing; opaque identities and digests are resolved and minted by
the host. An interpretation cites what supports it, without pretending its exact conclusion was printed.

Dependency revisions include the person's actual contributing source material and relevant relationship edges,
not the entire graph revision. Unrelated graph edits must not invalidate every profile. Missing relationships
remain missing; contradictory evidence remains visible rather than being smoothed into invented certainty.

### 3. Generation during progressive reading

The existing tool-enabled Pi reader first establishes the person and available relationships from its legitimate
source scope, then drafts the profile from that material. It may do both in one task. No new mandatory per-NPC
subprocess, whole-book biography pass or foreground planner is introduced.

The reader may propose source and derived content in the same candidate. The existing source checker/reviewer
distinguishes their authority: identity, knowledge ownership and source relations retain their current gates;
the profile is checked for coherent support, source contradictions and unauthorized additions, not literal
quotation of interpretive prose. Deterministic checks enforce shape, references and revision bindings;
semantic assessment remains with the existing model-based reading/review path.

If only the optional profile is absent, malformed, unsupported or unavailable, omit it and publish otherwise
valid source material through the existing gates. Do not block a playable conversation or trigger a full
source reread merely to fill personality fields. A source identity or knowledge error still follows its existing
blocking policy; labeling it as profile content cannot bypass that policy. No new quality-score threshold is added.

The ModuleGraph publisher remains the sole writer and atomically publishes the accepted candidate with its
provenance. A later optional supplement uses that same existing publication path and stale-source checks.
Concurrent or late drafts cannot replace a newer person's source binding. Retry/cancellation follow existing
reader jobs; this feature does not add an independent retry scheduler.

### 4. Reuse, updates and campaign continuity

An accepted graph profile is reusable across new campaigns. Ordinary reading and encounters do not regenerate
it, and unrelated publications do not change it. Relevant new source material can produce a revised profile
through ordinary incremental reading. Source corrections and newly derived interpretations remain distinguishable.

At first adoption for a person in a campaign, the existing core NPC preparation/publication owner binds the
accepted profile content and its source/profile revisions in the existing character record. This is a campaign
binding to reusable material, not a second authoring process. Replays are idempotent. Read-only projections do
not mutate the campaign. Model-visible callers never copy revision identifiers to establish the binding.

Once accepted, the campaign reuses its personality binding on reload and reunion. A later graph revision does
not silently replace that personality or any played relationship. Source disagreements remain explicit through
the existing source-variant/continuity handling; an obsolete interpretive clause cannot override current accepted
facts. No automatic migration or personality regeneration of existing campaigns is part of this feature.

An existing campaign with an accepted legacy personality keeps it. A legacy module without a profile retains
ordinary source material and the existing background personality fallback. A ready compatible graph profile
suppresses redundant background authorship for a new adoption. The presence of a short source personality does
not prevent the source reader from preparing a derived profile alongside it.

### 5. Shared projection and consumers

Extend the existing `personality` view additively: preserve `description` and existing origins for legacy
consumers, and allow the bounded `profile` with `origin: module_derived` when adopted. If the source includes an
authored personality description, preserve it alongside the derived profile with clear authority. Do not have
each consumer independently summarize, rewrite or regenerate the accepted profile.

The same core projection supplies the NPC look/capsule, limited NPC perspective, NPC situation/action input,
and voice-preparation input. The Keeper's actual provider request must contain the applicable material through
the current context-budget owner. No new Keeper verb, per-turn personality request or additional prose writer
is introduced. Existing budget/truncation reporting stays explicit; profile advice cannot displace mandatory
source facts, current action context or agency constraints.

Source relationships and played evidence are read as separate attributed inputs. The most recent applicable
campaign evidence describes current relations without rewriting module canon. Preserve target, direction,
knowledge owner and supporting event. A player allegation is not an established relationship change.

The profile is not a knowledge grant. Do not smuggle another person's secret, a Keeper-only future event or an
unobserved interaction into a tendency. Separate confidential author context from the information the actor may
act on, using the existing limited-perspective boundary. Neither a character's denial nor a character's statement
automatically establishes truth. A source-consistent lie is not by itself a memory or personality failure.

Voice remains the existing presentation owner's responsibility. It consumes the shared profile and relevant
directed context while respecting source voice, prior accepted voice, play language and the current speaker's
purpose. It must not turn priorities into repeated self-explanation, force a response length, or require a
refusal, threat or occupational flourish in every line. Previously accepted voice cards are not mass-regenerated.

### 6. Effects, language and authority

Interpretation may guide a proposed intention, manner or wording. It cannot settle a roll, transfer an object,
create a possession, move an investigator, disclose unknown facts or create a commitment on the player's behalf.
Existing resolve/apply authority, object-instance ownership and decision boundaries are unchanged.

System-facing derived content is English. Authored names and source evidence retain their own language, and
player-facing speech is generated in the campaign's open play language. There is no language detector,
occupation-to-personality table, semantic regex, translation registry or deterministic personality classifier.

## Testing Decisions

### Primary acceptance seam

Prefer one observable path: ordinary source reading and publication -> persisted/reloaded ModuleGraph ->
existing core NPC projection -> actual NPC action and Keeper provider input -> delivered conduct and speech,
with canonical receipts whenever an effect occurs. The user has already agreed to this path; another interview
or approval checkpoint is not needed for this specification. Focused lifecycle checks support this seam and do
not substitute for it.

### Deterministic regression coverage

Reuse prior art from source publication/staleness tests, core NPC character RPC/lane tests, shared NPC preparation,
voice-card review, canonical identity merging and the world-state seam inventory. Test externally observable
contracts rather than private helper shapes. Required cases:

1. A reader-supplied valid profile survives graph publication/reload with exact source-versus-derived authority.
2. The same source NPC across merged fragments resolves to one profile owner; relevant relationship evidence is retained.
3. A sparse source can publish with a partial or absent profile. Invalid optional enrichment does not make valid source material unplayable.
4. A stale or cancelled author cannot publish over newer source evidence; replaying the same accepted publication is idempotent.
5. Unrelated graph edits leave the profile dependency revision unchanged; relevant source/relationship changes invalidate the draft that used them.
6. Two new campaigns can reuse the same initial profile while their subsequent relationship evidence stays isolated.
7. A reload/reunion preserves an adopted profile; a newer module interpretation does not silently overwrite an established campaign personality.
8. Legacy campaigns retain their accepted description and voice; legacy modules and unavailable enrichment use the ordinary fallback without waiting.
9. A ready graph profile prevents a redundant personality author call, including when the source already has a short personality description.
10. The NPC situation, voice preparation and Keeper request receive the same applicable profile; actual provider inclusion is observed after serialization, not inferred from an intermediate packet.
11. Knowledge attribution and visibility survive projection. Unknown material stays absent; a relation or tendency cannot grant another actor's knowledge.
12. Creatures and investigator templates do not receive NPC profiles. Source-defined silence and language behavior remain governed by their existing contracts.
13. Optional profile failure/truncation does not remove mandatory evidence, authorize a player action or create an extra foreground generation barrier.

### Model diagnostics and real-play acceptance

Retain the original comparison and all adverse outputs. First test the reduced three-section profile against
the current concise personality and original six-section prototype with the same model/effort and comparable
material budgets. Include both the existing distinct tea-house cast and source-grounded sparse imported NPC
descriptions with relationships; the deliberately expressive fixture alone is insufficient for the extraction claim.

Keep profile authors unaware of held-out dialogue probes. Supply conversation inputs one at a time. Include
conflicting incentives, pressure, apology, ordinary contact, topic changes, natural closure, unknown information,
silence, and directed kept/broken-promise histories. Stability means coherent context-sensitive development,
not identical responses. Shared reasonable refusals are not a failure of differentiation; different refusal
wording alone is not proof of different behavior.

Independent model review is advisory. Give each reviewer the complete context actually available to the actor,
keep treatment identities hidden, and verify every quoted claim against its exact arm and turn. Do not score
a spoken denial of known information as lost knowledge without supporting evidence. Cross-arm contamination,
misattributed quotations and missing-context findings are invalid assessment evidence, retained and explained.
Use repeated independent samples for any comparative improvement claim; a single preference or ordinal total
cannot establish a reliable improvement. Report interpretation quality and added context/latency separately.

The final product gate is genuine driver-based play through the existing source and Keeper paths, with the
main session as the player and Grok Build 4.5/low pinned (the user
initially authorized fallback after repeated 4.7 timeouts, then required 4.5 for all subsequent Keeper play). Demonstrate an initially read NPC, coherent
successive interactions, a real relationship consequence and a reload/reunion without personality regeneration.
Preserve all source, request, turn, receipt and telemetry evidence. No scripted player, fake Keeper, prewritten
response bank or synthetic campaign record counts as acceptance. Deterministic, diagnostic, real-play and
installed-App evidence remain separate. Packaging/relaunch is not authorized by this specification.

### Completion criteria

The feature is complete only when the source-to-consumer path works, legacy/continuity boundaries hold, and
real interactions retain recognizable people without increased rote self-explanation or forced behavior.
If diagnostics show parity rather than improvement, report parity. Successful persistence, profile counts,
test totals or a finished report alone do not establish better NPC experience.

## Out of Scope

- Automatic migration, packaging or deployment. Implementation and source-mode acceptance were subsequently authorized.
- Restoring a Python kernel, OCR ingestion, the retired NPC response bank or another Keeper/planner.
- Whole-book preprocessing, mass backfill, continuous offstage society simulation or a new scheduling framework.
- Numerical personality meters, generated trust scores, psychological classification or fixed occupation/voice maps.
- New biographies, relatives, secret plots, abilities, inventories, player commitments or world events supplied by profile generation.
- A new Mod system, settings surface, public verb, mandatory per-turn reviewer, prose rewrite loop or new model/provider policy.
- Automatically regenerating existing campaign personalities or source/accepted voice cards.
- Installing Nuwa or copying its full research workflow, personality quantities, dialogue templates or scores into the product.

## Further Notes

### Prototype evidence and limits

The retained 2026-10-11 prototype compared five existing tea-house NPCs: four characters in two eight-turn
conversations each, six silent-control responses, and eight relationship-counterfactual responses, for 78 real
model responses. Both arms preserved core characterization and showed relationship sensitivity. The structured
arm had local benefits and adverse examples, including repetitive motive disclosure and an unsupported teapot
departure. It did not establish a stable net improvement over concise personality.

The source fixture already has pronounced voices; one conversation per arm does not establish long-run behavior
or sampling robustness. Profile lengths were not matched. The isolated performance port did not run production
NPC action binding, Keeper context or canonical transactions. Automated assessment included denial-as-amnesia
and cross-arm contamination errors, which were not accepted as superiority evidence. No human blind study was
performed. The reduced shape and parsing-stage graph storage specified here have not yet been run in that prototype.

Local evidence (retained, not necessarily present in another checkout):

- [Interactive original comparison](../../.pi/prototypes/npc-persona-nuwa-20261011/run-qLRFSk/prototype.html)
- [Original protocol](../../.pi/prototypes/npc-persona-nuwa-20261011/run-qLRFSk/preregistered.json)
- [Qualified findings and reviewer corrections](../../.pi/prototypes/npc-persona-nuwa-20261011/run-qLRFSk/summary.json)
- [Execution/source audit](../../.pi/prototypes/npc-persona-nuwa-20261011/run-qLRFSk/audit.json)

Existing local contracts and implementation entry points for implementers:

- [Visual-source specification](visual-pdf-reader.md), [NPC continuity specification](npc-personality-and-relationship-spec.md), [NPC acts first](npc-acts-first.md).
- [Canonical contract](../kernel-rpc.md), sections 22, 31, 123, 143, 170, 180 and 192.
- Current source reader guidance/review, module graph publication/identity owner, core NPC material/perspective,
  situation projection and voice job preparation are the existing owners to extend. No replacement graph or actor stack is needed.

Primary-source precedents:

- [Nuwa extraction framework](https://github.com/alchaincyf/nuwa-skill/blob/main/references/extraction-framework.md): conditional judgment, internal tensions and explicit uncertainty. Its rich public-person corpus assumptions and fixed output quantities do not transfer to sparse module NPCs.
- [Generative Agents](https://arxiv.org/html/2304.03442v2): identity/relationship seed descriptions and experience-conditioned dialogue; also reports overly cooperative behavior. It supports the architecture's plausibility, not this product's acceptance.
- [W3C PROV derivation](https://www.w3.org/TR/prov-o/#wasDerivedFrom): distinguish a derived entity from the source on which it depends. This is a provenance principle, not a proposal to add RDF or a provenance framework dependency.

## Implementation record

Objective: source reading publishes a compact derived NPC profile; one core projection reaches behavior, Keeper and
voice with campaign-local evidence and stable adoption. Work covers #113 and the subsequently authorized memory-attribution repair in contract §231. Preserve concurrent dirty work;
current mainline is `0.9.7a`. No commits, pushes, packaging or existing-campaign migrations requested.

- [x] Read current source/NPC contracts and freeze the additive interface in contract §229.
- [x] Optional graph profile shape, source support review and canonical publication.
- [x] Idempotent campaign adoption and shared actor/Keeper/voice projection.
- [x] Scoped regressions and runtime build on the available LAN box (`leehow-pc`).
- [x] Reduced-profile real-model diagnostic and actual source-to-Keeper profile delivery.
- [x] Audit existing adoption, legacy preservation, actual provider projection and production voice caller.
- [x] Repair and exercise promise hearers and directed cooperation through extraction, NPC projection and actual serialized requests after reload (§231). Canonical promise fulfillment is not inferred.

Validation checkpoint: the LAN scoped set passed 73 tests; after the final independent-publication guard,
the source-profile/foundation/inventory set passed 31 tests. Kernel type checking and runtime build passed.
The earlier broad combined-worktree run reported 2140 Python tests passed, 12 loop tests passed and 12 extension
failures. One empty-field compatibility regression from this feature was repaired and passed focused checks;
the remaining broad failures are not claimed resolved or classified as established baseline failures.

Actual PDF reading produced and independently reviewed a 586-character compact profile and published it in
the module graph. The campaign adopted a module profile once, and two actual serialized provider requests
recorded its digest. These observations prove delivery of advisory input, not completed NPC performance.
Original attempts are retained under the `npc-profile-reader-20261011`, `npc-profile-source-20261011`,
`npc-profile-live-20261011` and `npc-profile-live-retry-20261011` playtest records. Grok 4.7 produced repeated
60-second stream-idle errors before a canonical NPC delivery. On 2026-10-11 the user explicitly authorized
Grok 4.5 as the fallback; `npc-profile-live-grok45-20261011` uses `grok-build/grok-4.5`, low. Source extraction
and prior failed-play models remain recorded as 4.7, and are not relabeled. Global defaults are unchanged.

The reduced-profile diagnostic subsequently completed 105 real tool-enabled Pi responses on Grok 4.5/low:
27 trials across concise description, original six-section card and reduced three-section profile. Inputs include
two tea-house principals, two actual PDF-imported descriptions, a silent control and directed kept/broken-confidence
histories. All nine silent responses remained silent. Seven blinded review batches produced 46 exact quotes,
all verified against their own arm and turn. The result supports feasibility and local tradeoffs, not stable
superiority. Actual content budgets overlap but are unequal, and there is only one sample per condition.
Retained evidence: [qualified diagnostic summary](../../.pi/prototypes/npc-profile-reduced-20261011/run-T1a8oJ/summary.json).

The two real 4.5 runs retained 29 turns (11 initial, 18 after restart), including one malformed direct-text
response that is invalid for acceptance. Knott's accepted full profile stayed identical in 18 persistent world
snapshots; a second provider digest came from explicitly reported context-budget truncation. A current-protocol
profile reached the publicly encountered neighborhood vendor through normal source publication/adoption and
actual serialized requests. The male clinic patient also used a module-derived profile; the editor and two other
clinic roles retained accepted campaign supplements, so their dialogue is not module-profile efficacy evidence.
This is scoped source-mode evidence, not completed scenario or installed-App acceptance.

The final production caller audit repaired a missing voice-input seam: `voice.job` now reads actual campaign
memory, canonical fulfillment evidence, committed speech and active worldline/loop before preparing relationships
and commitments. The genuine RPC regression and unified voice/foundation/inventory set passed 46/46 on the LAN
box, and the final runtime build and kernel type check passed. Earlier broad failures remain separately recorded.

At the initial profile-only checkpoint, relationship acceptance remained open. The public investigation agreement and later report were delivered,
but extraction omitted Knott from the promise's `knowers`; the relation entry was player-to-Knott, not Knott's
own directed relation. Actual reunion projection had no commitments or relationships, and no canonical fulfillment
receipt was recorded. Journal/reunion summaries and dialogue acknowledgement must not be relabeled as persisted
trust or settled promises. The input did contain Knott and the delivered exchange; this is an existing semantic
extraction gap, not lost profile data. A separate repair would touch `kernel-ts/memory/jobs.ts`,
`extensions/memory/index.ts` and their contracts/tests; no such repair or automatic relation reversal had been applied at that checkpoint.
The source-mode test was stopped with all campaign/module/turn evidence retained. The separate Keeper-selected
long-travel/overnight timing mismatch was also retained; arithmetic matched the submitted choices.

Retained implementation audit: [validation.json](../../.pi/npc-profile-implementation/validation.json).
No commits, pushes, packaging or existing-campaign migrations were performed by this task.


The user then explicitly requested repair. Contract §231 adds shared promise/relationship attribution guidance,
requires explicit supported promise knowers on new ordinary jobs, and independently checks the extracted
participants/direction against exact delivered quotes before publication. Re-extraction uses the existing two-attempt
retry; code never swaps actors, fills hearers or grants reciprocal feelings. Historical completed records remain intact.
This adds one short background validation call per ordinary attempt, after delivery. The old unsupported inverse row
was retained rather than relabeled. The profile publication owners and accepted legacy personalities are unchanged.

Final scoped validation passed 44/44 on the LAN; the latest profile/memory set passed 23/23 locally, the compact
promise-history observer regression passed 7/7, and the inventory guard passed 4/4. The final runtime build was
fetched from the LAN. Earlier broad/combined-worktree failures remain recorded; this is not a full-green claim.
The first real review run used a 4.5 Keeper but the configured fast memory lane was Luna/off; its malformed second
verdict correctly prevented unchecked publication. The final runs explicitly pinned both memory and Keeper to
Grok Build 4.5/low without changing global settings. Jobs 42-46 completed through extraction and independent review.

The photo-shop clerk's actual promise retained both speaker and listener (turn 43); an evening reunion continued the
arrangement. It appeared in the emitted capsule's compact history.promises representation. The adapter observer
now recognizes that representation separately; the original clerk reunion does not have an actual adapter content
hash, so it is not promoted to proof of that last seam. Knott's turn-45 cooperation and turn-46 update were correctly
Knott-to-investigator, with both participants as knowers. After restart, two actual serialized Keeper requests carried
the investigator's heard reporting promise and the exact turn-46 directed relation digest. The investigator naturally
ended the entry-investigation commission and Knott respected that choice. This is scoped continuity and withdrawal
acceptance, not a solved house mystery or comparative superiority. No canonical promise fulfillment is inferred
from dialogue or memory. All source, adverse responses, failed jobs and real-play evidence remain retained.
