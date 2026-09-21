# Jev-driven tool tasks, memory lifecycle, and demand-driven preparation

<!-- unified-jev-supersession -->
> **Superseded design snapshot.** Do not implement this file independently. The [unified runtime refactor](jev-unified-runtime-refactor.md) is the single current design, tracked in [#101](https://github.com/Leehow/chatrpgv4/issues/101). The original proposal below is retained for traceability.

Historical status: superseded by the unified design; not an independent implementation plan.

## Problem Statement

Current preparation already supports selective source reading and checked source consultation, but locating and classifying material still relies heavily on generative readers and graph-addressable targets, and optimization is applied around tools rather than inside them. A player asking about a later location needs whole-document discovery before that location has a graph node. Repeated classification and copying add latency, while eagerly preparing unrelated parameters adds work without helping the current action. Current source and adaptation tools already contain multi-step generative reader/reviewer work. The Jev design replaces that expensive internal decision work and absorbs avoidable caller retries; adding one classifier before the unchanged agent workflow would not deliver this improvement.

The main design is now a complete tool task. One tool invocation owns the whole bounded objective and drives an adaptive Jev decision/action/observation loop internally, so optimization lives inside the tool rather than beside it. The selected design still combines original PDF evidence, a page/span document index, Jev typed decisions, and a small incrementally materialized ModuleGraph with the existing RuleGraph and kernel.

The problem from the user's perspective is that preparation is too slow and too eager, while the existing authorities and graphs are already the right place for truth.
The product should index the whole available document for navigation and discovery without forcing whole-document semantic deep-reading or blocking a supported opening.
It should retrieve broadly across the whole document universe before any current-scene filter, then prepare only the graph material the current decision actually needs.
It should answer ordinary questions from source without inventing state, and it should keep mechanics readiness operation-specific and kernel-owned.
Measured component speed is recorded as design evidence, but whole-tool-task and whole-turn measurement is an implementation acceptance item, not a precondition to authoring this specification.
Nothing here asserts graphless play or accepted full automation.

## Solution

Build one host-owned document preparation and Jev-assisted decision architecture that sits in front of the existing graphs and kernel, and make the primary unit of implementation a complete tool task rather than a single Jev decision.

A tool call owns a complete bounded objective: the current exact player input, operation arguments, campaign and worldline, source, world and candidate revisions, audience, authority limits, and budget. Jev sees that objective, the actual prior tool observations, the outstanding evidence needs, and the presently available operations and candidates. It semantically chooses the next operations and evidence targets. The host then invokes the existing reader, index, graph, history, and rule functions, appends exact observations, and iterates until the task completes or reaches an honest terminal or pending outcome. This is a genuine decision/action/observation loop, not a fixed number of Jev passes and not one Jev call per Keeper turn; one call may need zero, one, or several Jev requests.

The loop has an outer sequential shape and inner parallel questions. Questions that share fixed state and do not depend on another answer batch together; observations newly obtained by an action belong in the next request. The host never pretends one question sees another question's answer inside the same request.

Operations are closed typed contracts over live host-issued candidates: inspect a wider candidate partition; read selected source spans or pages; follow cited source references or allowed graph neighbors; fetch printed rule or catalog fields; read retained memory or transcript pages; check goal support, completeness, and contradictions; materialize source references; finish; report missing data; request a genuine player decision; or hand off a specifically identified generation or visual gap. Action availability is permission and phase code; action relevance is Jev semantics, not hardcoded query keyword or regex routing. The host supplies aliases and ordinals and binds identifiers, offsets, paths, and numeric records. Jev is not a text generator and does not fabricate arbitrary URLs, filesystem paths, code, SQL, searches, dates, or statistics. New query wording or a genuinely novel interpretation uses an existing generative owner only for that gap, never a mandatory large-model planning call every iteration. Broad natural-language goals can be evaluated against candidate evidence directly without a new generative decomposition call upfront.

There is no global autonomous agent replacing the Keeper and no new public verb or generic workflow DSL. A small goal-facing interface sits at the existing tool seam; each tool owns its operation set, result semantics, permissions, and commit policy. Host execution, HTTP, deadline, and trace infrastructure is reused rather than replaced. Current millisecond exact reads stay zero-Jev fast paths. Keep an explicit progress state across visited action, target, and source revision, fetched references, supported and unresolved requirements, contradictions, remaining coverage, and final result binding. Duplicate unchanged work is skipped; when a complete decision/action cycle yields neither new usable evidence, an expanded relevant candidate frontier, nor a reduced unresolved set, the task stops or reroutes rather than retrying indefinitely. Completion is supported task coverage plus deterministic owner validation; provider confidence alone is never completion, and confidence does not need to rise monotonically. No result marks unread or unsupported facts as absent, and lack of evidence is a partial or unresolved outcome.

One absolute deadline and cancellation signal spans all Jev requests, local reads, queued work, and scoped generative escalation; bounded maximum iterations, actions, tokens, and cost are caller-owned secondary ceilings, and a full budget is never reset on internal retry. Existing source job ownership, lease, retained attempts, and valid resume are preserved with no second persistence store, and read-only ephemeral tasks need not create durable jobs. Deadline exhaustion returns useful bound partial coverage or the existing pending or unavailable result honestly. No tool secretly fires an unbounded full agent or starts another Keeper turn. Different tools retain different outage and refusal policies: admission fails closed; optional workspace ranking keeps its 500 ms deterministic fallback and no-remote shadow mode; the post-delivery verifier stays advisory; continuity transport failure keeps its existing contract rather than a blanket fail-closed rule.

Read, prepare, and commit stay separate. Source preparation may publish only through the current accepted-source finish. Answer-only and recall cannot mutate the graph or world. Resolve and apply may use tool-internal evidence gathering and candidate choice before kernel commit, but the host revalidates the captured state and original exact intent before commit and executes the original authorized operation exactly once with existing idempotency; it never rolls twice after an ambiguous network response. A player choice such as defense, luck, push, or spend stops for the player and Jev does not pick it. A kernel needs-choice that is only semantic selection among already authorized rule candidates may be answered internally when unambiguous, otherwise it is returned honestly. Broader retrieval is not broader player consent.

A tool returns a completed existing typed result, or source-grounded extracts and facts with references and limitations; it does not require an extra LLM call merely to format them as prose. New source-answer extractive variants need an explicit owner contract amendment and original-source trust is preserved. An assembled extract is not an invented accepted narrative answer. The existing Keeper composes player-facing narrative as needed.

The host retains the original source PDF identity and page images.
It builds a rebuildable page text, span, and navigation cache using native PDF text first.
This is an explicit PROPOSED contract change from the current visual-reader policy; it does not assert that a retired OCR or Markdown production path is restored.
The kernel never parses PDFs.
The first slice uses native text plus the existing visual reader on demand, with no new OCR vendor and no old OCR pipeline.
Sparse, scanned, and image pages remain explicit unknown coverage and use the existing original-page and contact-sheet navigation.
Whole-document text indexing can run without forcing full-document semantic deep-reading or blocking a supported opening.

Page roles are multi-label routing hints, not hard exclusion filters and not evidence of complete coverage.
Before any current-scene graph filter, retrieval searches the whole available document universe in bounded partitions, with exact-name and alias lexical retrieval and graph links supplementing recall rather than preventing semantic discovery of a late-book location that carries another label.
Choice ranking alone always produces a winner, so the host independently tests atomic support and existence and allows none, unknown, or partial outcomes.
There is no universal relevance acceptance gate.
Jev cannot generate keywords; when new paraphrases are needed the host reuses an existing Keeper opportunity, counts the extra generation cost, and retains the raw player query.

The ModuleGraph stays small and incremental: a root plus the selected opening and only the actors, places, relationships, and conditions that are actually needed.
There is no mandatory full story graph and no node-per-sentence requirement.
Stable identities, aliases, provenance, secrecy, relevant causal dependencies, and required executable profiles stay in the graph; long exact source prose uses A's source references and existing consumer views materialize it.
Existing published graphs and saves are not deleted, and index discovery works even when no existing node exists.
A fresh opening explicitly amends the current skeleton contract as a proposed change: fresh imports replace the module-wide structural-preparation prerequisite with a compatible minimal root and source-backed opening candidates, an empty skeleton ready-node list, and the chosen start scene ready only after accepted scoped detail.
Existing campaigns continue through the existing graph and effective-view code.
Scope refinement follows the actual need: asking clinic hours yields a sourced answer, ordinary willing conversation yields the existing minimal person and place private narrative material, and an actual rule operation yields only the necessary typed parameters and conditions.
The same NPC is refined in place with additive conflict guards.
UNKNOWN is not zero, not a template default stat, and not ready.
Mechanics readiness is operation-specific at resolve and apply and at actual readers, not a new unused Boolean bag.
Relevant global rules, plot constraints, offstage triggers, and cross-page dependencies for the current decision must be searched and read even if they are elsewhere; unresolved necessary dependencies block that operation, while unrelated unread chapters do not.
The Keeper interprets causal and novel content; there is no automatic plot advancement or reveal from relevance and no preemptive full future plot extraction.

Rules use the current scene, the exact player words, and public authorized facts to derive eligible RuleGraph decision families, then fan out rule, skill, check-needed, and host-known-slot decisions independently.
Only deterministic eligibility filters apply, and missing facts are not false presence flags.
The RuleGraph compiler and kernel bind numeric, source, and runtime values and validate full preconditions, resource constraints, consent, cancellation, and receipts.
Jev does not roll, authorize, fabricate consequences, or fill unknown stateful subsystem slots.
Ordinary-check bindings come first; unsupported combat, chase, magic, and similar families stay on existing handling until their bindings pass.
No-rule and uncertain are legitimate outcomes.
Private module retrieval must remain separate from public admission state.

The adapter uses a native host fetch to the official `POST https://api.typesafe.ai/v1/systemone` endpoint and pins `jev-1.13.0`.
It uses Choice, Score, and Noul with shared state and independent questions.
Question keys are not inference input, so instructions name their targets.
There is no same-batch answer dependency; independent speculative variants are allowed and the host routes answers.
Concurrency is bounded and foreground-first with a common absolute caller deadline and cancellation, and the adapter validates answer coverage and binds it to model, family, source or candidate revision, and campaign and audience.
Credentials use the existing host vault and never appear in the renderer, logs, or the repository.
The capability is optional: a configured table uses the fast route, while an absent or unavailable capability reuses the declared incumbent or existing unavailable result.
Admission never fails open.
There is no blanket second complete agent review after an accepted migrated typed decision.
New visual or ambiguous evidence still uses the source reader and reviewer, while already accepted exact source references can be reused with freshness checks.
Text-only Jev cannot validate new visual facts; selective typed text checks may replace generative checks after their family acceptance and the required domain contract update.

## User Stories

1. As a player, I want a supported opening to start without a full-document deep-read, so that the first turn is not blocked by preparation the turn does not need.
2. As a player, I want the table to search the whole document for a late-book location, so that an oddly labeled clue is not missed because it sits far from the opening.
3. As a player, I want a clinic-hours question answered from source, so that I get a real answer without inventing campaign state.
4. As a player, I want an ordinary conversation with a willing NPC to use minimal private narrative material, so that the scene works without a full stat block.
5. As a player, I want a rule operation to use only the parameters and conditions it actually needs, so that unrelated subsystems are not fabricated.
6. As a player, I want unsupported combat or chase actions to stay on existing handling, so that partial bindings never produce fake mechanics.
7. As a player, I want UNKNOWN to mean unknown, so that a missing stat is never silently treated as zero or ready.
8. As a player, I want the Keeper to interpret causal and novel content, so that no relevance score automatically advances the plot or reveals a secret.
9. As a player, I want a same-NPC refinement to update in place, so that earlier accepted identity and conflict information is not lost.
10. As a Keeper operator, I want whole-document text indexing to run without blocking play, so that navigation improves without a semantic deep-read.
11. As a Keeper operator, I want sparse and scanned pages flagged as unknown coverage, so that the system does not claim it read a page it could not.
12. As a Keeper operator, I want page roles to be routing hints only, so that a multi-label page is never hard-excluded from discovery.
13. As a Keeper operator, I want private module retrieval separated from public admission, so that Keeper-private facts never influence player consent.
14. As a Keeper operator, I want existing graphs and saves preserved, so that adopting the new path does not discard prior campaign work.
15. As a Keeper, I want final context bounded and honest about omissions, so that I do not read a misleading claim that the whole corpus was checked.
16. As a Keeper, I want a missing MRI or other absent fact to stay unsupported, so that the system does not hallucinate evidence.
17. As a rules maintainer, I want eligibility derived from the current scene, exact player words, and public authorized facts, so that rule families are relevant and auditable.
18. As a rules maintainer, I want rule, skill, check-needed, and host-known-slot decisions fanned out independently, so that one missing fact does not corrupt the others.
19. As a rules maintainer, I want missing facts treated as missing rather than false, so that preconditions are not silently satisfied.
20. As a rules maintainer, I want mechanics readiness to be operation-specific at resolve and apply, so that no unused Boolean bag claims readiness.
21. As a rules maintainer, I want the compiler and kernel to bind numeric, source, and runtime values, so that Jev never does arithmetic or fills stateful slots.
22. As a rules maintainer, I want no-rule and uncertain to be legitimate, so that the system does not force a check where none exists.
23. As a rules maintainer, I want ordinary checks bound first, so that unsupported subsystems remain on their existing path until their bindings pass.
24. As a developer, I want one document cache and one Jev decision seam, so that the module path does not grow a generic workflow engine.
25. As a developer, I want the kernel to never parse PDFs, so that document parsing stays in a rebuildable host cache.
26. As a developer, I want native text first with the visual reader on demand, so that the first slice needs no new OCR vendor.
27. As a developer, I want exact source prose to use A's references, so that the graph does not store duplicated long text.
28. As a developer, I want stable identities, aliases, provenance, secrecy, and causal dependencies in the graph, so that executable behavior has a home.
29. As a developer, I want a small incremental graph, so that node-per-sentence and mandatory full-story graphs are avoided.
30. As a developer, I want index discovery to work without an existing node, so that a brand-new topic can be found before any graph identity exists.
31. As a developer, I want a fresh opening to amend the skeleton contract explicitly, so that removing the whole-module skeleton prerequisite is a named change rather than a silent regression.
32. As a developer, I want existing campaigns to continue through existing graph and effective-view code, so that migration is incremental.
33. As a developer, I want Jev-assisted construction to select among host candidates, so that all-pairs full-book relation explosion is avoided.
34. As a developer, I want identity ambiguities returned unresolved, so that the host does not guess a merge.
35. As a developer, I want every proposed relation to reach existing graph readers and actual game use, so that no second graph or truth store appears.
36. As a developer, I want novel entity discovery and cause interpretation to stay with the tool-enabled source reader when closed candidates are insufficient, so that Jev is not asked to invent world truth.
37. As an adapter maintainer, I want native host fetch to the official endpoint and a pinned model, so that upgrades are deliberate re-evaluations.
38. As an adapter maintainer, I want shared state with independent questions and no same-batch answer dependency, so that speculative variants are routed by the host.
39. As an adapter maintainer, I want a common absolute caller deadline and cancellation, so that optional work cannot silently become seconds.
40. As an adapter maintainer, I want bounded foreground-first concurrency, so that document discovery does not starve the player-visible turn.
41. As an adapter maintainer, I want answer coverage validated and bound to model, family, revision, campaign, and audience, so that stale or foreign answers are rejected.
42. As an adapter maintainer, I want credentials only in the existing host vault, so that no secret reaches the renderer, logs, or repository.
43. As an operator, I want the Jev capability optional, so that an unconfigured or unavailable table reuses the incumbent or existing unavailable result.
44. As an operator, I want admission to never fail open, so that faster preparation never weakens safety.
45. As a security reviewer, I want Jev classifiers outside the security boundary, so that adversarial text is not treated as safe merely because it was classified.
46. As a reviewer, I want no blanket second complete agent review after an accepted migrated typed decision, so that migrated work actually gets faster.
47. As a reviewer, I want new visual or ambiguous evidence to still use the source reader and reviewer, so that text-only decisions never replace visual proof.
48. As a reviewer, I want accepted exact source references reused with freshness checks, so that already proven evidence is not re-reviewed from scratch.
49. As a tester, I want off-script clinic retrieval tested from the opening before a graph node exists, so that discovery independence is proven.
50. As a tester, I want alias and paraphrase queries tested without the literal word, so that lexical retrieval is not the only path.
51. As a tester, I want NPC talk separated from stats and procedure pages separated from rule pages, so that page-role routing is proven.
52. As a tester, I want sparse and map pages tested as explicit unknown fallback, so that the system does not claim coverage it lacks.
53. As a tester, I want hostile source, cross-campaign, cancellation, and stale-binding cases tested, so that scope and freshness are enforced.
54. As a tester, I want same-NPC additive refinement and reload tested, so that in-place refinement is idempotent and conflict-guarded.
55. As a tester, I want omitted private motives tested so they do not vanish, so that retrieval does not silently drop Keeper-private material.
56. As a tester, I want plan compile distinguished from actual resolve, so that a compiled plan is not mistaken for execution.
57. As a tester, I want no mutation before acceptance tested, so that answer-only consultation cannot change state.
58. As a tester, I want re-request idempotence tested, so that repeated preparation does not duplicate nodes or receipts.
59. As a tester, I want an ordinary check to execute exactly once through the real kernel, so that fan-out does not double-roll.
60. As an operator, I want component latency and cost reported with median and tails, so that the practical speed advantage is measured honestly.
61. As an operator, I want cold and warm preparation measured separately on the same source and intent, so that caching effects are not hidden.
62. As an operator, I want false blocking and missed required facts reported, so that speed never silently trades away correctness.
63. As a maintainer, I want each migrated bounded decision family to remove its old unconditional generative work, so that the measured foreground slice actually shrinks.
64. As a maintainer, I want whole-turn gain claimed only when measured, so that component speed is not overstated as turn speed.
65. As an operator, I want the existing optional workspace 500 ms deadline kept separate from document discovery, so that a slow document search does not masquerade as a workspace timeout.
66. As a maintainer, I want unknown, incomplete, refusal, and transport failures kept apart, so that failure policy is precise.
67. As a maintainer, I want no default unlimited retries and no assumed rate-limit or concurrency guarantee, so that capacity claims stay honest.
68. As a future agent, I want implementation slices with concrete completion criteria, so that the architecture can be delivered incrementally.
69. As a player, I want one tool call to finish a bounded objective that needs several dependent steps, so that I do not experience repeated Keeper roundtrips for one action.
70. As a Keeper, I want the tool to adapt its own next step to what it just observed, so that a second step can build on a fact fetched in the first.
71. As a Keeper, I want outstanding evidence needs reported honestly when they cannot be satisfied, so that a partial task is not presented as complete.
72. As a player, I want semantic recall across retained memory and transcript by goal, so that I find relevant past material without guessing exact wording.
73. As an operator, I want a task to stop or reroute when it makes no progress, so that an unproductive loop cannot run up time and cost.
74. As a player, I want resolve and apply to settle exactly once even after a lost reply, so that a roll or mutation is never repeated.
75. As a developer, I want the outer sequential loop kept distinct from inner parallel questions, so that no answer is assumed before it is observed.
76. As a player, I want relevant retained memory and transcript recalled by goal and current turn, so that established fiction, including an old NPC promise or reward, is honored without my repeating exact wording.
77. As a Keeper, I want memory writes to classify duplicate, new, reinforcement, contradiction, explicit correction, temporal change, unrelated, and unknown, so that independent claims coexist and contradictions are preserved.
78. As a Keeper, I want retrieval to return original source spans, current validity, counterevidence, and honest coverage, so that I settle or narrate from evidence rather than a generated summary.
79. As an operator, I want memory writes and recall to be receipt-backed and idempotent, so that a restart or repeat call cannot duplicate a one-time effect.
80. As a player, I want the table to answer from memory even when extraction lagged, so that a missing index does not erase an established promise.
81. As a Keeper, I want low-importance or deferred facts held in the backlog, a row's privacy no weaker than its source, and unresolved coreference reported honestly, so that facts remain retrievable without being invented or over-exposed.

## Implementation Decisions

Complete tool tasks are the primary design. Each public tool invocation owns one bounded objective and drives the adaptive loop described above; the existing reader, index, graph, history, and rule functions are the operations the loop calls. Outcome semantics, permissions, and commit policy stay with the owning tool.

Tool task inventory:

| Tool | Complete task objective | Bounded operations and existing functions | Commit and limits |
| --- | --- | --- | --- |
| look | Read the current exact scene or source view; no semantic gap expected | Existing exact read | Zero-Jev fast path |
| lookup | Answer or prepare from source, module, rule or catalog, secret, continuity, or adaptation per requested mode | Wider candidate partition; selected source spans or pages; cited source references or allowed graph neighbors; printed rule or catalog fields; support, completeness, and contradiction checks; source-reference materialization; finish, missing-data, player-decision, or gap handoff | Source prepare publishes only through accepted-source finish; module and secret stay read-only and inside existing authority; answer-only cannot mutate; rule numbers and catalog records are host copied; missing required numeric fields stay unknown |
| recall | Whole memory read/use loop over retained memory and transcript plus existing exact or page reads | Wide authorized candidate retrieval; Jev relevance, usefulness, currency, support, and contradiction judgments; follow entity, episode, source, correction, and temporal links; fetch original spans; re-evaluate coverage; sufficiency assessment; bounded result | Read-only; decided rule below: optional query with what, turns, role, about, kinds and other existing scope filters; a nonempty query selects task mode while combining it with direct read or detail rejects invalid_params; absent query keeps exact and paginated behavior unchanged |
| resolve | Derive decisions, skill candidates, session restrictions, and slots through the existing kernel preflight and commit barriers | Semantic rule and skill disambiguation; missing-source evidence; ordinary checks first | Kernel owns arithmetic, dice, target values, consent, session order, and receipt creation; unknown stateful subsystems keep existing paths |
| apply | Atomic validated whole-batch kernel effects | Match existing objects and definitions; classify supplied use and requirements; choose an existing compatible structured profile; bind records | Whole batch is atomic and never partially committed; new content and mechanics definitions stay with the bounded generator and existing validation; admission remains a separate semantic-family candidate over public context |
| ask | Structured player interaction and pending-choice handling | Closed-set match of the actual next reply when necessary and unambiguous; shared optional-text audit through narrate checks | Never chooses for the player; exact enum and choice replies remain local |
| narrate | Keeper prose with task-scoped evidence support | Per-line and per-claim source support, intelligibility, response relevance, secrecy, choice and identity and receipt consistency; another retrieval iteration when referenced evidence is missing | Host uses A references and selected existing defect reasons; complex unresolved judgments and novel repair prose return to the existing Keeper or scoped reviewer; no new narrator agent and no full duplicate reviewer for accepted migrated families |

Semantic recall uses optional query with what, turns, role, about, kinds and other existing scope filters. A nonempty query selects task mode; combining it with direct read or detail rejects invalid_params. Without query, existing exact and paginated behavior is unchanged. Internal traversal follows existing host-bound continuation objects; the final result retains the 12 KiB/20-row caps, exact originals, correction/supersession annotations and honest remaining coverage. Host code explicitly converts existing external Unicode code-point ranges to A internal UTF-16 ranges; models compute neither. The query participates in snapshot and continuation binding.

The internal-work replacement inventory in the research document extends this seven-tool facade; it is a design inventory, not a new public schema.

### Memory lifecycle: write/organize and read/use loops

Memory is two adaptive tasks over shared infrastructure, not a promise patch: a write/organize loop and a read/use loop. Both use the shared host-issued reference contract, Jev typed decisions, bounded evidence, and existing memory owners; neither adds a public verb or store.

Write/organize loop. From a committed turn the host prepares exact source spans (spoken lines, player and Keeper text, receipt fields) with context and source scope. Jev decides what is worth retaining and supplies independent semantic metadata. When relationship or novelty is unclear the host fetches relevant older memory and original evidence, and Jev classifies the relation as duplicate, new, reinforcement, contradiction, explicit correction, temporal change, unrelated, or unknown. The host validates and commits through the existing memory job and submit owner, then updates incremental indexes and existing read projections. The loop repeats only for a genuinely new observation; independent questions batch and dependent ones wait. It replaces regular generative extraction for accepted candidate families, not "run Jev and always run the original extractor." Routing capability is chosen before the job claim; a configured Jev path does not require an available generative client unless a scoped fallback is needed.

Read/use loop. From the current scene, exact player action, new actual receipts, and query goal, the host performs wide authorized candidate retrieval. Jev judges relevance, usefulness, current applicability, support, and contradiction, and selects entity, episode, source, correction, and temporal links for the host to follow and fetch original spans. Jev reassesses semantic sufficiency; the host checks retrieval coverage and assembles bounded context with original sources, counterevidence, and uncertainty for the existing Keeper or tools. Several Jev rounds may run inside one tool or context task. The player and Keeper need not remember an exact NPC, date, or wording, and retrieval is not limited to the recent top twelve. A cold, missing, or lagged index falls back to retained originals. Query and cache binding include worldline, source, and context revision; default scope is authorized scope only.

Reference-first shape. A row stores host-issued source span or record-field references plus typed annotations and explicit links; the host copies original material into legacy views when needed. Jev selects and classifies; it does not generate statement prose, offsets, identifiers, hashes, or numbers. Annotations cover retain/skip/defer, kind, subject/knowers/about from supplied names, privacy constrained by source audience, epistemic status, validity and timeline indicators, old-target links, and useful topic or category choices. Attribution, negation, condition, and time are preserved with source context. A paragraph is not necessarily one fact: one span and host-prepared finer segments may support multiple source-backed interpretations without dropping context. Broad source uses more than one span with separate provenance and never pretends a concatenation is one verbatim quote. Numeric terms already in receipts or quoted source are host-bound and not lost because the legacy generated statement forbids numbers. An unknown entity link stays unresolved with the raw source retained, not invented or silently discarded.

Interface migration. Amend the existing memory job and submission contract to offer selectable immutable spans plus entity and older-record packets and to accept typed selections, annotations, and relations; the host materializes compatible read views. Legacy freeform statement rows are tolerated and preserved. Any novel generated summary is optional, marked derived, source-linked, and not canonical fact. A genuinely new abstraction, unresolved coreference outside offered candidates, or truly novel interpretation may use the existing generative owner for that gap only. Default ordinary saving must not need a new summary generation, no new memory database, global graph, or mandatory embedding provider is introduced, and no restore-memory Python implementation appears.

Maintenance. Distinguish exact duplicates, the same fact from more than one source, independent claims, time evolution, and explicit correction. Sharing an NPC or subject pair is not replacement authority. Do not merge secrets with public claims or erase contradictions for low relevance. Verified links target actual prior records. Project current valid views while keeping old source and history; Jev may cluster, select, or hide from current context but does not delete originals or rewrite Git. Low importance means not in current context, not never retrievable. Long-term consolidation may use extractive evidence groups and indexes; new abstractive prose is optional and not an LLM-required cache phase. Model confidence is not truth or permission to promote module facts.

Host ownership. Jev returns a classification proposal only; schemas, revisions, campaign and worldline scope, allowlists, idempotence, persistence, and Git remain host/kernel responsibilities. Privacy may not be less restrictive than the owned source. The async queue, backfill, and cancellation are unaffected, and narration is not blocked by index work. Independent classifications over a fixed snapshot run in parallel; mutations depending on older memories must rebase and commit in source order rather than race contradictions or supersession. Bounded evidence and row-batch limits are per-batch limits, not a silent drop of the thirteenth worthy fact: explicit batch cursor, coverage, and completion semantics in the existing job are required beyond twelve rows, and deferred work stays in the backlog. Unknown and deferred are incomplete, not complete. No unbounded cross-campaign batch or whole-history reclassification every turn. Indexes are incremental, rebuildable, and model, family, and source-versioned, not a new truth store.

Retrieval is read-only. A conflict found during recall does not silently mutate canonical rows; it returns provenance and the current read projection, or a scoped maintenance candidate to the existing write owner, not an unbounded hidden background task. Source graph and world changes happen only through existing apply, resolve, or accepted publication. Shared task-loop budget, no-progress stop, exact original extraction, and stale and cancel policy follow the current general tool specification. The former promise case remains a general downstream action case, not the memory architecture. Its important case is preserved: a very old non-module promise, current completion, actually applying the reward, receipt closure exactly once, two independent promises, and partial payment. Its legitimate world mutations are owned by apply, not the memory write or recall task.

Producer/reader/actor. Committed records plus host span packets feed Jev selection and proposals; the existing memory submit validates and saves; derived indexes, the current capsule, and recall expose them; the Keeper and tools use them; downstream receipts feed the next memory job and future retrieval. New semantic classifications must reach real consumers. The existing story-alignment assessment keeps its acquired-evidence gates; typed classification may replace accepted parts, but new semantic explanation remains generation. Preserve story-alignment output or migrate only its accepted typed questions; do not silently drop it.

Promise example (a general downstream action case): A verified, still-valid, due NPC promise of a reward is recalled and paid through existing mechanics when its terms and delivery circumstances are met, even when the module never declares it and the promise is many turns old. Query context includes the current action and actual completion receipts, not just recent dialogue; retrieval widens to retained original committed speech when the index lagged. Recall returns exact terms, condition satisfaction, current validity, contradictory evidence, and specific original turns to the Keeper. Fulfillment is grounded in source speech plus completion evidence and applied through existing apply paths with a receipt; recall never mutates. Fulfillment linkage commits atomically so a restart cannot pay a one-time reward again, independent promises coexist, and partial payment does not close the whole promise. This is a requirement, not implemented proof.


Lookup submodes:

| Submode | Decided behavior |
| --- | --- |
| source | Full adaptive answer/prepare task with original trust and explicit scope. |
| module | Exact local fast lookup first, then Jev semantic candidates, type disambiguation, and bounded existing graph neighbors; no silent PDF preparation or adaptation from a miss. |
| rule | Semantic family/candidate selection then authoritative field retrieval; kernel legality remains. |
| catalog | Semantic record/variant matching; host copies prices, numbers, units, and provenance; unknown required values are not defaulted. |
| secret | Deterministic scope projection kept; optional query-specific selection only; no disclosure or acquisition changes. |
| continuity | Select existing relevant causal chains and counterevidence; receipt-backed knowledge and actual graph relations remain authoritative; no fabricated causality. |
| adaptation | Existing-anchor/rebinding selection and conflict classification replace closed subtasks; status and cancel remain local; new destinations or novel descriptive proposals retain existing author/review/acceptance. |

Host internal terminal outcomes are explicit: complete, partial, unresolved, needs_player, pending, failed, cancelled. Each maps to the owning tool's existing result or error interface rather than a new public universal result schema. Source context changes invalidate affected observations and require revalidation before publication or commit; no cached Jev pass survives a foreign revision. State mutation or a genuine player choice is a stop or commit point, not another unconstrained read-loop action.

Document cache and coverage:

- Retain original PDF identity and page images and build a rebuildable page text, span, and navigation cache from native text first. This is a PROPOSED contract change from the current visual-reader policy; the kernel never parses PDFs, and the first slice uses native text plus the existing visual reader on demand with no new OCR vendor.
- Sparse, scanned, and image pages are explicit unknown coverage with existing original-page and contact-sheet navigation, and whole-document indexing runs without full-document deep-reading or blocking a supported opening.
- Page text snapshots, physical pages, and extraction revisions are host bound; the model sees semantic aliases or ordinals, never authored offsets. The cache reuses A's page, span, and field selection contract; no second page locator is defined.
- Each page record binds document revision, physical page, extraction revision, exact text and span mapping, image availability, navigation hints, coverage, and separately versioned roles. A source packet binds the exact question, source and context revision, audience, selected references, atomic support outcomes, coverage gaps, and unresolved needs. Classification metadata never becomes an accepted source fact.

Page roles and retrieval:

- Jev page roles are multi-label (scene, NPC, monster, statistics, plot or causal, clue, handout or map, additional rules, navigation, other, unknown) and are routing hints, not hard filters or coverage evidence. A numeric-statistics requirement is a separate current-action decision, not a consequence of a page containing an NPC.
- Before any current-scene graph filter, search the whole available document universe in bounded partitions; exact-name and alias lexical retrieval plus graph links supplement rather than prevent semantic discovery. Widen candidates and questions, preserve counterevidence, return a bounded source packet, test atomic support and existence individually, and allow none, unknown, or partial; adopt no universal relevance gate.
- Answer support for hours is separate from care availability, exact route, stats, and rules. Jev cannot generate keywords; use supplied labels or an existing Keeper paraphrase opportunity and count the extra generation cost.

Adapter and provider facts:

- Use native host fetch to the official `POST https://api.typesafe.ai/v1/systemone` endpoint and pin `jev-1.13.0`, with Choice, Score, and Noul, shared state, independent questions whose instructions name their targets, no same-batch answer dependency, and host-routed speculative variants.
- Use bounded foreground-first concurrency with a common absolute caller deadline and cancellation, validate answer coverage bound to model, family, source or candidate revision, and campaign and audience, and keep credentials only in the existing host vault. The capability is optional: absent or unavailable reuses the declared incumbent or existing unavailable result, and admission never fails open.
- No blanket second complete agent review follows an accepted migrated typed decision. New visual or ambiguous evidence still uses the source reader and reviewer, accepted exact source references can be reused with freshness checks, text-only Jev cannot validate new visual facts, and selective typed text checks replace generative checks only after family acceptance and the required domain contract update.
- Official [models documentation](https://docs.typesafe.ai/models) states 64k total state plus all questions, 32k state plus longest question, text-only, $0.042/M input, output free, and dynamic 250k tokens/s and 1200 requests/min. [`semantic_find`](https://docs.typesafe.ai/cookbooks/semantic_find) states Choice supports up to 255 options. Use a conservative 32k total packing ceiling with headroom and split choices rather than one larger one-hot.
- Confidence is not correctness; do not copy the claim that arbitrary extra questions add no latency; keep the optional workspace 500 ms deadline separate from document discovery; there is no default unlimited retry; unknown, incomplete, refusal, and transport failures stay distinct; rate limits and configurable concurrency are not guarantees.

Seams:

| Producer | Reader | Actor |
| --- | --- | --- |
| Host extraction and role classification | Private source lookup | Keeper or source reader selects original material |
| Tool-task Jev decisions plus host reference resolver | Existing material or plan construction | Current graph or RuleGraph consumer |
| Scoped reader plus validated module finish | Current capsule and resolve or apply | Unchanged campaign transaction and receipt path |
| Host source-selection packets plus tool-task observations | Shared resolver and result binder | Existing audit, presentation, or reading submission |

Preserved earlier named uses remain later independent consumers of the same adapter and references, not prerequisites for the module path: speech and voice checks, correction linking, the advisory verifier, wider workspace retrieval, and later admission or complex continuity. Respect per-line coverage and current repair reasons, require explicit contract and semantic acceptance to migrate prose reasons to defect categories, and do not duplicate a full reviewer after switching.

The source registration audit additionally covers one onboarding tool and five private helper tools beyond the seven PLAY verbs. The audit covers the seven play tools, setup, their internal semantic jobs, and these helper tools; general coding-agent filesystem and shell tools are execution primitives, outside this product redesign.

| Tool | Retained role | Jev boundary |
| --- | --- | --- |
| setup | Match a stated occupation, skill, or equipment concept to existing catalog candidates, select the active brief slot for an actual player answer, and identify changed profile fields. | Kernel owns step ordering and prerequisites, original card identity, numeric pins, allocation and rerolls. Host copies the actual answer and existing values; new biography stays with the generative owner. Confirmation and reroll require existing player authorization; a loop stops at such decisions and does not turn a semantic classification into consent. No new setup agent or new tool is introduced; this is a later closed-candidate subtask after lookup and catalog acceptance. |
| pdf and read_audit_evidence | Retained deterministic evidence access, optional targets chosen by Jev within the current task. | PDF text navigation can feed the Jev loop; image-only observations require the existing visual reader, not passing an image to text-only Jev. These are execution capabilities, not functions to replace with a model. |
| submit_reading, submit_audit, submit_adaptation | Retain deterministic artifact checks, scope/source/lease validation and checked final submission. | Jev-selected fields and references may be materialized into eligible artifacts; no semantic result bypasses validation or changes trust by itself. |

Implementation slices:

1. Shared reference contract plus Jev adapter foundation; completion means resolver and adapter contracts exist with deterministic tests and no product wiring. Accepting the shared resolver and document-reference slice enables later work before all A workflow migrations complete.
2. First complete adaptive goal loop for lookup source; completion means off-script discovery from the opening before a graph node exists, a demonstrated case needing at least two dependent rounds, while exact or already-supported cases may finish with zero or one, alias and paraphrase queries, and honest unknown coverage.
3. Lookup module, rule, and catalog loops, plus the whole memory lifecycle (write/organize and read/use) as an explicit first-class vertical slice that may proceed alongside the lookup-source task rather than leaving only correction matching as a late afterthought; completion means semantic candidate search and bounded expansion inside existing authority with no silent PDF or world mutation, memory writes classifying and linking through the existing job/submit owner, retrieval returning original spans with counterevidence, and the former promise case as one required end-to-end example, with A references and kernel receipt linkage as explicit dependencies and no incidental production fixes.
4. Lean opening and refinement plus ordinary resolve pre-commit loops; completion means minimal root and opening, in-place same-NPC refinement, additive conflict guards, and an ordinary check executing exactly once through the real kernel.
5. Bounded narrate, voice, verifier, and correction checks after the needed references; completion means each migrated bounded family removes its old unconditional generative work and reports its measured foreground slice.
6. Apply define, usage, and adaptation closed subtasks plus admission separately domain accepted; completion requires that domain's own contract and acceptance evidence.
7. Pure projections and state transitions stay deterministic; there is no scope creep beyond the inventoried tasks.

No spec-only claims of source readiness.

## Testing Decisions

- Use current seams and retained cases, not a new evaluation platform.
- A good test asserts external behavior: discovered candidates, resolved source, prepared graph material, executed kernel operation, receipts, and player-visible turn outcomes, not implementation-private structures.
- Primary seam A: the existing source lookup and prepare queue with the real seven-verb contract.
- Primary seam B: the existing ModuleGraph, RuleGraph, capsule, resolve, apply, and receipt path.
- Primary seam C: the existing retrieval and typed-decision behavior for latency, cost, quality, and coverage.
- Primary seam D: the existing real Grok table method in the play driver through the host launcher with the main session as sole player.
- One tool invocation that requires at least two dependent Jev and action rounds returns a complete scoped result without Keeper babysitting.
- The second step depends on a first fetched fact and is not pretended to be a same-batch dependency.
- Multiple mutually independent branches run in parallel within one task.
- An exact millisecond read uses the zero-Jev fast path.
- A repeated target or no-progress task stops or reroutes rather than retrying indefinitely.
- A preparatory discovery cycle that expands a relevant candidate frontier without yet answering the requirement counts as progress and does not stop the task.
- Partial evidence, false-completion pressure, and contradictions are covered.
- Callback cancellation, stale context, and campaign isolation are covered.
- The task budget includes all rounds and fallbacks and is not reset internally.
- All ask and player-choice paths survive, including a genuine player decision stopping the task.
- Resolve and apply settle exactly once, including a lost reply and whole-batch atomicity.
- Whole memory lifecycle behavior is tested beyond promise: world events, contradictory NPC beliefs, relationship evolution, player preferences and assertions, explicit correction and retraction, NPC knowledge, secrecy, and promises; plus free-paraphrase queries, off-scene old memory, and a current-turn receipt trigger.
- Storage and classification tests assert that output covers all source exactly without rewrites, no malformed quote or identifier appears, and valid new metadata reaches both memory submit and the capsule or recall; same-entity independent claims coexist; an actual correction targets the right duplicate; a temporal update preserves historical truth; and knowledge is not promoted from a mere claim.
- More than twelve worthy segments are processed or honestly deferred; missing-index and async-backlog recovery, old-schema reads, duplicate-job replay, stale context, worldline isolation, private versus public handling, pronouns and negations, mixed language, and late historical backfill not using current world state are covered; retrieval that is too narrow expands, and unsupported answers do not become complete.
- The promise example remains one case: a non-module gift promised long ago is recalled after many turns using different wording when the NPC is no longer in recent memory, completion is proven, and the reward is applied and received exactly once; negative cases include no original promise, a claimed promise, a revoked or corrected promise, another worldline, already rewarded, restart with a different call id, two independent promises by the same NPC to the same beneficiary, memory-lag fallback, and partial payment that must not close the whole promise.
- Component tests prove the producer, reader, and actor contracts without fake Keeper play, and the current real Grok table proves adoption.
- Off-script clinic retrieval is tested from the opening before a graph node exists, and the same alias or paraphrase is tested without the literal word.
- NPC talk versus stats, and separate procedure versus rule pages, are tested.
- A missing MRI stays unsupported; map and sparse pages are tested as explicit unknown fallback.
- Same-NPC additive refinement and reload, omitted private motives, first-aid sparse flags, plan compile versus actual resolve, no mutation before acceptance, and re-request idempotence are tested.
- An ordinary check is tested to execute exactly once through the real kernel.
- Traces are host-owned and record, per tool task id and goal, model, snapshot, iteration, offered and selected actions, observed references, budgets, terminal reason, and commit receipt.
- Acceptance measures the whole tool task and the number of Keeper and tool roundtrips as well as each Jev call, cost, and fallbacks; it does not demand a fixed single call or fixed turn count.
- Real tabletop uses only the existing play driver RPC through the host launcher with configured Grok and the main session as sole player, one natural turn each, never scripted and never a fake Keeper.
- Holdout wider coverage is collected during implementation, not through more probes this turn.

Speed acceptance:

- Instrument exact components plus source-ready, opening, player-visible turn, and whole tool task.
- Measure with the same source, model, and user intent; measure cold and warm separately.
- Compare the current agent route, refs-only, Jev with same candidates, and wider-recall demand graph; do not use a repeated full-reviewer baseline in the optimized path.
- Report median and tails, errors, false blocking, missed required facts, total input and cost, and fallback costs.
- Each migrated bounded decision family must remove its old unconditional generative work and reduce that measured foreground slice at non-regressed critical correctness; claim whole-turn gain only when measured.
- Measure whole write-job time plus backlog drain and whole query/context time, raw span retention, false merges, wrong corrections, missed recalls, and cost, not just per-API-call latency.
- Do not invent production deadlines or 100 percent guarantees from a small sample.

Pass criteria:

- Discovery finds a late-book or oddly labeled source before a current-scene graph filter and without an existing node.
- A supported opening starts without a full-document deep-read and without the whole-module skeleton prerequisite.
- A clinic-hours question is answered from source without creating nodes or state.
- Ordinary conversation uses minimal private narrative material, and the same NPC refines in place.
- An actual rule operation uses only necessary typed parameters and conditions; UNKNOWN is not zero, default, or ready.
- An ordinary check executes exactly once through the real kernel, and unsupported subsystems remain on existing handling.
- Unknown and incomplete coverage are reported honestly.
- No result claims implemented, accepted, or production-threshold quality until authorized evidence exists.
- No secret appears in repository files, commands, prompts, renderer state, or generated docs.

## Out of Scope

- Implementing this specification in this turn.
- Running builds, tests, model probes, provider calls, true table runs, or packaging work in this turn.
- Persisting any new key or changing configuration.
- Replacing the TypeScript kernel or adding a Python kernel.
- Replacing PDF page-image source reviews or independent source proof with text classification.
- Restoring a retired OCR or Markdown production path.
- Asserting graphless play or accepted full automation.
- Building a generic workflow engine, campaign-truth store, second graph store, or global knowledge store.
- Preemptive full future plot extraction.
- Claiming production thresholds, throughput, p95, or accuracy from diagnostic probes.
- Fake Keeper loops, scripted players, or synthetic tests labeled as playtests.
- Committing or staging changes.

## Further Notes

- Tracking issue: [#101](https://github.com/Leehow/chatrpgv4/issues/101).
- Related preceding issue: [#100](https://github.com/Leehow/chatrpgv4/issues/100).

- Detailed source inventory, trace paths, provider-source summaries, probe data, and validation matrix are in [the research document](../research/jev-and-source-references-20260919.md).
- The source-reference refactor is a separate specification with separate acceptance: [Verbatim source references](verbatim-source-references.md).
- Local prototype READMEs retained for design input: [rule routing](../../.pi/prototypes/jev-rule-routing-20260919/README.md), [PDF routing](../../.pi/prototypes/jev-pdf-routing-20260919/README.md), and [lean graph](../../.pi/prototypes/jev-lean-graph-20260919/README.md). Their capture branches are local and have not been pushed. They test components only, not this new adaptive controller.
- Primary provider facts: [models](https://docs.typesafe.ai/models) and [`semantic_find`](https://docs.typesafe.ai/cookbooks/semantic_find).
- B span-dependent consumers must reuse A after its contract is accepted rather than inventing a second page or span locator.
- Existing preceding workspace and retrieval constraints are not duplicates created by this spec; do not edit those issues here.
- Prototype component timings, branches, and commits are retained in [the research document](../research/jev-and-source-references-20260919.md); they test components only and do not test the adaptive controller or the memory loops.
- The earlier source-app sample recorded 46 lookups, 38 success, 8 fail, 6 reading_timeout, 2 preparation_wait; one case showed graph lookups 13-15 ms, source author 66.505 s then slowest review 87.742 s and front wait 120.003 s. This is a retained Sept 18 call, not a current general failure rate.
- Keep previous Jev prototype timings intact as component evidence; they do not test the new adaptive controller. The full task loop is proposed and requires implementation acceptance; do not say it is already tested.
- Do not call the lean prototype full accepted graph generation, graphless play, total prep speedup, or no-LLM extraction.
- The document-page native-text snapshot and page, span, and field selection contract is shared with A; B does not define its own page locator.
- Publication records the specification; implementation and product acceptance remain separate subsequent work.
- Each consumer must set its own latency budget after implementation measurements; no global Jev budget is adopted here.
