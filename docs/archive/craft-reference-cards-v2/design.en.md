# Craft Reference v2: improve the Keeper, not the inspection pipeline

**Baseline:** `Leehow/chatrpgv4`, branch `0.9.5a`, commit `6478133878b1fc574f98324401a60bd165d9b5f2`.
**Delivery status:** curated assets, a tested TypeScript reference library, and a guarded two-file patch tool. Source integration and model-quality experiments remain unperformed.

## 1. Decision

Keep the existing Keeper, its NPC material and its authority paths. Replace vague negative craft reminders with useful positive directions. Introduce a small optional writing reference only when it helps the current exchange. Jev selection is a later, separately measurable treatment, not a prerequisite for the positive-reminder improvement.

The unit of optimization is an exchange: what the player has just asked, attempted, joked about, inspected, clarified, declined or left unsaid. The Director beat remains useful background. It is not a sufficient selector for voice or amount of description.

A short answer, ordinary warmth, hostile refusal, silence, a requested recap and a leisurely view are all potentially good writing. No single quiet horror register is made the universal target.

## 2. What changes from v1

| v1 tendency | v2 decision |
|---|---|
| Treat a public-facts capsule as the full scope of the Keeper | Distinguish Keeper composition from a narrowly constrained rewrite |
| Put generation, diagnosis and repair into one architecture | Separate positive prompting, reference injection, optional selection and diagnostic research |
| Very bad text versus minimally correct text | Three positive alternatives, a counterexample, and a contextual exception |
| 144 cards appear as an implementation target | 48 revised craft cards; 12 initial retrieval candidates; no full-library prompt |
| Python reference tooling | TypeScript library, tests, build tools and patch tool |
| Chinese mixed into runtime material | English canonical runtime, independent Chinese human review |
| Source-inspired examples without detailed source studies | Twelve inspected source studies with locators; original examples explicitly distinguished |

All 144 v1 identities are retained in a migration manifest. The mapping is family-level editorial triage, not a claim that 48 new cards exactly implement 144 old diagnoses.

## 3. What the source review establishes

The pinned `kernel-ts/read/content.ts` contains `TextGraph.style(language, register, beat, full)`. It consumes `axis_lines` and `directive_lines` from `content/craft/beat-directives.json`. In full mode it sends every existing craft-directive node. This is why the new cards must not be appended as 48 ordinary graph directives.

The pinned Keeper prompt already uses `play_language`, treats Director advice as optional, and plays people from `wants`, `fears`, `hides`, `knows`, `would_lie_about`, `ties`, `toward_party` and `history`. The capsule code also projects relationships, recent speech, commitments and reunion material. These are the existing bases for distinctive NPC expression.

The pinned auditor explicitly permits compatible fictional invention and excludes literary-style grading. It still checks intelligibility, factual compatibility, player authorization, outcomes and disclosure. Leave that boundary intact. Source reading proves these declarations and code seams exist; it does not prove their complete runtime adoption.

See the separately linked [repository review](repository-review.en.md) for paths, hashes, inspected sections and unresolved integration questions.

## 4. Creativity and authority

### 4.1 Keeper composition

The Keeper may create compatible dialogue, ordinary atmosphere, incidental texture and performance. A hand resting on a cup or the phrasing of a refusal does not need to have been exhaustively authored in the module. The existing scene, source, identity and state constrain that invention.

The distinction is consequential rather than a static list of nouns. A cup's temperature might be incidental in a meal and evidence in a poisoning investigation. A pause might be ordinary performance but must not be narrated as proof of guilt. The card cannot decide those meanings by keyword.

When a detail introduces a persistent affordance, a person who must be targeted, an item transfer, a promise owed, a clue acquisition, a new ongoing locus, a time change or a mechanical outcome, use the relevant existing owner path. There is no new craft-owned world database. Once a compatible detail is delivered, preserve it through existing transcript/continuity handling; do not silently erase it next turn because it was originally improvised.

### 4.2 Constrained rewriting

A deliberately invoked editor may be told to preserve the current draft's facts, available information, commitments and chosen actions. That narrower task may change diction, order, focus and rhythm without adding a new event. It does not define the power of the whole Keeper.

The same sample can be suitable for Keeper composition and unsuitable as a literal rewrite because it contains optional incidental detail. Every card therefore includes an `elaboration` note. Do not use fact-equality tests to certify invention-rich examples or use invention permission to rescue an actual contradiction.

### 4.3 Existing hard boundaries stay hard

Card selection never changes dice, outcomes, player decisions, established identity, known-versus-secret status, item custody, time or persistent world state. NPC motives guide expression; the selector cannot create new motives merely to diversify a voice. Player feelings can be acknowledged when declared or rendered when an involuntary effect is actually settled; otherwise they remain the player's.

## 5. The card is a small comparative lesson

A canonical card contains:

- Stable identity, family, source-study references and uncalibrated editorial provenance.
- Positive purpose, semantic applicability and a meaningful non-applicability condition.
- A common context and three renderings: `acceptable`, `stronger`, `alternative`.
- A counterexample and an explanation of its contextual defect.
- A changed boundary context and a lawful treatment.
- A comparison note and an elaboration/authority boundary.

`stronger` is not a ground-truth label for all readers or all exchanges. It identifies what the editor is trying to improve in the supplied context. Several cards deliberately make a plain answer fully acceptable. “Do nothing” is not a quality failure.

The 48 cards span exchange purpose, voice, dialogue, sensation, horror, rhythm, memory and action. These are editorial browsing families, not a forced classifier of every turn. A turn can serve several purposes; selection should favor the one reference that addresses the most useful immediate writing decision, or none.

## 6. Use actual literature carefully

The source studies inspect six literary works and six tabletop texts. Each study records the passage, an observation, an editorial transfer, and what must not transfer. A short original-language quotation appears only in the research material. Runtime examples are newly authored.

A novel is not a transcript of a game. Dickens and Joyce can directly narrate a protagonist's interiority; that is not permission to decide the investigator's feelings. Blackwood's willow passage explicitly uses subjective projection; calling it purely objective description would misread the source. Mansfield's incompletion is not broken grammar. The tabletop texts likewise differ: roleplaying hooks, a diegetic manual and a Keeper-facing scenario instruction are not all examples of player-facing prose.

No author name is used as a command to imitate that author's whole style. No source's characters, plot secrets, entities or fictional instructions are installed as game facts. The source studies support design interpretation, not empirical claims about Jev or LLM performance.

## 7. English canonical assets and independent review translation

```
src/ + runtime/        -> production import/export graph (English authored assets)
review/                -> Chinese human review, bilingual browser and comparison text
research/              -> provenance and close-reading notes, not runtime instructions
```

This is a packaging boundary, not a ban on non-English user input. The actual player input, NPC names, quotations and campaign facts may be in any supported play language. Do not transliterate them to satisfy an English-asset lint.

The Keeper generates directly in `play_language`. The English sample demonstrates technique; it is not a sentence to translate into every language. English word order, fragment conventions and punctuation are not universal. Validate language quality separately with competent readers. This package's Chinese review translation is not evidence that the system writes Chinese well.

The library's renderer selects an explicit English field allowlist. It never serializes the whole bilingual card. `package.json` exports only the runtime library, and the runtime-only distribution excludes review/research material. A static Han-character lint is applied only to authored English resource files, never to game inputs.

## 8. Three levels of adoption

### A. Positive reminders

The patch changes six axis lines and eleven directive lines without renaming their IDs, altering the Director map or changing the four floor lines. A single inspected Keeper paragraph is replaced to clarify positive composition, ordinary compatible invention and explicitly marked examples. The auditor is not modified.

This is the first experiment. It creates no new model request. It can still affect token length and model behavior; measure rather than assume a gain.

### B. Optional references

First choose examples manually for an offline historical comparison or through an existing context-aware selection point. Render at most one primary reference, optionally including one short positive example. The full lesson, counterexample and Chinese review do not enter the normal Keeper request.

There is no required number of sentences, sensory details, clues or events in the output. The reference byte budget bounds added context, not player-facing prose. If an example does not fit, drop it whole. If the method alone does not fit, drop the reference. Do not truncate a factual packet to make room for a literary sample.

The 12-card starter set is a candidate pool, not twelve instructions injected each turn. Whole-library enumeration should remain offline unless a later retrieval experiment justifies it.

### C. Jev selection

Reuse `runtime/jev/decision-port.ts`, the current `DecisionBatch` shape, actual `TaskLease`, existing provider configuration and budget owner. The package provides a structurally matching choice question; it does not create another API client or new credentials flow.

Each candidate exposes purpose, use condition and exception. Include `NONE`; expose `KEEP_CURRENT` only with an actual current reference. Provide current player input and relevant established scene/NPC material in the host-projected state. The Director beat is context rather than the selection target.

Selection is bounded and optional. An unavailable, incomplete, malformed, foreign or stale result falls back to ordinary Keeper composition. That fallback is safe for a craft suggestion; it must not be copied into required authorization or rule lanes. Do not automatically retry or call a second LLM to rescue a missed style suggestion.

## 9. Proposed integration seam, not a claimed installation

`style.reference` is a proposed optional host field. It does not currently become valid merely because this package returns an object. The integration owner must choose a real pre-request insertion point, register the task family, pass the existing lease, respect the current read set and cancellation, and prove that the reference reaches the next actual Keeper request.

Do not add a second outer ReAct loop, `write_better` tool, or new `using_skill` obligation. Existing procedural skill cards and craft examples have different meanings. Preserve the host's exact marker and spoken-line protocol; literary samples deliberately omit session-specific markers and cannot be copied verbatim as a ready delivery.

Minimum evidence: candidate found, reference selected, actual request injected, and output inspected. Record these separately. `selected` does not imply `used`, and `used` does not imply improved quality.

## 10. Freshness, history and budgets

The host binds suggestions to the current input revision, branch/worldline, relevant state and NPC knowledge revisions, model/family configuration and card revision. The reference library exposes a content hash and checks caller-supplied revision identity, but only the existing host can validate a real read set or task cancellation.

Stable campaign register and NPC voice can persist. A turn-local reference cannot be assumed valid after a changed goal, speaker, knowledge state or scene. Returning to a scene may restore its available reference material but not stale conclusions. No random per-card cooldown or forced rotation is introduced.

Use an explicit parent task budget and charge provider usage once, through the existing adapter. A returned probability is the model's output, not an independently calibrated probability of suitability. Do not invent a universal confidence threshold. Offline calibration should measure false interventions, abstention, and differences across language and exchange type.

## 11. Diagnostics remain separate

The user's original idea—identify the current text's contextual problem and retrieve a positive alternative—remains useful in an editor view or a shadow experiment. It is not enabled by default here.

A future diagnostic should operate on host-issued occurrence aliases, bind the current text revision, permit no problem/not applicable/insufficient context, and report missing information as an omission rather than inventing an erroneous quote. Retrieve an applicable technique or example ID; Jev selection is not free-text rewriting. Actual rewriting, when deliberately requested, remains a bounded LLM task under the original authority constraints.

Never feed a shadow aesthetic finding into the publication refusal path. Never retroactively replace already streamed text as if it had not been seen. Existing safety/correctness review is a different lane and is not disabled for speed.

## 12. Two source constraints need separate reconciliation

The inspected Keeper prompt still limits the opening to at most one room sentence and one gesture per speech line. It also states that a repeated spoken line is refused. These instructions can conflict with broad permission for meaningful elaboration and literal callback.

The included patch does not silently delete them or pretend to change the implementing validator. Inventory the actual runtime owners and tests first. The opening limit may be an intentional first-turn orientation measure, not a per-turn rule; preserve its goal when considering a replacement. A real repeated-line rejection may need an explicit contextual exception path, not just a new positive sentence. Until that is reviewed, variants requiring exact repeated speech remain teaching examples, not proof they will pass production.

## 13. Evaluate one cause at a time

| Variant | Changed factor | Question |
|---|---|---|
| A | Pinned current path | What does the baseline actually do? |
| B | Positive reminders only | Does better instruction help? |
| C | B plus manually/contextually selected examples | Are the references useful? |
| D | Same C catalog, Jev selection | Does selection add value over C? |

Use real retained turns with the necessary prior input, NPC state, facts, authorization and settled results. An isolated sentence is not enough to label a context-sensitive defect. Freeze prompt/model/configuration, source versions and cache conditions. In text-only studies, hold settled outcomes fixed; do not claim a comparison is only prose when the variants changed plot facts.

Blind readers see shuffled paired outputs, can choose either, a tie or neither, and evaluate intelligibility, conversational uptake, voice, atmosphere fit, continuity and player freedom separately. Do not make “more literary” synonymous with “better.” Include narrow confirmations, jokes, hostile NPCs, grief, failed checks, ordinary safe rooms, long invited observation, reentry, repeated requests, loops and multiple languages. Keep a hidden holdout not derived from these teaching cards.

Then run real-table turn-by-turn trials through the actual UI. Report first visible content, final delivery, usable next input, provider calls, retries, tokens, unavailable suggestions, source leakage and example-entity contamination. Paired local text preference cannot prove game quality; contract tests cannot prove either.

## 14. Completion boundaries

Completed in this package: original bilingual card assets, source studies, positive-line revision, TypeScript helpers, guarded patch tooling, local contract tests and an offline browser.

Not completed: changes on GitHub, installation into the actual application, task-family registration, capture of a real Keeper request with the new reference, real Jev calls, LLM-generated comparisons, human calibration, multilingual acceptance and live-table/latency results.

Adopt in order: positive reminders → actual NPC/communication path → sparse examples → measured Jev selection → only then consider limited editor repair. The objective is a Keeper who tells and responds better, not prose that has passed through more inspectors.
