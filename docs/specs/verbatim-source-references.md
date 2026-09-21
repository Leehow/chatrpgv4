# Verbatim source references

<!-- unified-jev-supersession -->
> **Superseded design snapshot.** Do not implement this file independently. The [unified runtime refactor](jev-unified-runtime-refactor.md) is the single current design, tracked in [#101](https://github.com/Leehow/chatrpgv4/issues/101). The original proposal below is retained for traceability.

Historical status: superseded by the unified design; not an independent implementation plan.

## Problem Statement

Models are currently asked to copy existing prose, record fields, names, and unchanged values in several workflows.
That makes exact copying look like evidence of attention, but it is a weak and expensive contract.
A model can miscopy a quote, splice two duplicates, preserve the wrong occurrence, or retype an identifier incorrectly.
Those failures are format/reference failures, not necessarily semantic review failures, yet they can block the turn or hide the true issue.
The user wants every current verbatim-copy pattern restructured so the host owns exact extraction from pinned sources.
The model should decide meaning, select among host-offered source options, or generate genuinely new material.
It should not calculate offsets, retype machine identifiers, copy digests, copy receipt ids, or duplicate unchanged text.
The current TypeScript kernel remains the sole production implementation and authority.

The same contract must now cover document pages, not only in-memory job strings.
Source material increasingly includes immutable document-page native text and page images, and the model must never be asked to retype page text, compute a page span, or invent an opaque page handle.
The proposed host materialization covers speech taken directly from `say` segments, existing records, exact names, narrative excerpts, numeric values already present in typed records, paragraphs kept without translation, and unchanged fields.
The user wants one host-issued page/span/field selection contract that the document path and later Jev-assisted consumers can share.
A source reference proves where text came from, not that OCR or native text equals the visible page, and not that the source supports a claimed interpretation.
This specification therefore separates location proof from interpretation proof and from independent visual source proof.

A stands alone: it can be specified, implemented, and accepted without Jev or any batched-decision provider.
Separate acceptance does not mean future Jev work may invent a parallel locator scheme; any B consumer that needs source spans or page selections must reuse A's accepted contract, while B research, adapter work, and consumers using existing host-owned fixed candidate packets can proceed independently.

## Solution

Introduce one host-owned source selection and resolution contract reused by existing business entrypoints and by the document path.
Each entrypoint prepares immutable source snapshots, model-visible aliases or ordinals, and internal locators for eligible source material.
For documents, the host pins immutable document-page native-text snapshots and exposes host-issued page, span, and field selections.
The model answers with selections and semantic judgments rather than copied existing strings.
The host resolves each selected reference against the pinned snapshot and reconstructs exact text, record values, numeric values, and legacy display fields.

The data contract is host-issued. Every selectable packet states its source owner and applicable scope; campaign work additionally binds campaign, worldline, loop, job, turn, and generation where relevant.
Library documents that are immutable and reusable are scoped primarily by document, with campaign, worldline, loop, and job scope attached only where the selection actually belongs to that work.
This avoids making every reusable PDF page depend on one campaign while still binding active work to its owning scope.
Allowed source kinds are candidate prose, exact current input, pinned retained evidence fields, supplied existing records, and pinned document-page text.
Each source is bound to the owning subsystem and to a revision, extraction revision, or immutable packet identity so the resolver can distinguish active work from historical display.

For documents, the host binds the original document identity, physical page, and extraction revision into the locator.
Normalization creates a new derivative and a new source mapping; it never edits the pinned native text.
The model sees semantic aliases, page ordinals, or field labels and never authored offsets, hashes, opaque ids, or page handles.
Text locators use pinned exact UTF-16 code-unit half-open ranges and reject surrogate splits.
Resolution rejects stale, bad, foreign, duplicate-ambiguous, and unsupported field references explicitly.
Native numeric tokens may be selected and parsed deterministically when the field, units, and source are unambiguous.
Visual-only facts or semantically ambiguous new facts remain with tool-enabled source readers and independent source proof.

Resolver outcomes are explicit: resolved, invalid, stale, unavailable, or out-of-scope.
Resolution materializes the legacy quote-shaped, field-shaped, or page-derived values before existing semantic and transaction validators run, so current authority checks remain authoritative.
Exact duplicate text is distinguished by locator identity, not by content search; replay after restart uses existing immutable job packets and retained history, not a second source store.
Active job acceptance enforces freshness, while historical already-materialized artifacts remain read-only display and evidence.
Genuinely new prose remains generated: reasons, fixes, optional derived memory summaries, NPC descriptions, translations, and image prompts are not reclassified as copied source. Reference-based memory rows select existing words and typed annotations; they do not require newly generated prose. The companion Jev specification owns the memory lifecycle redesign, while this reference contract remains provider-independent.
Historical already-materialized artifacts remain read-only; no broad save rewrite is part of this task.

## User Stories

1. As a player, I want narration reviews to preserve exact adverse excerpts, so that valid repairs are not lost to quote typos.
2. As a player, I want unchanged document text to stay byte-for-byte faithful when it should be kept, so that clue wording is not paraphrased.
3. As a Keeper operator, I want the host to extract source text, so that models judge meaning instead of proving attention by copying.
4. As a continuity auditor, I want to select the offending spoken line by ordinal, so that every line still receives accountable judgment.
5. As a continuity auditor, I want to identify a candidate claim by source segment, so that duplicate text is not silently bound to the first occurrence.
6. As a continuity auditor, I want evidence references bound to supplied files and fields, so that conflicts cite the actual retained source.
7. As a reviewer of intelligibility, I want to mark the malformed passage without retyping it, so that semantic reasons remain the focus.
8. As a reviewer of player address, I want to identify third-person player references by span, so that the repair can still be second-person.
9. As a reviewer of outcome commitments, I want to select unsupported result claims, so that failed-roll respect remains semantically checked.
10. As a reviewer of locus changes, I want to select the new-locus claim while the host copies the exact text, so that scene authority is preserved.
11. As a reviewer of causal reentry, I want to choose the basis and relevant row, so that clue and relation values are host-copied from authority.
12. As a post-delivery verifier, I want to report warning spans without authoring quotes, so that advisory findings are retained accurately.
13. As a memory extractor, I want exact source references for extractive memory and optional generation for genuinely new summaries, so that storing a new memory does not require rewriting existing words.
14. As a memory story assessor, I want to select the player's frame and delivered bridge passage, so that exact excerpts remain anchored.
15. As a correction reconciler, I want to select prior target records, so that old subject and statement text is not retyped.
16. As an NPC journal writer, I want to choose a recordable person by supplied name, so that generated descriptions remain separate from selection.
17. As a document presenter, I want to choose keep-source for already-in-language paragraphs, so that line breaks and empty text survive.
18. As a map presenter, I want to choose keep-source or translate per label, so that mixed-language captions and clue fragments survive.
19. As a setup guide, I want to preserve a player-provided name and pending action by selection, so that real requests remain exact.
20. As a setup guide, I want unrelated appearance edits to patch only changed fields, so that old player-approved prose is not regenerated.
21. As a document reader, I want to select a physical page and span by host-issued alias, so that I never calculate a page offset or retype page text.
22. As a document reader, I want the host to bind the original document identity and extraction revision, so that a selection cannot silently float to a different extraction.
23. As a source auditor, I want normalization to create a new derivative rather than edit pinned text, so that the original native text remains provable.
24. As a source auditor, I want a source reference to prove only provenance, so that text location is not confused with an interpretation or a visible-page guarantee.
25. As a rules reader, I want a native numeric token selected and parsed deterministically when field and units are unambiguous, so that stats do not depend on model arithmetic.
26. As a rules reader, I want visual-only or semantically ambiguous new facts to stay with tool-enabled source readers, so that the model does not fabricate a reading from text alone.
27. As a library curator, I want reusable immutable documents scoped by document, so that every PDF page does not become dependent on one campaign.
28. As a campaign operator, I want campaign, worldline, loop, and job scope attached where applicable, so that active work is still bound to its owning scope.
29. As a developer, I want one shared resolver contract, so that copy elimination does not become many incompatible reference schemes.
30. As a developer, I want stale snapshot failures to be explicit, so that queued jobs cannot bind selections to moved evidence.
31. As a developer, I want duplicate text handled by locator identity, so that exact wording alone never chooses the wrong duplicate.
32. As a developer, I want foreign and unsupported-field references rejected, so that a selection cannot escape its declared source set.
33. As a maintainer, I want legacy quote fields reconstructed where consumers still need them, so that migration does not force a broad rewrite.
34. As an operator, I want retained old artifacts to remain readable, so that evidence history is not rewritten during migration.
35. As a future agent, I want every copy class inventoried or dispositioned, so that no hidden prompt still asks a model to copy existing values.
36. As a future Jev consumer, I want to reuse A's accepted page/span/field contract, so that document selections and decision evidence stay consistent.
37. As a security reviewer, I want the resolver to reject foreign references and opaque model-authored handles, so that a selection cannot cross campaign or document boundaries.
38. As a reviewer, I want the prototype's source-name review disagreement recorded as rationale, so that the failed gate is not mistaken for a passed one.

## Implementation Decisions

Contract shape:

- Build one small host-owned source selection and resolution contract, not a broad naming or source refactor.
- Reuse the contract through existing audit, memory, presentation, setup, journal, verifier, and document entrypoints.
- Treat current pinned job inputs, retained campaign record versions, and immutable document-page native-text snapshots as the source of truth for snapshots.
- Persist only reconstructible locator metadata needed to resolve queued or restarted work.
- Do not add a second truth store or a second source store for source text.

Scope and source kinds:

- Define the host-issued selection scope as campaign, worldline, loop, and, where applicable, job, turn, and generation.
- Scope reusable immutable library documents primarily by document, attaching campaign, worldline, loop, and job scope only where the selection belongs to that work.
- Allow only candidate prose, exact current input, pinned retained evidence fields, supplied existing records, and pinned document-page native text as source kinds unless a later owned entrypoint extends the contract.
- Bind every source to revision, extraction revision where applicable, immutable packet identity, and owner before presenting it to the model.
- Bind every source reference to scope, source revision, generation epoch, and candidate revision where applicable.
- Read-only historical display may tolerate older material; active generation acceptance uses stricter invalidation.

Model-visible interface:

- Model-visible labels should be semantic aliases, page ordinals, field labels, or ordinals created by the host.
- Internal locators may contain opaque details, but the model should not have to retype them.
- The model never writes offsets, raw pointers, filesystem paths, JSON paths, receipt ids, digests, hashes, page handles, or other machine identifiers.
- Every question must name its allowed source set and expected judgment so selections cannot float across unrelated prompts.
- Let host-prepared smaller segments satisfy partial quote needs; do not ask the model to compute offsets.
- Preserve enough surrounding context for semantic judgment, including dialogue exceptions and antecedents.

Text and structured locators:

- Text ranges are half-open ranges over exact pinned source strings.
- The internal text offset unit is UTF-16 code units because current JavaScript slicing uses that unit.
- Do not claim W3C Text Position Selector conformance when using UTF-16 units.
- Reject any range that splits a surrogate pair.
- Do not normalize source text before hashing, binding, or extraction.
- Normalization creates a new derivative and a new source mapping; it never edits the pinned native text.
- Do not fuzzy-reanchor stale strings.
- Do not select the first duplicate text by content search.
- Treat exact duplicate text as distinct when locator identity, source owner, revision, field, or range differs.
- Structured source references use allowlisted record and field selections.
- Do not expose arbitrary JSON pointer paths or filesystem paths as model-authored authority.
- Unknown, unavailable, stale, bad, foreign, duplicate-ambiguous, or unsupported-field selections are validation failures.
- Validation must not silently drop adverse findings merely because a reference failed.

Document-page native-text snapshots:

- Pin immutable document-page native-text snapshots keyed by original document identity, physical page, and extraction revision.
- Bind the PDF physical page and extraction revision into the host locator so a selection cannot float across extractions.
- Expose host-issued page, span, and field selections; the model selects an alias or ordinal and never an authored offset.
- Treat a source reference as provenance proof only: it does not prove that OCR or native text equals the visible page, and it does not prove that the source supports a claimed interpretation.
- Keep independent page-image review and independent source proof separate from text location proof.
- Allow a native numeric token to be selected and parsed deterministically when the field, units, and source are unambiguous.
- Keep visual-only facts and semantically ambiguous new facts with tool-enabled source readers and independent source proof rather than the text-only selection path.
- When a consumer needs a normalized or transformed view, create a derivative and its source mapping rather than mutating the pinned text.
- Keep document-page text snapshots reconstructible from the immutable source and extraction revision; do not add a second source store.

Resolution and authority:

- Materialize resolved source values before existing semantic validators and transaction validators run.
- Preserve per-line speech accountability: every spoken line still receives a pass/revise decision and currently required reason.
- Preserve aggregate audit accountability: removing copied quotes is not by itself a better semantic judge.
- Keep semantic rewriting separate from copy-oriented shape repair.
- Keep post-delivery verifier advisory; quote resolution must not convert warnings into delivery gates.
- Materialize reference-based memory from selected original sources; keep genuinely new derived summaries optional and generative. Do not require generation for every new memory row. The companion specification owns lifecycle changes; A supplies the shared reference contract without requiring Jev.
- Correction reconciliation selects existing correction and target records; host copies unchanged fields.
- Correction references must preserve worldline, chronology, correction lineage, and memory authority.
- Presentation tasks use keep-source, generate, or patch decisions for selected portions.
- Deciding language and meaning remains semantic; do not use script regexes or hard-coded language tables.
- Preserve player edits, exact paragraphs, mixed-language clue fragments, and empty text.
- Source applicability alone must not trigger needless generation.
- Setup distinguishes truly new profile fields from old fields that can be patched or kept.
- Semantic names for actions, skills, people, clues, and records remain valid selection interfaces.
- Do not replace every name with an opaque id merely to satisfy a copying audit.
- Host-owned transfer of already-copied scene data into an illustration prompt is not a defect.
- Treat model-written reasons and fixes as semantic output, not as source references.
- Treat generated translation as new player-facing text unless the model explicitly selects keep-source for a source segment.
- Treat selected semantic names as references when the host can bind them to one supplied record.
- Treat ambiguous names as validation failures rather than silently selecting one.
- Existing quote-shaped fields may be reconstructed from references during migration.
- Retained quotes remain useful display and evidence fields; the model just stops authoring them.
- Preserve existing truncation notices and complete-evidence fallback where entrypoints already expose them.
- Preserve current player-facing language; reference migration must not rewrite delivered wording.
- Keep display aliases stable within one request but not as permanent public identifiers.
- Keep internal locators out of player-facing prose.
- Record enough trace detail to debug reference failures without leaking credentials or unrelated files.
- Do not ask models to prove they read a source by repeating it.
- Do not make reference success a substitute for semantic correctness.
- Inventory closure is part of acceptance: every current model request to copy existing data is migrated or explicitly dispositioned.
- Future Jev span-dependent consumers must reuse this accepted contract instead of defining a parallel locator scheme.
- No unrelated source format, package naming, campaign storage, or prompt architecture refactor belongs in this task.

Prototype rationale:

- The lean-graph prototype produced a source-name review disagreement: the final original review was rejected because the reviewer misread a cult name, the root disagreed with the reviewer on a page image, and the rejection remained unchanged and no override was applied.
- Record that disagreement as rationale for keeping independent page-image and semantic review separate from text location proof, and do not treat the failed gate as passed.

Implementation order:

1. Define the source snapshot, page/span/field locator, alias, and resolution contract in host terms.
2. Add resolver unit checks for text ranges, document-page spans, duplicate spans, stale revisions, structured field allowlists, foreign references, and security boundaries.
3. Migrate continuity audit source selections while preserving legacy output reconstruction.
4. Migrate correction reconciliation and story-frame/delivery-quote selections.
5. Migrate post-delivery verifier quote selection without changing advisory semantics.
6. Migrate document, map, setup, and journal keep/select cases.
7. Add document-page native-text selection and deterministic native numeric-token parsing where the field and units are unambiguous.
8. Audit remaining prompts and schemas for copy requests and record each disposition.
9. Update future contract text only after implementation is authorized; do not edit current kernel RPC docs during this specification-only turn.

Acceptance checklist:

- All active model-copy patterns for existing source excerpts, records, unchanged fields, and document-page text are removed or dispositioned.
- Models still generate genuinely new content where the product needs new prose or judgments.
- Host extraction produces exact retained strings for every migrated quote-shaped consumer.
- Document selections bind original document identity, physical page, and extraction revision.
- Normalization creates a derivative and source mapping rather than editing pinned text.
- Duplicate text is resolved by locator identity, not content search.
- Stale, bad, foreign, duplicate-ambiguous, or unsupported-field evidence fails explicitly.
- No model-authored character offsets, page handles, hashes, or opaque ids are accepted.
- No model-authored UUID, digest, receipt id, or machine key is required to prove attention.
- Native numeric tokens are parsed deterministically only when field, units, and source are unambiguous.
- Visual-only and semantically ambiguous new facts remain with tool-enabled source readers and independent source proof.
- Existing kernel authority over receipts, memory, worldline, scene state, and story chronology is unchanged.
- Historical retained artifacts remain read-only and readable.
- The task can be accepted independently of any Jev work.
- Any later Jev consumer that needs source spans or page selections reuses the accepted A contract rather than proving a duplicate locator shortcut.

## Testing Decisions

- Prefer existing high seams over new harnesses.
- Primary seam A: existing audit entrypoints prove exact source extraction without model copying or reference mixups.
- Primary seam B: existing correction-reconciliation entrypoints prove record selection without copied statement drift.
- Primary seam C: existing document and map presentation entrypoints prove keep-source preservation.
- Primary seam D: the document page/span selection path proves host binding of original document identity, physical page, and extraction revision.
- Shared resolver unit checks are allowed for UTF-16 ranges, document-page spans, duplicate text, stale binding, surrogate pairs, field allowlists, foreign references, and hostile paths.
- Tests should assert external behavior: accepted submissions, rejected invalid references, reconstructed display quotes, reconstructed page text, and retained semantics.
- Tests should not assert implementation-private data structures except the resolver's public contract.
- Document tests must prove that normalization yields a derivative and source mapping and does not mutate pinned native text.
- Numeric tests must prove deterministic parsing only for unambiguous field/units/source cases and rejection or reader escalation for ambiguous ones.
- Continuity tests must still prove per-line speech accountability and aggregate revise/pass consistency.
- Reentry tests must still prove basis, clue, relation, and source-authority rules.
- Memory tests must still prove worldline, chronology, correction links, and exact source-frame validation.
- Presentation tests must cover empty text, exact paragraph preservation, mixed-language fragments, and generated translation where required.
- Setup tests must cover pending-action selection from actual requests and preservation of player-approved fields.
- Verifier tests must prove warnings remain advisory and delivered player language is unchanged.
- Synthetic component tests may support implementation but cannot be labeled playtests.
- Future acceptance uses frozen held-out cases independent of incumbent reviewer judgments; incumbent output may be compared but is not the sole truth.
- End-to-end acceptance, when authorized, uses the existing Grok Keeper live driver with the main session as the sole natural-language player, never a fake Keeper loop or scripted-player acceptance.
- Genuine play acceptance execution is out of scope for this spec turn until the user authorizes implementation and play evidence collection.

Pass criteria:

- A migrated audit can submit semantic findings without model-authored copied quotes, and existing consumers receive exact reconstructed excerpts.
- A malformed, stale, duplicate-ambiguous, foreign, or out-of-scope reference is rejected with actionable validation detail.
- A document selection resolves to exact pinned page text for the stated document, physical page, and extraction revision.
- A correction reconciliation selects only supplied prior records and never retypes old statements.
- A keep-source presentation preserves exact source strings and does not translate or regenerate them unnecessarily.
- No test requires a new campaign database, runtime authority, or generic workflow engine.

## Out of Scope

- Implementing this specification in this turn.
- Running builds, tests, model probes, or true-table acceptance in this turn.
- Packaging, release work, committing, or staging changes.
- Adding any Jev dependency or typed-decision provider requirement to A.
- Replacing production kernel authority, receipts, world state, memory authority, or campaign storage semantics.
- Rewriting historical retained artifacts or broad historical saves.
- Replacing semantic language judgment with regexes or language tables.
- Replacing independent PDF page-image reviews or independent source proof with text-only selection.
- Reviving a retired OCR or Markdown production pipeline.
- Adding a global knowledge store, generic workflow engine, or new campaign database.

## Further Notes

- Companion architecture issue: [#101](https://github.com/Leehow/chatrpgv4/issues/101).

- The A issue already exists at [#100](https://github.com/Leehow/chatrpgv4/issues/100).
- Detailed source inventory and external-practice comparison are in [the research document](../research/jev-and-source-references-20260919.md).
- The Jev-assisted preparation redesign is a separate specification with separate acceptance: [Jev-driven tool tasks and memory lifecycle](jev-batched-decisions-and-retrieval.md).
- The local B companion link will be resolved during issue publication.
- A stands alone, while B span-dependent consumers are expected to reuse A after its contract is accepted; B must not introduce a duplicate locator scheme.
- B may consume the accepted shared resolver and document-reference slice before every A workflow migration is complete; completing all A migrations is not a prerequisite for document discovery. A retains its independent inventory-closure acceptance.
- The document-page native-text snapshot and page/span/field selection contract is shared with B; B does not define its own page locator.
- The prototype source-name review disagreement is retained as rationale for separating text location proof from visual and semantic review proof.
- Future implementation may amend current kernel contracts after authorization; this specification turn intentionally leaves existing contracts untouched.
- Publication records the specification; implementation and product acceptance remain separate subsequent work.
- Substantive unresolved design choice: the exact model-visible alias and ordinal format should be chosen during implementation, but it must remain semantic and host-created.
