# Keeper Narrative Quality

_Date: 2026-09-10. Status: specified; the decisions of 2026-09-10 are recorded in the last section; implementation and acceptance pending._

## Problem Statement

PipiCOC can calculate rules, use scenario material, and keep a campaign moving, but individual Keeper responses can still feel hollow, low-value, or hard for an ordinary player to answer. Scenario-aware and highly inventive AI players can mask this defect because they can infer missing affordances, supply their own momentum, and tolerate unclear handoffs. A novice human should not need hidden scenario knowledge or model-like inventiveness to understand what just happened, why it matters, and what they might reasonably do next.

The problem is not short prose. Word counts, paragraph counts, clue counts, event counts, twist counts, per-turn quotas, and semantic progress scores are rejected as substitutes for quality. A strong Keeper turn may be brief; a verbose turn may still say nothing useful. The desired quality is a responsive, engaging, understandable experience that respects player agency. Value may come from understanding, changed relations, perceptible consequences, resonance, humor, companionship, reflection, or a single affecting image. Quiet scenes need not advance the plot, repetition may be a purposeful callback, and clear telling may serve the table better than constant showing.

Known evidence must be read narrowly. The screenshot that motivated the concern matches preserved Masks latency-run gameplay record 17, transport input 22, and the gameplay Mod instructions for that turn listed only natural-npc 1.0.0. That statement concerns gameplay Mod instructions only and does not show that every other active package, such as setup-only Guided Creation, was absent. It is evidence of the symptom, not proof that the newer Keeper Pacing, Story Thread, or Narration Craft gameplay packages were active and failed. The older style directives did include texture-oriented language, making that a candidate influence rather than an isolated root cause. Current Narration Craft 1.0.2 still has routine, costly, reveal, and climax character settings, but they are ceilings and not proof that the application truncated prose. No A/B or new live acceptance of this proposal has run. Current projections already carry scene questions, authored pacing notes, routes, NPC motives and secrets, NPC knowledge and beliefs, ties, stance history, player text, recent context, and memory; therefore missing source material, projection omission or truncation, and unused available material are separate diagnoses.

## Solution

Consolidate the active Keeper writing policy so that the existing Keeper, existing seven verbs, existing Mod interface, capsule, state ledger, source reader, and advisory Director produce player-facing turns that respond to the live exchange instead of obeying literary volume controls or mechanical recipes.

From the player's perspective, the Keeper should take up the declared action, question, attitude, or pause; use sourced scene and NPC material that is relevant to that exchange; make settled outcomes perceptible; and stop only at a real obstacle, meaningful player decision, or intelligible opportunity for free input. NPCs should behave from their actual wants, fears, knowledge, lies, ties, stance, and history, including friendly assistance and companionship when appropriate. The Keeper may describe, summarize, directly tell, or use dialogue as needed, while preserving secret/public boundaries and never dictating the player character's thoughts, feelings, intentions, trust, or actions.

Responsibility is clarified without adding production entities. Base style owns play language, register, and general readability. Narration Craft owns selection and expression of material, NPC interaction, and narrative realization. Keeper Pacing owns continuation versus handoff, meaningful pauses, and recovery support. Story Thread supplies relevant source connections and opportunities without becoming a task list. Narration Audit remains receipt-grounded and does not become a literary grader. The verifier retains its existing correctness, privacy, agency, and language remit.

Implementation and all new acceptance are not run by this specification. During this authoring task, no candidate package, loaded-resource check, isolated test campaign, regression, UI acceptance, or live campaign change is performed. This document is an implementation-ready contract and rollout plan, not evidence that the novice-player problem is solved.

## User Stories

1. As a novice player, I want each Keeper response to make the immediate fictional situation intelligible, so that I can answer without knowing the scenario in advance.
2. As a player, I want the Keeper to respond to my expressed intent and method, so that my input feels taken up rather than paraphrased or ignored.
3. As a player who asks a question, I want the Keeper to answer what my investigator can perceive or already know, so that I can reason from public information.
4. As a player in conversation with an NPC, I want that NPC to speak and act from their sourced motives, knowledge, fears, ties, and prior relationship with me, so that the exchange feels specific rather than generic.
5. As a player meeting a friendly or helpful NPC, I want assistance, warmth, companionship, jokes, or ordinary cooperation to be valid outcomes, so that every conversation is not forced into evasion or hostility.
6. As a player whose action succeeds or fails, I want the fictional consequences to be perceptible and relevant, so that the rules settlement has meaning at the table.
7. As a player facing uncertainty, I want the Keeper to continue uncontroversial parts of my declared action until an outcome, obstacle, risk, or decision appears, so that I am not handed control back at a useless midpoint.
8. As a player facing a real decision, I want the Keeper to stop before choosing for my investigator or skipping a gated risk, so that my agency remains intact.
9. As a player who is confused, I want clarification of known facts and plausible goals without a penalty, so that unclear Keeper communication is not treated as an in-fiction failure.
10. As a player who explicitly asks for help, I want the Keeper to clarify possibilities without coercive menus or exhaustive fixed options, so that I keep ownership of my next move.
11. As a player who chooses to linger in a quiet scene, I want the Keeper to respect reflection, relationship, humor, atmosphere, or companionship as valuable play, so that I am not rushed merely because no clue receipt appeared.
12. As a player, I want repetition to be compressed when it is stale and preserved when it is a meaningful callback, so that the prose can echo without becoming mechanical.
13. As a player, I want clear telling when it helps me understand what my investigator would reasonably know, so that the game does not hide basic context behind show-don't-tell habits.
14. As a player, I want hidden truths and secret source material to remain hidden until earned, so that scenario discovery still matters.
15. As a player, I want the Keeper not to dictate my character's thoughts, feelings, trust, intentions, or actions, so that the narration supports rather than replaces roleplay.
16. As a Keeper operator, I want active instructions to distinguish style, craft, pacing, and thread responsibilities, so that overlapping prompt layers do not contradict each other.
17. As a Keeper operator, I want literary quality to be decoupled from character budgets, quotas, and progress scores, so that the Keeper can choose the right amount and form for the live exchange.
18. As a campaign owner, I want old Mod package versions and campaign locks preserved, so that existing campaigns do not silently change behavior or lose historical evidence.
19. As a campaign owner upgrading a campaign, I want explicit version and settings activation at a safe boundary, so that policy changes are intentional and do not mutate prior receipts or history.
20. As a table using Mods-disabled play, I want package-wide base style changes to remain documented and tested, so that per-campaign Mod pins are not mistaken for full policy isolation.
21. As a scenario author or source maintainer, I want source connections treated as opportunities rather than obligations, so that unresolved leads do not force the Keeper to clear a checklist.
22. As a reviewer, I want defects in source material, projection, truncation, and Keeper uptake diagnosed separately, so that the fix is aimed at the correct system layer.
23. As a developer, I want to keep the existing seven Keeper verbs, capsule, Director, Mod interface, source reader, and state ledger, so that narrative quality improves without a new runtime planner or scoring service.
24. As a developer, I want settled world changes to keep using existing apply effects and receipts, so that literary expectations do not become a second state system.
25. As a developer, I want stalled-turn and offer/adoption telemetry to remain diagnostic only, so that the system does not pressure the Keeper with feedback loops disguised as obligations.
26. As a tester, I want activation evidence to include exact package, resource, model, reasoning, Mod version, digest, and settings facts, so that comparisons are tied to the actual policy delivered to the Keeper.
27. As an editorial reviewer, I want blind comparisons based only on player-visible context, authentic source/public knowledge, and already settled outcomes, so that preferences diagnose writing quality without leaking scenario truth.
28. As a live-regression reviewer, I want continuous real play through the existing gameplay-turn seam, so that polished isolated snippets cannot stand in for a playable table.
29. As a novice-human acceptance reviewer, I want a person who has not read the scenario to use the actual UI, so that AI self-certification cannot substitute for human usability evidence.
30. As a performance reviewer, I want player-submit-to-delivery time and extra foreground model/tool work recorded, so that narrative policy does not hide a latency regression.
31. As a product reviewer, I want incomplete human acceptance reported honestly, so that code review can proceed without claiming the novice experience has been solved.

## Implementation Decisions

- Keep the production kernel TypeScript-only for this work. Do not restore retired Python source, inspect historical trees as implementation authority, or treat a frozen oracle as a second implementation.
- Keep the existing Keeper process and seven verbs. No new production narrative planner, scene graph, foreshadowing registry, memory schema, scoring service, synchronous literary grader, rewrite loop, semantic classifier, failure gate, or narrator split is introduced.
- Preserve the authority split described by the system ontology ADR: Director advice is advisory, rule and source authority remain in their existing graphs and kernel settlements, and text renders settled facts rather than creating a second truth.
- Assign responsibility explicitly: base Keeper style handles play language, register, and general readability; Narration Craft handles selection and expression of material, NPC interaction, and narrative realization; Keeper Pacing handles continuation, handoff, meaningful pauses, and recovery support; Story Thread provides relevant source connections without becoming a checklist.
- Retire literary volume controls from the new Narration Craft package. The routine, costly, reveal, and climax character settings are removed from the new active package version. Engineering context and token budgets remain separate from literary quality.
- Remove active instructions that equate quality with length, compulsory short sentences, compulsory sensory detail, required open questions, per-turn handles as proof of playability, or texture-over-events recipes. Do not replace these with event, clue, paragraph, twist, or progress quotas.
- Harmonize base style, Narration Craft, Keeper Pacing, Story Thread, full instructions, brief instructions, and any affected graph references or digests. Editing only one prompt layer while another active layer contradicts it is incomplete.
- Preserve immutable old package bytes and campaign locks. Existing campaigns locked to older Mod versions keep those locks until an explicit configuration change occurs.
- Upgrade campaigns through the existing Mod configuration flow at a safe boundary. The new Narration Craft settings object is empty if all retired settings are removed. Unknown retired settings must not be carried forward silently.
- Do not add a new migration framework. Use the existing version, digest, settings, state-version, pending-change, and safe-boundary mechanisms.
- Document and test that base-style changes are package-wide, not protected by per-campaign Mod pins, including behavior when gameplay Mods are disabled.
- Make material selection depend on the live exchange: player intent, method, questions, attitude, prior interaction, present scene affordances, NPC motives, NPC knowledge, source constraints, recent context, and memory.
- Treat established outcomes as requiring perceptible, relevant fictional consequences, but do not require a new clue, complication, roll, twist, or plot advance on every turn.
- Use description, dialogue, summary, and clear telling as appropriate. Explain what the investigator could perceive or already knows, while preserving hidden truths and secret/public boundaries.
- Do not dictate player character thoughts, feelings, trust, intentions, or actions. Do not reveal hidden source truth merely because the player asks or guesses.
- Permit one detail to serve several purposes. Permit silence and repetition when they serve the interaction. Allow scene-level satisfaction to span multiple turns.
- Continue uncontroversial parts of an already declared action until the outcome, a real obstacle, a gated risk, or a meaningful new decision/response appears.
- Stop before choosing for the player character, skipping a risk gated by rules or source, or converting free play into a closed story-action menu.
- Treat stalled-turn counts as an advisory prompt to inspect the situation, not as a semantic detector of boredom, engagement, conversation progress, or confusion and not as a command to pressure, move, or cut.
- Define a playable handoff as one where relevant objects, people, conditions, and opportunities are sufficiently intelligible to an uninformed human. The mere presence of an object, posture, route, or visible pressure is not proof.
- Default to natural fictional affordances and free input. When help is requested, clarify goals and known possibilities without a fixed exhaustive action menu, coercion, a new choices UI, or an automatic trailing question.
- Separate clarification from in-fiction recovery. Correcting unclear Keeper communication, reminding known facts, and helping organize options are free. Costs come only from established risks, rules, and actual actions.
- Keep Call of Cthulhu Idea roll rules authoritative for occasional recovery. Do not import GUMSHOE or Powered by the Apocalypse mechanics, and retire the blanket rule that every recovery must cost time, exposure, or alarm.
- Use Story Thread, NPC ledger, and memory to connect present actions to prior observations, promises, attempts, and relationships, while respecting source gates, source truth, secret/public distinction, and player-authored direction.
- Preserve the current writer, projection, and adoption contract. Durable world changes use existing apply effects; adjudication stays in the kernel; literary expectations do not create new state.
- Before enlarging any source or projection pipeline, diagnose whether useful material is absent at source, omitted or truncated in projection, or present but unused by the Keeper.
- Use existing look, lookup, recall, and source-reader routes when necessary. Do not invent core source facts, reparse entire books merely to enrich prose, or increase capsule budgets indiscriminately.
- When source reading must wait, treat the wait as honest product preparation status: explain it briefly and return free input rather than inventing fictional filler, travel, delays, or menus.
- Scope any separately confirmed producer or projection defect with its evidence in a separate specification or task. This spec does not authorize speculative reader or graph redesign.
- Keep Narration Audit receipt-grounded. It checks whether settled receipts are realized as fiction and continues to exclude style, length, voice, language, and literary quality.
- Keep the verifier's existing correctness, privacy, agency, and language remit. Do not add an additional synchronous literary model call to foreground delivery.
- Offline editorial comparison may be used for diagnosis against authentic fixed facts and settled outcomes, but it is not live play acceptance and must not become a production gate.

## Testing Decisions

- Highest seam: test through the existing gameplay-turn path from real player input, through the actual Keeper process and seven verbs, to capsule content, canonical receipts, and delivered player transcript. Mod configuration and context are existing parts of this contract, not new interfaces.
- Tests should assert external behavior, activation evidence, receipts, delivered transcript, configuration locks, and telemetry. Do not assert exact instruction wording merely because it mirrors implementation.
- Activation and configuration evidence must record the candidate runnable App/package/resource version, actual loaded package resources, selected Keeper model and reasoning settings, active Mod versions, digests, settings, full first-turn delivery, brief later-turn delivery, isolated fresh-campaign defaults, explicit isolated old-campaign upgrade, safe deferred activation, disabled-Mod behavior, absence of retired settings, unchanged prior receipts/history, and package-wide base-style behavior. Pin model and conditions when comparing.
- Existing public-interface Mod and Director text regressions are prior art for thread/pacing projections, full-versus-brief instruction delivery, disabled-package behavior, threat-clock offer rows, offer ledger telemetry, and Narration Audit job composition. These are contract tests, not playtest evidence.
- Existing acceptance methodology is prior art for real-table evaluation: product-path play provides evidence that public-interface seams cannot. Source/test/package/GUI/human acceptance remain separate.
- Blind editorial comparison should use anonymized alternatives, authentic source/public knowledge, already settled outcomes, and only player-visible context. It is a static diagnostic comparison, not live acceptance. Readers should cite concrete passages and context explaining their preference.
- If model assistance creates editorial drafts, alternatives, or other source-text structures, use the existing tool-enabled Pi author/reader workflow with read/write/edit/bash. Do not add bare provider or zero-tool text generation paths, and do not widen existing memory or verifier exceptions.
- Editorial diagnostic lenses are action responsiveness, intelligibility, NPC specificity, repetition with purpose, meaningful pause, handoff quality, and agency. They are not all-items-per-turn checklists and must not be collapsed into a total score.
- Do not use word counts, event counts, clue counts, turn counts, paragraph counts, twist counts, offer/adoption counts, or receipt counts as proof of literary quality. These measurements diagnose only their own facts.
- Canonical live regression should use the existing RPC play driver and product launcher with Grok as Keeper, the main session as the sole AI player, and one natural player sentence per turn from opening to a real ending or real blocker. Do not prescribe a second live player for that regression; novice-human acceptance is the distinct actual-UI human gate. Setup should use the existing setup launcher. Preserve all evidence.
- Canonical live regression should naturally cover investigation, uncertain or failed attempts, NPC interaction, urgent decisions, travel or transition, explicit confusion, deliberate pauses, and pleasant low-stakes conversation. Do not force a script to hit counts.
- No scripted player, batch settlements, fake Keeper, or fixture narration counts as gameplay. Those artifacts may support lower-level diagnostics only and cannot stand in for live gameplay acceptance.
- Continuous scenes should be evaluated, not isolated polished snippets. A model-savvy live regression is not proof of novice usability.
- Novice-human product acceptance requires a person who has not read the scenario to use the actual PipiCOC UI with the correct package and Mod activation. Evaluate whether they can understand and respond from public information, feel their input matters, remain interested, and choose to linger without being rushed.
- Reaching an ending alone does not pass novice-human acceptance. Record misunderstandings and passage-specific feedback; do not pre-teach the solution or supply hidden facts. If the human gate has not run, report it incomplete; AI cannot self-certify it.
- Existing correctness protections remain required: source confidentiality, player character agency, kernel arithmetic and receipts, structured mechanical choices, open play-language behavior, serial operations, process and home isolation, full/brief contracts, immutable package contracts, and disabled-Mod behavior.
- Use existing relevant public-interface tests. Do not restore Python source, edit frozen oracle assets, or broaden the task into unrelated runtime migration. When running existing pytest-based checks, run one pytest at a time.
- Operational observations must record actual player-submit-to-delivery time and any additional foreground model/tool work versus the current baseline. The design adds no required foreground model call.
- Status at spec creation: implementation not run; public-interface regressions not run for this proposal; blind editorial comparison not run; canonical live regression not run; GUI/browser acceptance not run; novice-human product acceptance not run.
- Completion standard: spec readiness is not implementation or acceptance. Successful activation/interface tests, editorial evidence, canonical continuous play, and the novice-human gate must be reported separately. A missing human gate blocks claims that the novice experience is solved, though it need not block scoped code review.

## Out of Scope

- New Call of Cthulhu rules, arithmetic, settlement families, or mechanical recovery systems.
- Coercive plotting, railroaded outcomes, default action menus, new choices UI, or automatic trailing questions.
- Runtime scene, beat, clue, event, paragraph, twist, word, or semantic progress quotas.
- Word counts, offer/adoption counts, receipt counts, or telemetry counts as quality scores.
- A separate production narrator model, real-time literary gate, synchronous style grader, per-turn rewrite loop, automatic score feedback, or keyword/regex semantic classifier.
- Automatic penalties for player confusion caused by unclear Keeper communication.
- New capsule feedback based on literary expectations, new state schema for narrative debt, new foreshadowing registry, new scene graph, or new memory schema.
- Source-truth invention, wholesale corpus rebuild, speculative reader redesign, or indiscriminate capsule budget increases.
- Default model/provider migration, unrelated provider changes, unrelated guided-creation or onboarding feature work, unrelated deployment or distribution automation, GUI feature implementation, or automatic mutation of an ongoing user's live campaign.
- Producing a candidate package, checking actual loaded resources, and creating isolated test campaigns are in scope for future implementation and validation when specified, but this authoring task does not run them.
- Automatic save upgrade, silent latest-version selection, mutation of old package bytes, or rewriting of historical receipts.

## Further Notes

- Rollout order: consolidate the active contract and policy first; validate versioned package upgrade and activation next; then run editorial comparison, continuous real play, and novice-human acceptance. Keep old evidence and reference material, but do not use the old screenshot against a current package without documenting package versions and active settings.
- If testing uncovers a system defect, name the defect class and fix only the agreed system path. Do not hand-author special content to repair one screenshot.
- Research references inform the design but are not evidence that the implementation works. [Brandon Sanderson's promise/progress/payoff framing](https://www.brandonsanderson.com/blogs/blog/brandon-sandersons-2025-guide-to-plot-lecture-2) is useful because progress can include information, relationship, and character understanding, not only plot movement.
- [Ursula K. Le Guin's workshop responses](https://www.ursulakleguin.com/bvc-navigating-the-ocean-of-story-session-1) support flexible use of show/tell, resonance, half-repetition, echoes, and endings; these are craft suggestions, not quotas.
- [Writing Excuses on dialogue agendas](https://writingexcuses.com/17-31-everyone-has-an-agenda/) supports the decision that an NPC's intention may be companionship or humor as well as opposition.
- [The Alexandrian on pacing](https://thealexandrian.net/wordpress/31509/roleplaying-games/the-art-of-pacing) supports stopping at meaningful choices and not skipping player decisions during transitions.
- [Sly Flourish on telling rather than only showing](https://slyflourish.com/tell_dont_show.html) supports communicating what characters know and not punishing misunderstandings caused by inadequate communication.
- [Pelgrane's clue/lead distinction](https://pelgranepress.com/2020/02/21/clues-vs-leads/) supports treating a clue as informative even when it is not immediately an actionable route.
- [Robin D. Laws' GUMSHOE One-2-One playtest notes](https://pelgranepress.com/2016/06/13/gumshoe-one-2-one-playtest-feedback-and-acceptable-enjoyment-parameters/) support respecting varied enjoyable pacing, including low-intensity friendship scenes and player-led time with Sources; this does not import GUMSHOE mechanics.
- [Sly Flourish on facilitating choices](https://slyflourish.com/facilitating_choices.html) supports clarifying goals and possibilities while leaving decisions with the player; it is not a three-options quota.
- [Chaosium's public conversion guidance](https://www.chaosium.com/content/FreePDFs/CoC%207/CHA23135-Conv%20-%20Call%20of%20Cthulhu%207th%20Edition%20Conversion%20Guidelines.pdf#page=7) reinforces that Idea rolls are occasional recovery tools and that obvious clues should not be gratuitously gated.

## 2026-09-10 decisions after a code survey

The three forks the review left open were closed by reading the code paths the spec names only by role, by reading the motivating turn's own capsule, and by one reproduction through the emitted kernel. Where a bullet above is less specific than this section, this section is the contract. Nothing below was implemented: no package bytes, kernel source, content file or campaign changed during the survey; the reproduction ran in a scratch workspace.

### D1. The base style is content in `content/craft/`, and six of its items leave

**Where it lives.** "Base style" is two things. `prompts/keeper.md` is the play-mode system prompt (`runtime/launch.ts` selects it by mode; `runtime/deployment.mjs` ships it in the App). The capsule's `style` section is built by `TextGraph.style` in `kernel-ts/read/content.ts` from `content/craft/text-graph.json`, its manifest, and `content/craft/beat-directives.json` (§13.6). Two facts decide the method: every `style-axis` node is sent on every turn, filtered only by `language_applicability`; and the full first-turn form sends every `craft-directive` node in the graph, not only the beat table's picks. So an axis or a directive cannot be retired by editing the beat table alone; its node must leave the graph.

**Decision: edit the text graph.** The survey found nothing that pins it. No `campaign.json` or `world.json` key records the text-graph digest. No test names an axis or directive: `tests/kernel/test_capsule_nine.py` derives `ALL_DIRECTIVES` and `BEAT_TABLE` from the files, and only its `len(style["axes"]) == 9` must follow the new count. The ontology and the Director graph reference only `craft-directive:dying-forces-rescue-subsystem` and `craft-directive:dying-clock-kind`, which stay. No relation touches a removed node. `node_counts` in the manifest is documentary; the loader checks contract ids and `graph_content_digest` only.

**Regeneration recipe, verified against both current manifests.** Parse the graph with `parsePythonJson` and digest with `jsonDigest`, both exported by `kernel-ts/json.ts` (`node --experimental-strip-types` imports it directly; the file has no dependency beyond `node:crypto`). Plain `JSON.parse` reproduces the text-graph digest today only because that graph carries no floats; it fails on the Director graph, so the recipe is the kernel's parser, never `JSON.parse`. Write the new digest and the new `node_counts` into `text-graph-manifest.json`; drop the same ids from `beat-directives.json` in the same change, because the loader refuses a beat table naming a directive the graph lacks.

**Disposition of the nine axes.**

| axis | disposition | why |
| --- | --- | --- |
| `avoid-translationese` | keep (zh-Hans only, as now) | readability |
| `avoid-ai-summary-voice` | keep | readability |
| `avoid-log-style-summary` | keep | readability |
| `avoid-semantic-repetition` | keep; line becomes "no stale repetition; an echo placed on purpose is not repetition" | the repetition rule above |
| `avoid-abstract-psychological-explanation` | keep | agency: inner states are not asserted; telling a fact is not this |
| `prefer-observable-behavior` | keep; line becomes "observable behaviour over asserted inner states" | same |
| `prefer-short-sentences` | remove | compulsory short sentences |
| `prefer-concrete-sensory-detail` | remove | compulsory sensory detail |
| `prefer-open-ended-prompt` | remove | a required trailing question |

**Disposition of the seventeen directives.**

| directive | disposition | why |
| --- | --- | --- |
| `player-action-uptake`, `action-uptake-review` | keep in base | responsiveness is the product, not craft |
| `repetition-policy` | keep; line allows the purposeful callback | as above |
| `observable-before-interpretation`, `skill-interpretation-after-visible-evidence` | keep | readability and fairness |
| `rewrite-abstract-psychological-explanation`, `rewrite-abstract-explanation-to-action` | keep | agency and readability |
| `rewrite-ai-summary-voice`, `rewrite-passive-translation-ese`, `rewrite-camera-direction-staging` | keep | readability |
| `final-prose-guard-before-output` | keep | a self-check on a hard draft, no loop |
| `final-output-pass` | remove | its rationale names `narration.review`, a tool this tree does not have; it duplicates the guard |
| `spend-budget-on-scene-texture` | remove | the texture-over-events recipe, written in terms of the retired budget |
| `scene-sensory-anchor` | remove from base; Narration Craft may offer the opening detail as a choice | compulsory sensory opening |
| `rewrite-expository-choice-summary` | remove | "handles as scene" is the handle-as-proof recipe; the anti-menu half already lives in `prompts/keeper.md` |
| `crisis-scene-clarity` | remove from base; crisis ordering moves to Narration Craft without the handle clause | craft, not readability |
| `npc-direct-speech` | remove from base; Narration Craft owns NPC voice | one owner per rule |

Six axes and eleven directives remain. The beat table keeps its eleven keys (ADVANCE and the ten Director actions), each picking at most four of the eleven, and its English lines are rewritten where the table above says so. The `en` full set, which §13.10 records as over the 2KB budget, should now fit; the test asserts the budget, not the truncation.

**What `prompts/keeper.md` gains.** Base owns the definition of a playable turn, so it lives in the system prompt every table has, Mods on or off: take up the declared action, question, attitude or pause; make settled outcomes perceptible; stop at a real obstacle, a real decision or an opportunity an uninformed player can understand, never at a planted object; tell plainly what the investigator perceives or already knows; never write the investigator's thoughts, feelings, trust, intentions or actions; clarification and reminders of known facts are free. The file also says two different things about `ask` today (law 4 offers `kind=story`; the tools paragraph reserves `ask` for closed mechanics choices). The implementation keeps the reading consistent with this spec's rule against story-action menus and says it once.

### D2. Narration Craft survives as the craft package; base owns the turn

Retiring the package was considered and rejected. A package keeps per-campaign locks and explicit upgrade (stories 18 to 20), gives the blind comparison an off switch, and can be versioned without touching every table; base cannot. A table with gameplay Mods disabled still receives the playable-turn definition because it lives in `prompts/keeper.md`, not in the package.

- **Narration Craft 1.1.0.** `settings` and `settings_schema` become `{}`. Gone: the beat-keyed budget paragraph, "give a cost its own paragraph", "at least one concrete handle is in reach before you stop", "then an open question of what they do", and the action-uptake and keep-the-fact sentences, which duplicate base. Kept and owned: an NPC with news or a refusal speaks in their own voice, and a public failed check with a person present is their opening (`present[].voice`); crisis ordering (where the investigator stands, the space, what moves, the force and the worsening risk, what can be used) without the handle clause; a scene may open on something the investigator perceives, offered as craft and not required; Laws' beat vocabulary and the humour knobs; the world-assertion cost ladder. Added, from the bullets above: select material from the live exchange and the dossier; friendly help, cooperation and companionship are valid outcomes; one detail may serve several purposes; summary and plain telling are allowed; hidden truth stays hidden, by reference to law 3 rather than restated. `brief.md` follows; `description` no longer advertises a budget; `CHANGELOG.md` gains the missing 1.0.2 entry (commit `317a5991` bumped `mod.json` only) and the 1.1.0 entry.
- **Keeper Pacing 1.1.0.** The `stalled_turns` paragraph becomes an inspection, not a command: the counter only says no clue, move or session receipt landed in consecutive played turns (`kernel-ts/read/director.ts`); whether the player is stuck or lingering is read from their own words. A player asking what to do gets the recovery order world, then a present person, then information, as §30.11 recorded on `stall-1`, whose player was stuck and whose cut was right. A player talking, reflecting or asking about the scene is playing, and the counter does not override that. The recovery paragraph drops "never a clean free insight" and "always costs"; the Idea roll stays as the rulebook has it (a failed roll still brings the lead, at a cost), and clarification of unclear Keeper communication costs nothing. Fair warning and threat clocks are unchanged; `stall_turns` stays as the setting that arms the inspection.
- **Story Thread 1.0.2.** "Plan the next step from it every turn" becomes language of opportunity: the lines are where the story can go, taken when the fiction reaches them. The structural semantics (`handed`, critical first, `fallback`) are unchanged.
- **Narration Audit, Natural NPC, Enhanced Items: unchanged.** Natural NPC was surveyed because it was the one gameplay package active on the motivating turn; its first-impression and language rules do not contradict this spec.

### D3. Upgrades: the kernel retires undeclared settings on an implicit carry-forward

**Reproduced, 2026-09-10, emitted kernel `build/kernel/rpc.mjs`, fresh The Haunting in a scratch workspace.** `configure` in `kernel-ts/mods/runtime.ts` carries the active lock's `settings` forward when the request has none, then rejects any key the target version does not declare. The Mods panel's Update button sends `{id, version}` and its checkbox sends `{id, version, enabled}` (`pipicoc/mods-panel.js`; the Electron panel test pins the same shapes). Observed:

| step | request | result |
| --- | --- | --- |
| lock narration-craft at the real 1.0.1 (bytes from `818cbb20`) | `{version: "1.0.1"}` | ok, eight settings |
| 1.0.1 to 1.0.2, panel Update shape | `{version: "1.0.2"}` | `invalid_params`: Invalid Mod enable state or unknown setting; lock stays 1.0.1 |
| same, explicit settings | `{version: "1.0.2", settings: {}}` | ok, four settings |
| 1.0.2 to a 1.0.3 copy with `settings: {}` | `{version: "1.0.3"}` and `{version: "1.0.3", enabled: true}` | both `invalid_params`, same message |
| same, explicit settings | `{version: "1.0.3", settings: {}}` | ok; lock and capsule instruction row show `{}` |

The hazard already shipped with 1.0.1 to 1.0.2; it has not been hit because no campaign has upgraded across it (`merged-1` is still locked to 1.0.1).

**Decision.** Fix the kernel, not the panel. When a request names a `version` different from the active lock and carries no `settings`, `configure` carries forward only the keys the target version declares, and writes one telemetry row `{"lane": "mods", "event": "settings_retired", "mod", "from", "to", "keys"}` so the retirement is recorded and not silent; the new lock is visible in `mods.list`. A request that names an unknown key explicitly is still refused, so §26's "Unknown settings are rejected" narrows to the request rather than to the inherited lock. The panel does not change. Panel-side defaults were rejected because RPC and driver callers would stay broken and the panel "never guesses" (§26); leaving the refusal was rejected because it blocks every upgrade this spec requires. The regression test mirrors the reproduction in `tests/kernel/test_mod_packages.py`: install a copy of the package with `settings: {}`, configure with version only, assert the new lock, the telemetry row and the capsule row, and assert an explicit unknown key is still refused.

### D4. Contract and document entries, written before the code

- §26: the carry-forward rule of D3.
- §13.6 and §13.10: six axes, eleven directives, the rewritten beat table, the regeneration recipe.
- §30.3: the Narration Craft row still says "eight integer settings" and the length ladder; rewrite it to 1.1.0. The Keeper Pacing row loses "always costs time, exposure or alarm".
- §30.11: add the stuck-versus-lingering reading of D2 beside the recorded `stall-1` verdict.
- New §30.12 carrying D1 to D3 and the anatomy of the motivating turn, which the survey read from the campaign's own `turns/0017.json`: the capsule carried the full scene summary (the feeders at the crack, the charnel pit, the two assets, the two endings) and complete dossiers for Larkin and de Mendoza; `dramatic_question`, `pressure_moves`, `exits`, `affordances` and `keeper_notes` were empty at source, the §30.4 reader gap for imported books; the prose used the scene texture and the NPC manner and failed at the handoff; the verifier lane recorded three `uncommitted_state` findings for NPC movement narrated without `apply`. Three diagnoses, three layers, as the bullet above requires.
- `mods/narration-craft/CHANGELOG.md`: the 1.0.2 entry.

### D5. Rollout order, refining Further Notes

1. Contract entries (D4). 2. Kernel settings fix and its test (D3). 3. `content/craft` edit, manifest regeneration, beat table, the axis count in `test_capsule_nine.py` (D1). 4. `prompts/keeper.md` (D1, D2). 5. Narration Craft 1.1.0, Keeper Pacing 1.1.0, Story Thread 1.0.2 with briefs and changelogs; `tests/kernel/test_mod_director_text.py` stops asserting `routine_chars`. 6. `npm run build:runtime`, the existing suites one pytest at a time, and a repackaged App, because the installed App is the packaged build. 7. Activation evidence on a fresh campaign and on an explicit upgrade: a campaign is created with the latest lock, so the old-version case is made by configuring a new campaign down to the old version first and then up, never by mutating a preserved campaign. 8. The live regression and the human gate exactly as Testing Decisions state.

Tickets: the plan above is split into [#69 to #79](https://github.com/Leehow/chatrpgv4/issues/68) under parent #68, with native blocking edges; the ticket file is `docs/specs/keeper-narrative-quality-tickets.md`.
