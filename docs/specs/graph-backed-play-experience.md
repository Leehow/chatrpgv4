# Graph-Backed Play Experience

_Date: 2026-09-11 UTC (local authoring date 2026-09-10). Baseline: 0.9.2a at 0705f713. Status: implemented on 0.9.2a on 2026-09-11 for the parts listed under "2026-09-11 decisions after a code survey" (contract §32); no live regression, latency comparison or uninformed-human gate has run, so no acceptance is claimed. Scope: preserve prior Keeper narrative-quality work and add structural graph-backed play and action-admission requirements._

## Problem Statement

PipiCOC now has source-backed ModuleGraph publication, RuleGraph-supplied rule semantics and evidence, kernel-backed arithmetic and transaction settlement, versioned gameplay Mods, receipt-grounded narration audit, post-delivery verification, play-language projection for mechanics and clues, and a clearer Keeper writing policy. Those pieces are necessary, but they do not by themselves prove that play is immersive, understandable, engaging, or player-led. A turn can be evidence-consistent and still make the player ask what a central name means. A receipt can prove that a move, clue, time advance, or encounter happened and still fail to prove that the player chose it. A graph edge can prove that two scenes or facts are related and still not prove that the player authorized the route, method, or consequence now.

The follow-on problem is systemic rather than a wording patch. RuleGraph and ModuleGraph must remain the evidence backbone. The work is to use their nodes, relations, source references, authored possibilities, rule semantics, and live overlays at the point of play without turning them into a plot autopilot, a new truth store, or a per-turn checklist. Good play may be concise, calm, friendly, funny, reflective, frightening, or simply clarifying. It may be a moment of understanding, a meaningful consequence, a helpful conversation, a handout, or a quiet pause. Word, paragraph, beat, clue, event, turn, offer-adoption, and semantic progress quotas are rejected as quality substitutes.

Recent retained incidents show the seam. In The Haunting, the setup opening briefly introduced Knott, the inherited Corbitt House, and the former Macario tenants, then character creation took several minutes. The gameplay opening later reverted to bare proper names and an unspecified house problem, so the player asked “科比特是什么？”. The capsule already contained relevant commission, tenant, tragedy, and research facts; gameplay packages were active. This was not total source absence and not disabled Mods. It was context re-establishment and interaction-uptake failure. In the next retained case, after the player accepted the commission and said “那看看报纸”, the Keeper landed a research lead, advanced time, moved to the newspaper morgue, and triggered an access encounter before the player had chosen that destination and situation. In another context those words could authorize an already discussed archive trip; the defect is not the phrase but the lack of validated action scope. Verifier warnings then mixed public orientation with undiscovered clues after the bad delivery, showing a context and timing problem rather than a reason to suppress known public facts. A separate live-language/perspective defect in clue delivery has since been corrected and must not be described as still unconditionally present.

The player should not need to know the scenario, invent connective actions, or reverse-engineer the graph to keep play viable. The Keeper must orient the player in public, player-visible terms when needed, let hidden causes remain hidden, give perceptible evidence before conclusions, and keep voluntary player choices with the player. Evidence traceability remains mandatory, but evidence consistency alone is not proof of enjoyment or authorization.

## Solution

Add a graph-backed play-experience contract around the existing table seam: natural-language player input enters the real Keeper, the Keeper uses the existing seven verbs and host runtime, the existing kernel performs authoritative rules arithmetic and state transactions, and the delivered narration plus actual receipts, state, mechanics, and warnings are reviewed as one interaction. Lower-level projection, admission, and contract tests support this seam but do not replace it.

The design has two main additions.

First, add pre-effect action admission for new voluntary player actions. Before the Keeper may roll, move, spend time or money, disclose a newly acquired clue, register a new encounter fact, or otherwise settle a proposed voluntary investigator action, the host must validate that the proposed actor, goal, method, target, destination, and meaningful commitments are authorized by the exact current player input, the player-visible context, and any still-valid prior delegation. The host validates authority for the affected proposed voluntary action or atomic batch; it does not guarantee the desired outcome, require foreknowledge or approval of every danger, or convert eventual risk into consent for a different voluntary method. Established hidden consequences, surprises, valid rule effects, NPC initiative, and consequences of an already chosen action may resolve without spoiler consent when their authority is otherwise grounded. This is an internal interpretation review, not a new player form or menu. It must run before effects, including both resolve and apply batches. Guarding only the final prose is too late.

Second, deepen local graph projection at the decision point. Instead of dumping the whole graph or adding a parallel situation database, project a bounded meaningful relation neighborhood around the current scene, proposed action, and live state: who and what are related now; what is perceivable; who knows, believes, hides, or wants what; what methods, conditions, costs, risks, and yields the source already authored; what is merely inferred or table-created; and what remains unknown. Keep cue, applicable method or condition, cost or risk, and informational or fictional yield together where the Keeper decides. Missing metadata stays unknown; graph connectivity is not consent.

This follows the existing authority split. ModuleGraph is immutable sourced claims, relationships, carriers, and authored possibilities. RuleGraph supplies rules semantics and supporting evidence; it is not the arithmetic executor. The existing kernel performs authoritative arithmetic, legality checks, and transactions. World state and receipts are actual campaign events. Presentation is what the player is told. Director remains advisory. Narration Audit continues to check whether settled receipts are realized before delivery; it is not authorization. The post-delivery verifier remains useful but cannot satisfy pre-effect action admission. Base host correctness must hold even with optional gameplay Mods disabled; versioned Mods continue to own craft and pacing policy without duplicating base authority.

## User Stories

1. As a novice player, I want the Keeper to restate necessary public relationships after setup, handoff, delay, or subject shift, so that I do not need scenario knowledge to answer.
2. As a player who asks “what is that?”, I want the immediate public meaning answered first, so that clarification is not punished as in-fiction hesitation.
3. As a player, I want my exact words and visible context used to interpret my action, so that broad interest is not silently converted into travel, time passage, or an encounter.
4. As a player, I want the Keeper to propose possible routes without treating the proposal as my acceptance, so that I can choose, revise, or decline.
5. As a player, I want routine entailed steps compressed when I already authorized the meaningful goal, so that I am not asked to approve every footstep.
6. As a player, I want a meaningful new method, destination, risk, cost, or commitment to remain unchosen until I choose it, so that agency stays mine.
7. As a player, I want dice rolled only after my goal and method are clear enough for the fictional action, so that rules do not adjudicate an invented approach.
8. As a player, I want failed or uncertain admission to leave the affected proposed action’s dice, time, money, movement, clues, and encounter facts unexecuted, so that rejected actions do not happen in the background.
9. As a player, I want prior delegations remembered only while their context remains valid, so that stale acceptance cannot execute after I change my mind.
10. As a player, I want public setup declarations, names, occupations, and already disclosed premises included in later context, so that they are not misclassified as inventions.
11. As a player, I want genuine secrets to remain private until earned, so that clarification does not become a free spoiler dump.
12. As a player, I want a clue, a physical handout, a source summary, and my investigator’s acquired knowledge to appear as different materials, so that documents do not feel like out-of-character summaries.
13. As a player, I want NPCs to answer from their wants, knowledge limits, relationships, and prior interactions, so that help, resistance, misunderstanding, bargaining, and warmth feel grounded.
14. As a player, I want friendly conversations, jokes, companionship, calm reflection, and concise exchanges to count as play, so that the game does not rush to danger or clues just to prove progress.
15. As a player, I want horror built from ordinary baseline, specific anomalies, consequences, and growing understanding, so that dread is earned rather than forced by mandatory sensory openings.
16. As a player, I want failures to produce tangible established consequences and continued meaningful options, so that play does not become an empty repeat-the-roll gate.
17. As a player, I want the Keeper to give perceptible evidence and not state my investigator’s beliefs, trust, feelings, voluntary speech, or action without my basis, so that roleplay remains mine.
18. As a player, I want unanticipated investigations to be answered from causal source facts when possible, so that creative approaches are playable without inventing a new culprit or solution.
19. As a Keeper operator, I want action admission to distinguish new fictional decisions from cold reads, Mod bookkeeping, operator management, and consequences already authorized, so that the guard does not block legitimate upkeep.
20. As a Keeper operator, I want the action-admission verdict to be reusable only for the same still-valid action and context, so that retries are efficient but not stale.
21. As a Keeper operator, I want an honest service-status handback when required admission is unavailable, so that the Keeper does not fill outages with fictional filler.
22. As a Keeper operator, I want the graph projection to keep cue, method, condition, risk, cost, and yield together, so that affordances are playable rather than name lists.
23. As a Keeper operator, I want unknown fields to stay unknown, so that missing metadata is not treated as no risk, no roll, no source, or no relation.
24. As a Keeper operator, I want source, inference, and table-created facts labeled distinctly, so that improvisation does not silently rewrite the module.
25. As a Keeper operator, I want Director and offer telemetry to remain advisory diagnostics, so that counts never nag the next turn.
26. As a scenario maintainer, I want producer, projection, and adoption checked for every new field, so that authored fields do not masquerade as mutable world clocks or disappear unused.
27. As a scenario maintainer, I want a demonstrated producer-consumer gap repaired through existing contracts, so that one failing scene is not hand-authored into a parallel store.
28. As a developer, I want RuleGraph and ModuleGraph preserved as separate authority planes, so that the fix does not become a supergraph or second campaign truth store.
29. As a developer, I want the existing Keeper verbs and host runtime retained, so that action admission and projection do not create a second Keeper, narrator, or planner service.
30. As a developer, I want semantic admission handled by model review infrastructure rather than keyword or regex classification, so that language understanding stays where it belongs.
31. As a developer, I want deterministic kernel checks to remain binding, legality, material, transaction, idempotency, and arithmetic checks, so that natural-language classification does not enter the kernel.
32. As a developer, I want direct Keeper calls unable to bypass admission by disabling an optional Mod, so that base agency correctness is always present.
33. As a package maintainer, I want Narration Audit to stay receipt-realization only, so that it does not become a literary or authorization gate.
34. As a package maintainer, I want optional craft and pacing packages to add interaction quality without duplicating base disclosure and agency rules, so that responsibility remains clear.
35. As a tester, I want positive and negative context pairs for ambiguous utterances, so that tests verify meaning in context rather than blacklisting phrases.
36. As a tester, I want failed admission verified through receipts and state, so that a pleasant rewrite around unauthorized effects cannot pass.
37. As a tester, I want graph-experience cases using real source relations, NPC knowledge, handouts, and alternative paths, so that synthetic fixtures do not stand in for play.
38. As a live-regression reviewer, I want continuous play through the real Keeper with one natural player reply at a time, so that polished isolated snippets cannot claim table success.
39. As an uninformed human reviewer, I want to use the actual PipiCOC UI without reading the scenario, so that AI self-certification cannot claim novice usability.
40. As a performance reviewer, I want foreground admission cost measured separately from overall delivery time, so that rollout can compare quality and latency honestly.

## Implementation Decisions

- Keep four authority planes. ModuleGraph remains the immutable source-backed map of authored claims, relations, carriers, scenes, clues, NPCs, conditions, and possibilities. RuleGraph remains source-backed rules semantics and evidence. The existing kernel remains the authoritative executor for rules arithmetic, legality, materiality, transactions, replay, and idempotency. Campaign world state and receipts remain the record of what actually happened at this table. Presentation remains what the player is told. Director advice, thread rows, pacing rows, and offer telemetry remain advisory and diagnostic.
- Do not merge these planes into a supergraph, add another campaign truth store, restore a retired runtime design, or treat graph connectivity as player consent. Source references, publication manifests, source-gap uncertainty, and published material binding stay mandatory. Missing metadata is unknown, not absence.
- The base host owns agency, action admission, and disclosure correctness even when gameplay Mods are disabled. Optional versioned Mods own additional craft, pacing, interaction guidance, and package-specific checks. Narration Audit stays receipt realization; the verifier stays post-delivery advisory.
- Bind admission to the existing turn and transaction lifecycle before any new voluntary player action is rolled or changes state. All execution paths that can produce affected Keeper writes for that action, including resolve and apply batches, must pass the same host-owned pre-effect admission. A combined clue and move batch is legal only when the player’s prior instruction already authorizes both. Guarding narration after effects is insufficient.
- Distinguish new voluntary fictional decisions from legitimate non-voluntary authority. Admission authorizes the affected voluntary action, not the outcome. NPC initiative, rules-backed involuntary effects, valid rule effects, established hidden consequences, surprises, world events with an established cause, bookkeeping already authorized by prior effects, cold reads, operator management, Mod registration, routine entailed steps, and consequences of already chosen actions remain valid when their authority is already established.
- Define an internal Action Admission Review. Its input includes the exact current player text, relevant player-visible context, still-applicable prior delegation, proposed actor, goal, method, target, destination, cost, risk, commitment, and the origin of each proposed element. It is not a player-facing menu or form.
- Unspecified meaningful choices stay unspecified. The Keeper may suggest a path, destination, method, or bargain; that suggestion is not acceptance. Review must not demand that the player approve a spoiler before choosing an otherwise visible action, and it must not infer consent to a new voluntary method, destination, target, or commitment merely because an authorized action may carry risk. The Keeper cannot mint authority by writing a rationale, labeling an inference as the player’s intent, or repeatedly proposing synonyms until one passes.
- Admission uses an independent semantic model review against the original input and public context before effects, not Keeper self-assertion. Reuse the existing host semantic-review pattern with a distinct admission remit. The kernel continues deterministic checks for binding, legality, material readiness, transaction state, idempotency, and arithmetic; it does not perform natural-language classification.
- Keep service topology small. Do not add a second Keeper, narrator, planner, daemon, parallel gameplay state machine, separate transaction loop, or synchronous literary score loop. The existing turn and transaction lifecycle may gain only the minimum admission binding and cancellation semantics needed for correctness. A model verdict reduces risk but does not eliminate semantic error, so telemetry and human review remain required.
- A verdict may be reused only for the same proposed action, same relevant public context, same still-valid delegation, and entailed effects. A changed actor, goal, method, destination, target, meaningful stakes, relevant state, cancellation, or player revision requires re-evaluation. Host-owned opaque correlation and digests may bind reuse; the model is never asked to type or copy them.
- Admission failure, uncertainty, cancellation, or required-review unavailability leaves the affected proposed action or atomic batch, and only its dependent dice and effects, unexecuted. It does not block independent legitimate world events, NPC initiative, or consequences of actions already chosen and grounded. The Keeper clarifies the real missing choice or explains actual preparation or service status. It must not repair prose around unauthorized effects, reroll, keep rejected background work alive, or let a pending decision execute after the player changes their mind.
- Local graph projection starts from the current scene, proposed action, and live state, then expands a bounded meaningful relation neighborhood. It should surface who and what matters now, what is perceivable, who knows or believes what, what conditions apply, what methods are authored, and what costs, risks, informational yields, fictional yields, or possible consequences are attached.
- Keep offer rows playable: cue, applicable method or condition, cost or risk, and yield belong together at the decision point. Where only cue, clue, or NPC identity is currently projected but richer authored method, condition, or consequence fields exist, repair the producer-consumer gap through existing graph and projection contracts. Do not create a second scene packet database and do not hand-author one failing scene.
- Existing where, present, known, thread, pacing, memory, and recall views should complement one another. None should become a global graph dump. Source completeness, projection correctness, and Keeper adoption are separate checks; the offer ledger counts and never nags.
- Separate public orientation, currently disclosed clues, hidden deeper causes, source notes, fictional documents, handouts, and reader instructions. A mention is not proof of comprehension. After chargen, handoff, time gap, subject shift, or explicit confusion, re-establish necessary public relationships without restaging arrival or retelling everything.
- Answer the player’s question first in a fiction-appropriate way. An impatient or ignorant NPC may remain impatient or ignorant, but out-of-character clarification of already public context is not a penalty and does not force an encounter. In-character refusal is valid only when grounded in the fiction and accompanied by whatever public orientation the player should have.
- Add setup declarations, public disclosures, and raw player identity or occupation statements to the verification context that judges invention and disclosure. Do not treat all undiscovered clues as Keeper-only when a commission, research lead, or identity was already public. Conversely, do not waive legitimate clue receipts or make unknown information public.
- NPC response is governed by wants, fear, knowledge limits, relationships, stance, prior interaction, and current leverage. Helpful people can volunteer useful help; wary people can bargain or deflect; ignorant people cannot reveal secrets they do not know. The same knowledge can produce different willingness after a real interaction.
- Improvisation is allowed within established situation and constraints. Local color, credible NPC responses, carriers, and consequences may be created with campaign provenance. An improvised carrier may expose an existing fact only when acquisition and knowledge conditions make sense. Do not teleport clues, grant ignorant NPCs secrets, invent alternative culprits, invent solutions, or silently rewrite authored essentials.
- Source adaptation changes are explicit campaign-local departures where authorized. They are not silent changes to ModuleGraph truth. Do not restore numerical truth tiers, improv budgets, or turn budgets as mandatory machinery.
- Preserve prior narrative-quality boundaries except where this follow-on explicitly adds required foreground admission for new voluntary actions. The earlier prompt-only and no-required-foreground-call assumptions do not hold for this admission guard; the rest of the no-quota, no-literary-gate, no-duplicate-Mod-policy decisions remain.
- Implementation order: first, settle contract and design for the existing turn boundary, producer and consumer ownership, and action-owner definitions; second, carry pre-effect admission through resolve and apply paths; third, repair relational projection, public-context assembly, and versioned craft-package integration; last, run paired real-play regressions, uninformed-human UI review, latency comparison, and package or lock gates. This order does not create ticket numbers, automatic migration, or implicit package upgrades; existing package locks remain immutable and upgrades are explicit.
- Production remains TypeScript-only. Retired historical runtime designs may inform rationale but are not implementation targets. Frozen compatibility oracles are not edited for this behavior.
- New model-authored or model-reviewed artifacts must use the project’s explicit tool-enabled workflow or approved runtime lane contracts. Existing zero-tool exceptions remain limited to their approved advisory lanes and do not authorize new untooled authoring work.
- Admission adds foreground cost. Keep its context bounded, reuse valid verdicts across a batch or retry, and avoid reviewing every primitive effect or every graph fact. Required-admission unavailability means no authority to execute the affected action, not fail-open fiction.
- Telemetry records player-submit-to-delivery wall time, admission review time, model time, graph lookup time, repairs, cancellations, false accepts, false refusals, and unaudited or unavailable cases separately. No latency target or “free” claim is part of this spec.

## Testing Decisions

- Primary seam: existing natural-language player input enters the real Keeper; the real Keeper uses the existing verbs; the delivered narration, mechanics projection, actual rules calls, state changes, receipts, warnings, and telemetry are inspected together. Lower-level public-interface tests support this seam but do not replace it.
- Do not add tests that merely assert prompt phrases or mirror implementation wording. Do not change frozen oracle data. New behavior is asserted against the current TypeScript production kernel and host surfaces.
- Behavior matrix, positive and negative pairs: bare “look at newspapers” as a category of interest versus an explicit already-discussed archive trip; inspect a lock versus pick the lock; ask a guard versus bribe or threaten the guard; a route the Keeper offered versus a destination already delegated; clear routine traversal toward an authorized goal versus choosing a new meaningful method; chosen entry into a place with a sourced hidden danger versus Keeper-invented entry or destination chosen for the investigator; legitimate rule-forced movement or NPC initiative versus invented voluntary PC action.
- For every failed or uncertain admission case, assert that the affected proposed action or atomic batch draws no dice, moves no scene, lands no clue receipt, spends no time or money, registers no new encounter fact, and is not later executed by retry, replay, restart, delayed background work, or a stale pending decision. The assertion does not freeze independent legitimate world or NPC consequences under separate authority.
- Replay, cancellation, restart, and context-change tests must prove that a same verdict replays only the same still-valid action and that changed actor, method, destination, target, stakes, visible context, or player revision causes re-evaluation.
- Graph-experience cases must include: Corbitt and Macario relational orientation after setup; a “what is that?” clarification repaired without a free secret dump; an NPC with the same knowledge but different willingness after interaction; a plausible imaginative investigation answered from causal source facts; an actual handout delivered in the play language while preserving immutable source; a failure with tangible valid consequence; deliberate quiet or short replies not forced ahead; alternative clue paths where the source permits; unknown source not asserted absent; and checks grounded in actual source material rather than only synthetic fixture success.
- Projection tests cover source publication, graph loader binding, bounded local relation projection, offer rows carrying cost and yield, and every new field’s three ends: producer, consumer, and observed use. Author fields must not be presented as mutable world clocks unless a writer and receipt path exist.
- Activation tests record actual resources and package versions, active Mod locks, settings, digests, selected Keeper model and reasoning level, host runtime selection, disabled-Mod behavior, and preservation of immutable old package bytes and campaign evidence.
- Evidence stages remain separate: source and projection contract checks; resource, Mod, and model activation; canonical continuous Grok regression through the existing RPC driver with the main orchestration session as the sole AI player and one natural reply at a time; editor or reviewer comprehension using player-visible context only; uninformed-human actual PipiCOC UI gate; packaged/runtime verification; and same-scenario latency comparison.
- Full-campaign acceptance reaches a natural ending or a real blocker. Bounded scene regressions must be labeled bounded and cannot be promoted to full table success. No scripted player, fake Keeper, canned bulk settlement, or reconstruction of lost delivery proves gameplay.
- Human success means an uninformed person can understand relationships and the available situation, choose or revise methods without hidden source knowledge, notice meaningful NPC and world responses, and remain interested, including during calm play. This is not a universal guarantee that every person enjoys every scene.
- If the uninformed-human UI gate has not run, report it incomplete and do not claim novice experience solved. Writing this spec or labeling an implementation ready is not implementation acceptance.
- Latency comparison uses controlled same-scenario baseline and candidate runs. Report cost and quality tradeoffs before rollout; do not promise admission is free.

## Out of Scope

- Replacing RuleGraph or ModuleGraph, merging all authority into one supergraph, adding a second campaign truth store, or restoring retired runtime engines.
- New Call of Cthulhu rules, arithmetic, settlement families, action-rating mechanics, Gumshoe-style guaranteed-clue rules, or fixed major-wound counters.
- Word, paragraph, clue, beat, event, offer, turn, twist, or semantic progress quotas, and any score that claims to prove enjoyment.
- A second Keeper, narrator, planner, global scheduler, detached daemon, new scene packet database, or synchronous literary rewrite loop.
- Keyword, regex, or phrase-table semantic classification of player intent.
- Blanket approval for every effect, every footstep, every minute, or every NPC action, or requiring player foreknowledge or approval of established hidden consequences and outcomes. Legitimate involuntary, NPC, routine, and world consequences remain valid.
- Suppressing public orientation because secrets exist, or revealing genuine secrets because a player asks for clarification.
- Treating a source summary as a physical document, or treating a physical handout as automatically understood investigator knowledge.
- Teleporting clues to arbitrary locations, giving ignorant NPCs hidden facts, inventing alternate culprits or solutions, or silently rewriting source essentials.
- Automatic live-campaign migration, mutation of old package bytes, rewriting historical receipts, or changing unrelated provider, onboarding, UI, deployment, or DeepSeek work.

## Further Notes

- Lead-verified evidence for this authoring pass includes the baseline kernel contract sections on methods, extension duties, language and mechanics projection, visual PDF reading, gameplay Mods, host runtime composition, Director and narration packages, and the three-end seam model; the system ontology ADR; the prior Keeper Narrative Quality spec; GitHub issue [#68](https://github.com/Leehow/chatrpgv4/issues/68); and the open novice-human gate [#79](https://github.com/Leehow/chatrpgv4/issues/79). This editorial pass did not perform fresh research, run tests, close issues, or make acceptance claims.
- Baseline provenance: 0.9.2a at 0705f713. Recent landed corrections preserved by this spec include structured Guided Creation exchange, live mechanics and clue delivery projection into play language, and definition-placement recovery. Concurrent unrelated DeepSeek provider dirty work is excluded.
- Stable references: docs/kernel-rpc.md §§5, 8, 16, 22, 26, 27, 30, 31; docs/adr/0003-system-ontology-composition-registry.md; docs/specs/keeper-narrative-quality.md; GitHub [#68](https://github.com/Leehow/chatrpgv4/issues/68) and [#79](https://github.com/Leehow/chatrpgv4/issues/79).
- Retained The Haunting incidents are referenced only by neutral turn descriptions and short player utterances: turn 0/1 orientation around Corbitt and Macario, “科比特是什么？”, accepted commission “干”, and the later newspaper utterance “那看看报纸”. No hidden ending details or raw logs are included here.
- Rulebook source: Call of Cthulhu Keeper Rulebook, 40th Anniversary PDF, Chapter 10, verified SHA256 a860499cf34b40cac385f51b6e667ab37ec0796c7329494def08c8b161fd71eb. Relevant verified page ranges: printed 184 / PDF physical 196 supports listening and reacting; 186–187 / 198–199 support premise and player connections; 190–191 / 202–203 support NPC wants and knowledge limits; 194–196 / 206–208 support meaningful rolls and stated action; 198–199 / 210–211 support pacing and unanticipated approaches; 201–202 / 213–214 support causal evidence plus obvious and obscured clues; 204 / 216 supports handouts; 207–211 / 219–223 support credible horror and fair warning; 219 and 221 / 231 and 233 support adapting published scenarios. These are summaries, not extensive quotations.
- Source references below name verified local revisions and repository paths. Those revisions are not currently resolvable through the GitHub API; this issue does not imply that their source has been published remotely.
- Historical prior art is read-only and pinned to `135711c5f53a1edcc5029d1fa78bf861a64a060c`: authority separation (`docs/specs/module-graph-to-kp-integration.md lines 74–83`), search score not semantic priority (`docs/specs/module-graph-to-kp-integration.md lines 212–220`), scene context/provenance and a proposal with partial tests, not proof of hot-path operation (`docs/specs/pi-coc-adjudication-narration-report-contracts.md lines 478–573`), historical CUT avoiding an unselected destination (`plugins/coc-keeper/scripts/coc_story_director.py lines 1801–1827`), present-on-disk caution (`docs/status/redesign-gap-20260902.md lines 10–47`), and runtime live-use caution (`docs/specs/pi-coc-director-graph-runtime.md lines 439–460`). These links do not restore Python runtime code or prove current hot-path use.
- Current test prior art at baseline `0705f713`: `tests/play/driver.py` and `docs/acceptance.md` are the real-play seam; `tests/extension/reading-intent.test.mjs` plus `tests/extension/harness.mjs` demonstrate real extension-boundary integration with controlled model transport, not gameplay acceptance; `tests/extension/module-graph-integrity.test.mjs` verifies publication binding; `tests/kernel/test_transactions.py` is a Python test controller for current TypeScript by default and covers replay and transaction behavior; `tests/extension/mods.test.mjs` covers the tool-enabled adapter and audit bridge; `tests/extension/world-state-seams.test.mjs` is a world-state AST guard and cannot establish authored-field producers or Keeper adoption. This pass does not say these tests passed in this turn.
- Lead-audited baseline gap observations at current paths, without new claims of defective graph integrity: `kernel-ts/read/capsule.ts` and `kernel-ts/read/thread.ts` project reduced cues; `kernel-ts/read/director.ts` advice uses previous played intent and is not authorization; `kernel-ts/apply/move.ts` and `kernel-ts/apply/index.ts` validate legal and bound effects, not semantic player choice; `extensions/kernel/index.ts` lacks current player-scope admission; `extensions/mods/index.ts` audits narration after effects; `extensions/kernel/verifier.ts` is post-delivery; `kernel-ts/write/text.ts` includes raw player input but has overbroad Keeper-only undiscovered-clue context. These observations preserve already-fixed live-language and onboarding boundaries.
- External conceptual comparisons, not imported Call of Cthulhu mechanics or acceptance evidence: [The Alexandrian, “Art of Rulings – Part 2: Intention and Method”](https://thealexandrian.net/wordpress/37960/roleplaying-games/art-of-rulings-part-2-intention-and-method) supports separating intent and method from adjudication; [The Alexandrian, “The Art of Pacing”](https://thealexandrian.net/wordpress/31509/roleplaying-games/the-art-of-pacing) supports compressing non-decisions and stopping at meaningful choices; [The Alexandrian, “Is Node-Based Design Prepping a Plot?”](https://thealexandrian.net/wordpress/53341/roleplaying-games/is-node-based-design-prepping-a-plot) supports situations and connectivity rather than prescribed plot; [Blades in the Dark, “Action Roll”](https://bladesinthedark.com/action-roll) supports the comparison of player action choice versus GM position and effect, but does not import action ratings into CoC; [Sly Flourish, “Tell, Don’t Show”](https://slyflourish.com/tell_dont_show.html) supports clear usable context; [Writing Excuses 10.20, “How Do I Write a Story, Not an Encyclopedia?”](https://writingexcuses.com/writing-excuses-10-20-how-do-i-write-a-story-not-an-encyclopedia/) supports relevant exposition rather than a worldbuilding dump.

## 2026-09-11 decisions after a code survey

The sections above were written before the code was read. This pass read it — the kernel extension's
tool path, the lane runner, the Mod bridge, the verifier, the capsule builders, the fact lists, The
Haunting's graph records and the offer ledger — and made the decisions the specification left open.
Each is recorded with what was found, so the next reader does not have to re-derive it. The contract is
`docs/kernel-rpc.md` §32; the code references are current paths.

### D1. Admission binds in the host's tool path, ahead of the Mod bridge and the kernel

**Found.** Every Keeper verb goes through one function, `runTool` in `extensions/kernel/index.ts`.
Before the kernel call it already runs `mods.prepare` (definition agents, the narration audit). The
`tool_call` hook runs earlier still but returns only `block`/`reason`, without the refusal shape the
Keeper knows how to read. The kernel validates legality and binding (`kernel-ts/apply/*`), never player
scope, and must not: natural-language classification does not enter it.

**Decided.** `admitAction` runs inside `runTool`, after the payload is built and before `mods.prepare`,
for `resolve` and `apply`. A refused proposal therefore pays for no definition agent, reaches no
transaction, mints no receipt and has nothing to replay. The refusal is a `KernelError` (`needs`,
`details.reason`), so it renders through the existing `code: message` / `fix` / named-`details` path of
§8 and counts against the identical-resend strike — nothing new for the Keeper to learn. It is base
host behaviour; no package, setting or capsule field switches it off.

### D2. Which calls are put to review is decided by closed enums; whether they are authorised is decided by a model

**Found.** Agents.md forbids keyword or regex classification of intent, and allows closed contract
vocabularies. The `resolve` action carries `intent` (enum), `decision` (family-prefixed semantic names),
`actor` and `choice`; `apply` effects carry `kind` (nineteen-way discriminated union).

**Decided.** The trigger set is closed: `resolve` unless it settles a pending `choice`, a `sanity:` or
`development:` decision, or an NPC actor; `apply` when the batch carries `move` (not a rename of the
scene underfoot), `clue`, `time`, `cash`, `item` or `handout`. Everything else — `npc`, `threat`,
`flag`, `note`, `ruling`, `define`/`object`/`ability`/`dossier`, `ending`, worldline effects, `damage`
on its own — goes straight on. Within the trigger set nothing about the words is read by the host; the
verdict is the reviewer's.

### D3. The reviewer is the §12.5 lane pattern with an admission remit; unavailability refuses

**Found.** The host has exactly one "independent semantic review" shape: `runLane` in
`extensions/lanes/subsession.ts` — one zero-tool completion, a closed shape check, four telemetry rows.
The verifier and the memory lane use it. The other shape, the tool-enabled `runTask` sub-agent of the
Mod bridge, costs thirty seconds and more per call and exists for authoring files, which a verdict is
not. Agents.md's rule that text work must be a tool-enabled agent is about reading documents into
structure; the zero-tool exception it names is the verifier's and the memory lane's advisory shape.

**Decided.** Admission uses `runLane` with its own model variable (`PI_COC_ADMISSION_MODEL`, default the
table's model), its own shorter cap (`PI_COC_ADMISSION_TIMEOUT_MS`, 60 s, because it is foreground),
and a five-way verdict. This is the specification's "existing host semantic-review pattern with a
distinct admission remit". This extends the zero-tool lane exception to a third remit; **the user ruled on it on 2026-09-11 and
kept it** (Agents.md names the three lanes). If ruled
otherwise, the seam is one function (`reviewAdmission`) and the verdict shape does not change. When
the lane cannot decide — no model, an error, a malformed answer, the cap — the action is refused with
`admission_unavailable` and a service-status `fix`. It never admits by default: the alternative to an
unreviewed action is a Keeper choosing for the player.

### D4. The reviewer reads the player's context, which the host assembles; nothing Keeper-only travels

**Found.** The exact player text is the `before_agent_start` prompt (and `pending_turn.player_text`
after a restart); the host did not keep it. Earlier deliveries are `rendered_text` of `narrate`/`ask`,
which the host sees at delivery; the capsule's `recent` carries 200-character heads. The setup prologue
comes with `table.open`. The capsule's `where.summary`, `keeper_notes`, NPC `agenda`/`secret` and the
undiscovered clues are Keeper-only and must not be what the player's consent is judged against.

**Decided.** The host keeps, per table: the current player text, the investigators (name, occupation),
the scene's handle and player-facing label, the names on stage, the setup prologue, the last four
deliveries with the player text each answered, and per turn: what was settled and what was refused.
The reviewer's input is built from these and the proposal only. The capsule's `recent` stands in for
the delivery window after a restart. A fifth verdict, `not_player_action`, exists so that NPC or world
action that happens to be carried by a triggering effect is admitted on its own authority rather than
refused for lacking the player's.

### D5. Verdict reuse is host-keyed and dies with the turn

**Found.** The kernel refuses `resolve` with `needs_choice`/`needs` and expects the same action back
with one field added; a second review of that resend would double the cost for no information. The
kernel's last-call ordinal is a maximum, not a contiguity check, so a refused call's minted `call_id`
is simply unused.

**Decided.** A canonical key of the proposal — the identifying fields, order-free, with `why`, `how`,
`label` and `decision` outside it — indexes verdicts for the turn; admitting and refusing verdicts are
both reused, and a reused row says so. `table.player_input` clears the map. Refused proposals are in the
next review's input as "already refused this turn", so a rewording is judged as the same action.

### D6. The projection repair is one producer–consumer gap and one field

**Found.** The Haunting's scene records author affordances with `grants_clue_ids` (arrays) or `clue_id`
(singular); `whereSection` read only `clue_id`, so the hand-written starter's cue rows reached the
Keeper naming nothing they yield. Clue gates (`clueGate`) existed for `director.reveal` and the thread's
`here` rows but not for `known.clues_here`, whose prompt description promises "how". `status: "open"`
and `route_type` sit on the record with no writer. `on_enter.clock_ticks` names a clock the book means to
tick on entry, and nothing reads it. PDF-built books author no affordances at all (§30.4), so this
repair changes nothing for them.

**Decided.** `where.affordances[]` rows carry `clues: [{clue, gate, discovered}]` (first one still under
`clue`), `known.clues_here[]` rows carry `gate`; `status` and `route_type` stay unprojected (an author
field presented as live is §31.1's blind spot); `on_enter.clock_ticks` is recorded as a seen gap, not
repaired here. The adoption end is the offer ledger's new `affordance:<id>` kind. No second scene
packet, no hand-authored scene.

### D7. "Already public" is what was delivered, not a graph field

**Found.** Every conclusion clue entry on The Haunting carries `visibility: player-safe`, so that field
cannot mean "public before it is earned"; it means the summary is safe to read out once it is. The
kernel has the deterministic public record: the party sheets, the setup handoff's prologue, and the
turn records' `rendered_text`.

**Decided.** `facts.public` (§32.6) carries the investigator identity, the prologue head and the two
previous deliveries' heads; the verifier reads it as a third block. `keeper_only` is unchanged. The
verifier stays advisory.

### D8. Prompt changes are base and small; packages are untouched

**Decided.** `prompts/keeper.md` gains a paragraph on what a refusal means and one on orientation,
clarification and the handout/clue/summary distinction — the base owns the playable turn (§30.12).
`narration-craft`, `keeper-pacing`, `story-thread`, `narration-audit`, `natural-npc` and
`enhanced-items` are not changed, so no package version moves and no campaign lock is disturbed.

### What this pass did and did not do

Done and pinned: D1–D8 as above; `tests/extension/admission.test.mjs` (nine seam cases through the real
extension, the real lane runner and a scripted review model); kernel tests for `facts.public`, the
affordance rows, the `known` gates and the `affordance:` offers; `tests/play/kpi.py`'s `admission`
section; contract §32; the harness gives every table an admitting review model by default so that the
existing seam suite is unchanged in meaning. Full extension suite and the touched kernel files pass on
the emitted kernel.

Done after the first commit: three real tables (`admission-e2e-1`, `-2`, `-4`; 7, 30 and 40 turns; contract
§32.9) — no false refusal and no false acceptance in 77 turns, both motivating incidents fixed, combat and a
natural ending reached. The cost defect the first two exposed (a reviewer's latency tail: 60 s timeouts under
grok-4.6, four 120 s stalls under grok-4.3) is closed by the reviewer choice `deepseek/deepseek-v4-flash`
(third table: 2% of table time, no timeout) plus the answered-ask exemption of §32.1. Not done, and not
claimed: verdict reuse exercised by play (no identical proposal recurred within a turn on any table); the same-scenario latency comparison; the
editor comprehension review; the uninformed-human UI gate (#79); any package or lock change. The
Implementation Decisions' order stands: those are the last step and they have not run.
