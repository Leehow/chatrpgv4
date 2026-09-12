# Story Continuity and Adaptation: midgame causal clarity

_Date: 2026-09-12. Baseline: 0.9.2a at 825f4719d72b16702b28e5a1e5e60404a9f109fa. Status: implementation present; acceptance partial. Authoritative execution plan: [../plans/story-continuity-and-adaptation.md](../plans/story-continuity-and-adaptation.md); implemented continuity-review wire contract: `docs/kernel-rpc.md` §35.14._

**Current decision note (implemented).** Faithful recap, coherent new campaign detail, attributed assertion/hypothesis and kernel-authoritative state are distinct. Missing literal source proof alone is not a failure. The old audit.source.v1/narration-audit1.1.2 remains a retained legacy implementation; audit.continuity.v1 is implemented in narration-audit1.2.4 with enhanced-items1.1.9 under kernel-rpc section35.14. Bounded regressions, fixed-input probes and genuine-play continuation have now been measured; human UI acceptance remains pending. See [current repair results](../research/continuity-review-repair-2026-09-12.md). All prior rejection evidence and childhood/kinship retractions remain preserved.

## Problem Statement

Players report that a campaign can become a shallow improvised detour. This is user-reported experience, not a reproduced universal causal proof. The important case is midgame: players may accept the adventure, acquire many receipts, pursue a reasonable theory, and still fail to connect the facts with the central conflict. An opening refusal and departure to Greece is one example, not the primary problem.

Existing prompting and pacing already permit clarification and initiative. A code survey nevertheless supports structural shortcomings: projections emphasize local authored opportunities and acquired handles, while no shared bounded view joins delivered evidence, explicit player interpretations, unresolved causes, and source-backed opportunities. Thus a Keeper can be forced to choose between repeating a clue and inventing thin filler, even when the table is active. This specification does not claim every improvised turn is meaningless or that the Keeper currently cannot clarify.

The Director's `stalled_turns` means turns with no clue, move, or session receipt; `empty_turns` means turns with no receipt of any kind. They are useful diagnostics, not comprehension measures. Existing memory has closed kinds including `belief`, `player_assertion`, and `player_preference`; it has no dedicated `plan` kind. An expressed plan may be retained in statement content of an appropriate existing kind, without claiming a new schema kind. `mainLineComplete` and acquired support handles are not understanding.

Success is causal clarity: a player can grasp what is happening, how encountered facts relate, why it now affects someone or a chosen interest, and where intervention is possible, then respond, decline, or change course. It is not a quiz, forced quest, prescribed scene order, guaranteed ending, or hidden-truth rewrite.

## Solution

Add a bounded continuity capability using the existing seven Keeper verbs. It has two parts: a shared projection builder and optional campaign-local adaptation. The projection joins source relations, public delivery, current world state, expressed interpretations, and authored possible developments. The Keeper performs semantic synthesis and chooses whether to explain, disclose, act, relocate a carrier, or prepare an adaptation. The kernel validates structure and state; it does not infer understanding.

Use one shared continuity projection builder. When its relevant package is active, an existing story-thread context gains a bounded `connections` portion. This is not a tenth capsule/top-level section and not a separate scenario database. A focused `lookup` of kind `continuity` exposes the same builder as a base capability, including when craft Mods are off. The model supplies semantic anchor names—existing entities, conclusions, or known clues. The kernel resolves names and traverses explicit source relations; it never parses the goal's meaning. Default anchors may include the current scene, present entities, and recently settled or disclosed source-linked entities. Whole-book retrieval remains on demand and bounded, with explicit truncation and missing-information reporting; the entire graph is not sent to the Keeper each turn. Relevant already-acquired relations remain retrievable beyond local adjacency.

A connection row joins a causal claim, supporting and contradicting evidence, prior delivery references, related NPC knowledge and motive, and any authored possible next development. Every component retains origin and disclosure status. No belief or understanding boolean is stored. Draft proposals appear only in explicit Keeper-side proposal status and never enter the effective graph as facts.

The five available interventions are not an escalating order:

1. Free plain clarification of already public relationships.
2. Deliberate delivery of an existing authored witness or evidence.
3. A motivated NPC or world initiative—testimony, arrival, demand, or demonstrable consequence—with cause and fair warning.
4. Relocation or rebinding of an existing clue carrier when ordinary structure cannot deliver it.
5. A coherent unused source-connected fragment adapted to the campaign's course.

A Keeper may notice a missing connection semantically in a live exchange while both counters are zero, including an active player collecting many receipts. There is no numeric detector, compulsory per-turn review call, or required escalation. The counters remain optional diagnostics. A quiet productive detour or informed refusal is distinguished by Keeper judgment of expressed meaning, never keyword tables.

Adaptation is a campaign-local accepted record over immutable source nodes, not a copied or mutable ModuleGraph. Canonical accepted records contain closed relocation/rebinding operations and bounded additions for the scene, NPC, and physical carrier/handout roles required by the selected source-connected fragment. Phase 2 starts with existing entities and alternative bindings; phase 3 adds only minimal campaign entities needed for a new venue. Original clue identity, mystery cause, rules identities, and acquired facts remain stable. This is not a generic graph/JSON patch interpreter. Definition availability is distinct from NPC physical presence and clue discovery. A new carrier does not grant NPC knowledge without a causal source/reviewed campaign explanation and cannot duplicate unique antagonist or object identities. Exact wire field types are contract work to record in kernel-rpc before implementation; the seven verb names do not change.

## User Stories

1. As a player, I want midgame facts connected plainly, so that receipts become understanding.
2. As a player, I want public relationships explained without cost, so that I can orient myself.
3. As a player, I want my own theory treated as a hypothesis, so that evidence can change my mind.
4. As a player, I want a wrong but plausible theory answered by evidence, so that being wrong remains play.
5. As a player, I want the Keeper to distinguish known public facts from secrets, so that clarity is not a spoiler dump.
6. As a player, I want a threat made concrete by a caused event, so that urgency is credible.
7. As a player, I want nonviolent testimony, demands, and consequences available, so that clarity does not require combat.
8. As a player, I want clarification to remain an offer, so that I may decline or change course.
9. As a player, I want a productive detour left alone, so that the game does not punish curiosity.
10. As a player, I want independent investigator goals supported, so that physical convergence is not forced.
11. As a player, I want no comprehension quiz, so that play is not an examination.
12. As a player, I want a repeated hint recognized as repetition, so that a new channel can be chosen.
13. As a player, I want delivered relationships available after a restart, so that history is not lost to context limits.
14. As a player, I want my refusal to stand, so that adaptation does not override agency.
15. As a player, I want adapted handouts to preserve my original documents, so that annotations remain mine.
16. As a player, I want campaign-created material labeled to the Keeper, so that it is not mistaken for book text.
17. As a Keeper, I want a bounded causal neighborhood, so that I can act without reading the whole source.
18. As a Keeper, I want evidence, hypotheses, unavailable sources, and proposals separated, so that I do not narrate drafts as facts.
19. As a Keeper, I want the five interventions available in context, so that no ladder forces escalation.
20. As a Keeper, I want live semantic judgment to catch active misunderstanding, so that receipt counts are not prerequisites.
21. As a Keeper, I want to remain the author of intention and narration, so that generated material is selectable.
22. As a Keeper, I want drafts to have no fictional side effects, so that preparation is safe.
23. As a Keeper, I want semantic names rather than opaque IDs, so that runtime binding remains reliable.
24. As a Keeper, I want stale proposals refused, so that old plans cannot land on new play.
25. As a Keeper, I want cancellation and retry to retain evidence, so that failure is inspectable.
26. As a Keeper, I want ordinary NPC initiative classified correctly, so that world action is not falsely treated as PC choice.
27. As a Keeper, I want voluntary travel, searching, and spending admitted normally, so that continuity does not bypass authority.
28. As a Keeper, I want source reading before drafting, so that proposals are grounded in the book.
29. As a Keeper, I want no arbitrary deadline invented, so that urgency has an authored or campaign cause.
30. As a Keeper, I want wrong guesses not to rewrite mysteries, so that discovery remains real.
31. As a developer, I want one continuity builder, so that lookup and context cannot disagree.
32. As a developer, I want the effective graph to serve every play-facing read, so that renderers and transactions agree.
33. As a developer, I want protected source, handouts, events, and identities immutable, so that repair cannot vandalize play.
34. As a developer, I want accepted records worldline-local, so that rewind restores the right campaign.
35. As a developer, I want divergent adaptation merges refused before writes, so that stories are not silently unioned.
36. As a developer, I want three ends recorded for each data family, so that no field is dead weight.
37. As a developer, I want offer ledgers diagnostic only, so that telemetry never nags.
38. As a developer, I want semantic work outside the kernel, so that heuristics cannot decide understanding.
39. As a maintainer, I want source refresh rebased explicitly, so that a new generation cannot silently contradict play.
40. As a maintainer, I want retained artifacts for replay, so that cold resume remains possible.
41. As a reviewer, I want complete relevant history retrieved, so that short previews cannot hide commitments.
42. As an uninformed human player, I want the real UI comprehension gate, so that AI fluency is not evidence of human understanding.

## Implementation Decisions

### Ownership and projection

The ModuleGraph remains immutable source truth; RuleGraph remains rules truth; kernel transactions remain authoritative; campaign state and receipts remain what happened. Accepted adaptations are worldline-local campaign state, not a fifth source plane. Base correctness belongs to the base prompt and host/kernel path. Existing Mods may guide craft, but no new planner, daemon, cognition database, or understanding score is added. Existing Mod version locks are preserved; changed craft packages get a new version and use the existing safe-boundary upgrade flow. Base continuity lookup and state/adaptation integrity remain usable when optional craft Mods are off.

The shared builder reads explicit source relations, current state, delivered text and handouts, existing memory candidates, NPC knowledge, and bounded history. It returns `connections` rows with origin, disclosure, relation/support evidence, and truncation/missing markers. Support acquisition does not remove a relation's usefulness, auto-complete an adventure, grant belief, or require a comprehension flag. In particular, already-acquired relevant clue-to-conclusion relations remain retrievable and projectable for synthesis and clarification. The proposed data carries actual relation/support evidence and known-versus-undiscovered information, not only a missing count or label.

Source truth remains a separate read authority. Original-page readers, source compilation/review, and explicit canonical-source inspection read immutable originals. The effective campaign graph is the single play-facing view, not the only read of every kind. Adaptation authors and reviewers receive original source and accepted campaign view separately and cannot publish inventions back into ModuleGraph. Player renderings omit engineering provenance/category labels; players see consistent in-fiction material. Adapted handout renditions are separate artifacts; originals and player-edited documents remain retained. `player-safe` does not mean already public, and source publication is not proof of disclosure.

### Interventions and admission

The Keeper may clarify or initiate from live meaning even with `stalled_turns=0` and `empty_turns=0`. No counter triggers a call and no per-turn review is compulsory. Quiet/productive detours and informed refusal remain valid. A sourced NPC explanation or unsolicited evidence is not automatically a voluntary PC action, but legitimate NPC/world initiative still passes existing authority classification, including `not_player_action` where applicable. Voluntary PC searching, travel, spending, and learning through chosen action require ordinary admission. Do not make all learning wait for player choice: proactive, legally sourced disclosure remains possible. Every disclosure needs lawful source, knowledge, and material authority plus an appropriate clue/effect receipt where the existing system requires one. Free clarification need not create a new clue receipt merely to prove it was used.

### Proposal surface and lifecycle

New kinds and arguments occur within existing verbs; seven verb names remain. `lookup` kind `adaptation` handles prepare, status, and cancel using a semantic proposal name and natural-language request/anchor names for preparation. Runtime owns opaque IDs, source/worldline/turn/within-turn revisions, and review digests. It reuses the cancellable host task runner, retained working artifacts, and service-status UI. Preparation is asynchronous with bounded foreground wait under existing runtime limits. Pending yields an honest status response, never fictional filler or automatic progress. There is no unconditional per-turn drafter.

When ready and independently reviewed, the Keeper accepts via the existing `apply` verb with a proposed `adaptation` effect naming the prepared proposal.

Independent tool-enabled semantic review covers affected source, delivery/history evidence, NPC knowledge, mystery essentials, and relied-on facts. Complete relevant history and acquired handouts must be retrieved before safety review; last-two delivery/prologue heads are previews, never complete safety evidence. Reviewer unavailability or uncertainty means not ready; failure findings are not stripped. The existing post-turn verifier remains advisory, with no new zero-tool exception. Accept is a dedicated one-effect apply batch; ordinary movement, clue, NPC, and other effects follow separately under ordinary admission. Commit writes a Keeper-only adaptation receipt, not a player action or clue. No generated job auto-accepts. Statuses include ready, failed, cancelled, stale, and pending; retries retain evidence. Both committed base and mutable within-turn revision are pinned, because within-turn changes can occur without a new HEAD. A stale acceptance draws no dice and writes no adaptation, world, or effect. In-flight drafts are rejected after context/worldline revision change; accepted views remain available. Existing job machinery is used; no second scheduler or independent planner service exists.

The three ends are explicit: source relations are written by existing source reader/publication, projected by continuity lookup/thread connections, and used by Keeper plain synthesis, evidence, initiative, and narrated delivery, with relevant existing clue/NPC/world receipts. Delivered associations come from actual narrate/ask records and current input, projected through public-context retrieval, and used for free clarification evidenced by delivered text—not a mandatory new receipt. Player beliefs/preferences come from the existing memory candidate lane and raw input, projected as labeled evidence to the Keeper, and used for contextual interpretation or contradiction by evidence, never mind-state measurement. An adaptation draft is written by a tool-enabled author and independent review, projected as explicit proposal preview/status, and accepted or cancelled by the Keeper. Acceptance is written by kernel apply, projected through the effective graph, and used by ordinary effects, reads, and cold resume. The offer ledger is diagnostic only.

### Source-consistency audit extension (retained 1.1.2; versioned replacement implemented)

The user explicitly authorized extending the existing pre-delivery narration audit (“yes”). The capability `audit.source.v1` is requested by `narration-audit1.1.2` and runs only in the existing tool-enabled Mod audit. It is not a daemon, planner, zero-tool lane, style/comprehension grader, or new compulsory per-turn review. Existing locked versions, capability-absent audits, and the disabled optional Mod retain their behavior; base continuity/adaptation integrity is never disabled. The kernel supplies immutable original/effective source, world, full committed history, acquired textual handouts, and non-authoritative notes/memory, with request-side receipts/candidate and source-review guidance. Evidence, candidate, source, package, and meaningful state are bound and rechecked; stale changes refuse and cannot use cached approval. The auditor's bounded, exact-citation `source_review` extends `{missing, findings}` and unsupported/unclear, malformed, missing, tampered, or unavailable review uses the existing narrative-repair refusal without rewriting or mutation. Structural citations do not establish entailment. Explicit and implicit delivery must share the gate; failed artifacts remain retained. This legacy implementation stands as recorded; observed defects (exhaustive-entailment objective, oversized unfocused initial packet, artifact-error handling conflated with semantic conflict, per-child budgets, and a driver settle race) are addressed by the implemented audit.continuity.v1 replacement under an explicit capability/schema version — not a silent reinterpretation of recorded `audit.source.v1` verdicts. See `docs/kernel-rpc.md` §35.14 and [../plans/story-continuity-and-adaptation.md](../plans/story-continuity-and-adaptation.md). Under the clarified goal, absence of a literal source quote is not by itself a failure; the new rubric distinguishes faithful history recall, allowed coherent new campaign detail, attributed assertion/hypothesis, and kernel-authoritative state.

### Effective graph, minimum changes, and source refresh

The resolver overlays accepted closed relocation/rebinding and bounded additions over immutable source nodes. It serves capsule, lookup, rules bindings, apply staging, verifier facts, NPC dossiers, handouts, source adapters, and restores. It does not interpret arbitrary patches. Existing entities and alternative bindings are preferred; new venue support adds only minimal new scene/NPC/carrier/handout roles required by the fragment. A carrier's physical presence, definition availability, clue discovery, and NPC knowledge are separate states. Unique identities, source causes, rules identities, acquired facts, committed public facts, and player-edited artifacts are protected.

For a campaign with adaptation, the last validated effective view/source-generation binding remains authoritative. Shared source readers may publish new generations independently. Refresh prepares an explicit rebase candidate, checks affected references and relations, and reviews changed semantics before atomic acceptance at a safe turn boundary. There is no silent switch to contradictory source and no campaign stranded merely because another campaign performed a harmless deeper read. Old generation and artifact references needed for replay/resume remain immutable; source files are not copied into mutable campaign truth. Existing readiness gates apply when newly required material is needed.

### Worldlines and phases

Accepted records and revision are canonical worldline-local state. Fork, switch, and rewind restore the correct view. In the first release, identical adaptation revisions may merge. Divergent adaptation sets are refused before any merge write, with semantic names and a clear supported limitation. There is no silent union, first-worldline choice, automatic reconciliation, or new merge-disposition system.

Phase 1 delivers midgame projection, acquired-support retrieval, and the first three interventions. Phase 2 delivers existing-carrier relocation and local adaptation. Phase 3 delivers minimal new-venue fragments. Each phase is judged by continued midgame clarity, not a polished opening.

## Testing Decisions

Tests assert external narration, receipts, state, projections, status, and warnings, not prompt wording or a semantic score. Tests MUST NOT treat the mere absence of a literal source quote as the acceptance oracle: a coherent, compatible invented campaign detail is allowed, while recalling already-delivered history must remain faithful and kernel-authoritative action/resource state must be preserved. Simulated fixtures are contract tests only, never live acceptance. The primary seam remains the real play flow: the existing driver, RPC product, DeepSeek Flash Keeper in an isolated play home, and the parent main session as sole player, one natural reply at a time. The actual uninformed-human UI gate is required; human feedback may follow. There is no in-game quiz and no imported GUMSHOE automatic-clue rule for CoC7.

The critical live pair includes (a) acquired-all-supports yet still-unconnected, proving acquired relations remain useful, and (b) an active player collecting many receipts while `stalled_turns=0` and `empty_turns=0`, where the Keeper may clarify without a detector. Also test free clarification with no new clue or spending, source-grounded unsolicited testimony with an appropriate receipt, no invented midnight deadline, no source-mystery rewrite to confirm a wrong guess, repeated divergence, cold resume with older public commitments, refresh preserving the last validated view, and rejected/stale asynchronous drafts. Test productive detours, refusal, inaccessible witnesses, separate goals, and a second divergence after recovery.

Contract tests cover bounded connections, full relation evidence, truncation, no proposal leakage, admission classification, protected artifacts, original versus rendition handouts, atomic one-effect acceptance, cancellation, retries, crash/restart, worldline restore, identical merge and pre-write divergent refusal. Kernel validation protects closed kinds, bindings, revisions, bytes, and typed state but cannot decide indirect semantic contradiction.

Measure ordinary turn delivery and on-demand drafting/review foreground time separately, reporting cold versus warm behavior. Do not add a model call to every clarification or claim counters measure understanding.

## Out of Scope

Understanding scores, comprehension flags, automatic semantic detectors, keyword tables, quotas, mandatory escalation, combat, forced convergence, arbitrary graph patches, infinite generation, a universal sandbox, silent retcons, source mutation, a second scheduler/planner, a new merge system, a second Keeper, scripted players, batch simulators, publishing this specification, and adding or replacing the seven Keeper verb names are out of scope. Exact wire schemas will be codified in kernel-rpc before implementation; this specification does not modify that contract.

## Further Notes

### External research

[Ryder-Hanrahan, “Clues vs. Leads”](https://pelgranepress.com/2020/02/21/clues-vs-leads/) distinguishes clues that explain what is happening from leads to the next scene. Its GUMSHOE automatic acquisition is not imported into CoC7. [Alexander’s Three Clue Rule](https://thealexandrian.net/wordpress/1101/roleplaying-games/three-clue-rule-part-3-the-three-clue-rule) supports redundancy and openness to unexpected approaches, not a quota. [Proactive Nodes](https://thealexandrian.net/wordpress/51295/roleplaying-games/running-mysteries-proactive-nodes) supports motivated NPC/evidence contact with causal timing. [Shea’s Quantum Ogres](https://slyflourish.com/quantum_ogres_and_the_eight_steps.html) supports reusing components only when player choice changes context, not moving the same encounter everywhere. [The Scenario Hook](https://thealexandrian.net/wordpress/44541/roleplaying-games/the-lion-the-witch-and-the-scenario-hook) supports movable entry where material is not location-essential and respecting refusal. [Players Who Don’t Bite](https://thealexandrian.net/wordpress/37457/roleplaying-games/thought-of-the-day-players-who-dont-bite) supports compressing uneventful activity and honest expectation-setting. [Robertson and Young, AIIDE 2013](https://ojs.aaai.org/index.php/AIIDE/article/view/12624) is only a technical analogy for accommodation under observation constraints; fixed endings and illusion of agency are rejected.

### Local evidence and precise defect

The survey observed `kernel-ts/read/thread.ts` lines 31–39 excluding a conclusion once all its support clues are discovered; `here` and `next` then show missing clues only. This is a projection omission, not proof of understanding. The first implementation and tests must retain/project already-acquired relevant relations for synthesis and clarification without auto-completion, belief grant, or comprehension flag. Other surveyed evidence includes `kernel-ts/read/director.ts` for the distinct stalled/empty diagnostics, `kernel-ts/read/campaign.ts` for shared loading and readiness, `kernel-ts/write/text.ts` for bounded public context, and `kernel-ts/apply/bookkeeping.ts` for Keeper notes, `kernel-ts/memory/jobs.ts` for candidate kinds, and `kernel-ts/memory/recall.ts` for candidate retrieval. These observations support structural decisions, not a reproduced causal proof of boredom.

### Illustrative example

This invented example is self-contained and not canonical source content. The players have three delivered records, each naming the same warehouse. They are busy pursuing a plausible inheritance theory. An authored knowledgeable witness is legally able to explain plainly that the records concern disappearances along the same delivery route. Before intervention, the public relation is only “three records name one warehouse”; the deeper perpetrator and solution remain unknown.

The Keeper uses continuity lookup to see the three delivery references, their disclosure status, and the witness’s source-grounded knowledge and motive. The witness may offer testimony because the example declares its cause: the witness has recognized the route and seeks help after a related disappearance. This is not guilt, a new deadline, or an automatic adaptation. The Keeper may narrate the testimony, and the players may accept, doubt, or continue the inheritance theory. There is no distinct testimony receipt type. When the witness only connects the already-delivered records, no new clue receipt is required. If the witness reveals a genuinely new sourced fact, the appropriate existing clue/effect receipt is required. Before, the records are isolated in play; after, the players know their public relation and an actionable reason to investigate, without combat. A detour alone does not trigger adaptation.

### Verified test prior art

Verified prior art provides supporting contract seams, not tests run: `tests/kernel/test_transactions.py` (replay, failed commit, cold recovery), `tests/kernel/test_worldline.py` (branch/restore/merge), `tests/kernel/test_capsule_nine.py` (capsule RPC projections), `tests/extension/admission.test.mjs` (pre-effect authority including `not_player_action`), `tests/extension/module-graph-integrity.test.mjs` (source generation/immutability), `tests/extension/mods.test.mjs` (host adapter), and `tests/extension/world-state-seams.test.mjs` (producer/consumer AST only). New assertions target production TypeScript; frozen Python oracle files are not modified or used as new-feature acceptance.

### Readiness

The prior continuity/adaptation implementation remains reviewable, but acceptance is partial: failed live turns 12/13 and all evidence are retained, and human UI acceptance remains pending. Under the clarified goal, prior reports failing turns 17/18 solely because an invented ledger date lacked a literal source quote reflect the OLD rubric and remain retained but superseded in interpretation; overall causal-continuity acceptance is INCOMPLETE, not newly passed, and the childhood/kinship retractions stay in force. The source-consistency audit `audit.source.v1`/`narration-audit1.1.2` is implemented legacy; the bounded audit.continuity.v1 replacement is implemented and tested under `docs/kernel-rpc.md` §35.14, with current evidence in [the repair report](../research/continuity-review-repair-2026-09-12.md). See [../plans/story-continuity-and-adaptation.md](../plans/story-continuity-and-adaptation.md). “Ready-for-agent” is only a tracker label and does not prove acceptance; bounded regressions and real-play continuation are now measured, while human UI acceptance remains pending.
