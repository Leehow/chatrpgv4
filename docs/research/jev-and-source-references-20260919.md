# Jev and source references research — 2026-09-19

## Historical snapshot notice

The inventory sections below describe the codebase as read on 2026-09-19 and are retained as a historical snapshot.
They are not the current architecture statement and they do not authorize implementation.
The superseded unverified Choice cardinality and the old narrow reranker/reviewer rollout conclusions have been marked or removed in place.
The current architecture and evidence summary is appended at the end of this document.

## Status and source snapshot

- Status: research only; no implementation and no acceptance claim.
- Baseline supplied by parent: `83ee3d9ca5f6ad1d898f15a4ea09a9171b463997`.
- Actual read snapshot: `83ee3d9ca5f6ad1d898f15a4ea09a9171b463997`.
- The checkout is shared and dirty; the read snapshot is not frozen.
- Observed dirty files include continuity audit, NPC voice, read context, prompts, tests, and docs.
- This document records current TypeScript-kernel production behavior only.
- The document author performed no new campaign evidence mutation, credential access, model probe, build, or test while drafting this research.
- Parent context included inspected retained telemetry and earlier diagnostic Jev API calls; those raw probe outputs are conversation-retained, not checked-in files.
- No Python kernel, extra worktree, old branch, or network research was used by this document author.

## User decisions to preserve

1. A and B have separate acceptance, but separate acceptance does not mean zero dependency.
2. A stands alone: source-reference refactor cannot require Jev.
3. B research, adapter work, and consumers using existing host-owned fixed candidate packets can proceed independently; B span-dependent consumers reuse A after its contract is accepted.
4. Do not create a parallel locator scheme as a shortcut around A.
5. A changes every current model-copy pattern for existing source excerpts, records, or unchanged fields.
6. In A, the model selects or decides; host extraction supplies exact text and identifiers.
7. The model must not compute character offsets, retype UUIDs, retype digests, retype receipt ids, or duplicate text to prove attention.
8. Host copying strings is not a defect when the host already owns the source and transfer.
9. Generative fields remain generative: new descriptions, summaries, statements, reasons, and repair prose stay model-authored.
10. B redesigns workflows around many independent typed decisions, not a faster single judge.
11. B must broaden recall, classify multiple dimensions, preserve counterevidence, decompose checks, and keep final Keeper context bounded.
12. B must not put Jev before an unchanged full reviewer that repeats every check unconditionally.
13. Current kernel authority and semantic constraints remain authoritative.
14. Main session plus existing Grok Keeper play driver remains the only future genuine play acceptance path.
15. Synthetic probes are component evidence, not playtests and not first-visible UI proof.
16. No new runtime authority, campaign database, campaign-truth store, global knowledge store, or generic workflow framework.
17. No plaintext API key or secret persistence in repository files.

## Observed source inventory for A (historical snapshot)

> Historical snapshot only. Kept for traceability; see the current architecture and evidence section at the end.

| Current area | Source locations | Current copy pattern | Disposition |
| --- | --- | --- | --- |
| Continuity audit spoken lines | `kernel-ts/mods/audit-result.ts:21`, `:90`, `:159-177`; `extensions/mods/index.ts:252` | Reviewer returns each say span quote in order. | Host should derive line locators and exact text; model returns per-line decisions and reasons. |
| Continuity audit conflict claim | `kernel-ts/mods/audit-result.ts:109-128` | Reviewer copies candidate claim and evidence file quote. | Model selects candidate span and evidence source locator; host extracts quote and reconstructs legacy display fields. |
| Intelligibility review | `kernel-ts/mods/audit-result.ts:129-142`; audit brief in `extensions/mods/index.ts:252` | Reviewer copies malformed candidate excerpt. | Host supplies candidate segment references; model identifies offending segment and semantics. |
| Player-address review | `kernel-ts/mods/audit-result.ts:143-157` | Reviewer copies narrator-side third-person reference. | Same as candidate span selection; preserve second-person rewrite finding. |
| Outcome review | `kernel-ts/mods/audit-result.ts:180-199` | Reviewer copies unsupported positive-result claims. | Host-extracted claim spans selected from candidate. |
| Location and locus reviews | `kernel-ts/mods/audit-result.ts:201-238` | Current scene copied; asserted elsewhere/locus claim copied. | Current scene is record selection; candidate claims use span locators. |
| Reentry review | `kernel-ts/mods/audit-result.ts:240-331` | Reviewer copies candidate/current-input quote, clue, relation. | Basis and row selection stay semantic; host copies bridge clue, relation, known row, and selected candidate/current-input span. |
| Focused audit evidence | `extensions/mods/audit-evidence.ts:1-49`; `extensions/mods/audit-submit.ts:51-83` | Tool returns named pinned views and asks model to cite exact strings. | Reuse as source snapshot inputs; add structured locators rather than broad JSON string search. |
| Final audit freshness | `extensions/mods/index.ts:228-268`, `:662-668`; contract `docs/kernel-rpc.md §36.14` | Job evidence is retained and final acceptance checks freshness. | Locator binding must use same retained job evidence and stale-job refusal. |
| Post-delivery verifier | `extensions/kernel/verifier.ts:40-95`, `:134-176`; `kernel-ts/memory/index.ts:49-68` | Advisory lane returns exact delivered-prose quote. | Replace model-authored quote with selected delivered-text span; do not make advisory verifier blocking. |
| Memory extraction | `extensions/memory/index.ts:110-145`, `:181-234` | Most fields are new memory statements; story frame and delivery quote are copied. | Keep new statements generative; story frame/delivery_quote become source-span references resolved at submit. |
| Correction reconciliation | `kernel-ts/memory/jobs.ts:169-190`, `:308-318`; `extensions/memory/index.ts:129-135` | Model copies existing correction and prior subject/statement pairs. | Model selects supplied correction and target rows; host reconstructs unchanged correction and references. |
| Memory story validation | `kernel-ts/memory/jobs.ts:145-166` | Kernel verifies frame in player_text and delivery_quote in keeper_text. | Move exact extraction behind host references while preserving chronology and acquired-evidence rules. |
| NPC journal | `extensions/npc-journal/index.ts:95-151` | Model copies recordable name, generates description/exchange/label. | Name becomes host record selection; generated text remains generated. |
| Document presentation | `extensions/mods/document-presentation.md:1-16` | Presenter copies already-in-language text unchanged. | Use keep-source/generate/patch decisions; host preserves exact source paragraphs and empty strings. |
| Map presentation | `extensions/module/map-presentation.md:1-19` | Presenter answers by source string key and copies already-in-language labels. | Host owns source keys; model decides keep/translate/patch per label. |
| Setup | `prompts/setup.md:68`, `:146`, `:198-204`; `kernel-ts/setup/drafts.ts:462-465` | Name, unrelated appearance, and pending action may be copied. | Distinguish keep-source and patch from truly new profile fields; pending action selected from actual requests. |

## Observed source inventory for B (historical snapshot)

> Historical snapshot only. Kept for traceability; see the current architecture and evidence section at the end.

| Current area | Source locations | Current behavior | B opportunity |
| --- | --- | --- | --- |
| Admission | `extensions/kernel/admission.ts:1-339`; `extensions/kernel/index.ts` imports | One proposal reviewed by generative lane with closed five verdicts. | Batch independent effect questions while retaining whole-batch refusal and exact player-public context. |
| Action admission authority | `extensions/kernel/admission.ts:1-18`, `:221-339` | Runs before triggering action reaches mods or kernel; unavailable refuses. | Jev adapter must preserve fail-closed admission and never see Keeper-private facts. |
| NPC voice reviewer | `extensions/npc-voice/index.ts:107-134`, `:288-310` | Short semantic reviewer returns `honours` and `why`; writer remains separate. | Split into source-faithful, secrecy, answer-directness, range, language/listener checks. |
| Workspace retrieval | `kernel-ts/read/workspace-candidates.ts:1-116` | Exact names, current scene, present, lexical bigrams, graph expansion, fallback bounded by limit. | Widen first-stage recall with existing names, aliases, graph relationships, and retained topics before rerank; Jev cannot recover dropped candidates or invent search wording. |
| Workspace projection | `extensions/table/workspace/projection.ts:61-214` | Candidate limit 128, packed 24, authority/scope filtering, omission counts. | Add calibrated multi-dimension classification after permission filtering and before bounded packing. |
| Reranker | `extensions/table/workspace/reranker.ts:1-126` | Optional remote rerank, max 48, min 2, 500 ms deadline, 48 KiB input, deterministic fallback; existing workspace shadow mode prohibits remote rerank. | Jev replacement must be optional, deadline-bound, cached, no-retry for optional workspace, and honest about omissions; evaluation must use authorized offline/retained-input probes or a distinct opted-in measurement mode. |
| Context runtime | `extensions/table/context-runtime.ts:156-282` | Public lookup/recall unaffected; workspace is optional package-owned context. | Initial rollout should target optional workspace consumers before wider public retrieval. |
| Continuity audit | `kernel-ts/mods/audit-result.ts`; `extensions/mods/index.ts` | Tool-enabled full reviewer validates exact quotes and semantic findings. | Decompose bounded checks only where exact-span coverage can be proven. |
| Post-delivery verifier | `extensions/kernel/verifier.ts`; `kernel-ts/memory/index.ts` | Advisory six-kind review after delivery. | Good later target for many typed independent checks with source-span host resolution. |
| Memory correction targets | `kernel-ts/memory/jobs.ts:115-190` | Candidate shortlist at most 30; model selects explicit withdrawal links. | Classify correction-target relation across more candidates with chronology/worldline preserved. |
| PDF source review | `extensions/module/reader-review.ts:1-130`, `:267-299`, `:353-359` | Independent reviewers inspect original page images and check coverage. | Jev is text-only and cannot replace image/PDF reviews or revived OCR. |

## Current behavior notes

- Continuity audit already separates semantic review from final kernel acceptance.
- The current audit validator catches many copy mistakes but still asks the reviewer to author copied text.
- The focused audit evidence tool already offers semantic-name views and explicit truncation notices.
- Audit shape repair is distinct from semantic rewriting and should remain distinct.
- Per-line speech review is an accountability mechanism, not merely a copied quote list.
- Memory extraction intentionally creates new statements and should not be treated as a copy problem.
- Memory correction reconciliation is different: it links supplied existing rows and should become selection.
- NPC journal entries mix selection and generation; only the selected person name is a copy-class field.
- Document and map presentation need source preservation for player-facing clue text.
- Presentation cannot decide language with script classes because the product supports open languages.
- Setup name and pending-action preservation are valid source selections.
- Setup appearance preservation on unrelated edits is a keep-source/patch case.
- Admission is already a public-context gate before kernel action settlement.
- Admission review unavailability is already fail-closed for the affected action.
- Workspace reranking is already optional and cannot block a request.
- Existing workspace shadow behavior prohibits remote rerank and must not be silently reinterpreted for evaluation.
- Workspace projection already has authority, scope, coverage, and budget filters.
- Workspace retrieval currently has upstream limits that any reranker inherits.
- Existing names, aliases, graph relationships, and retained indexed topics can broaden recall; Jev can choose among those candidates but cannot generate new search wording.
- If new paraphrases are needed, they belong to an existing generative owner/output opportunity with measured cost, while the raw player query remains retained.
- The post-delivery verifier is deliberately advisory after delivery.
- PDF reader review consumes original page images and validates page coverage.
- None of these observations authorize implementation in this turn.
- Current docs show continuity audit is implemented, but this research does not edit those contracts.
- Current acceptance docs show no unrelated latency improvement; this research does not reinterpret that outcome.
- Parent-supplied probe data is conversation-retained and should be cited with that limitation; no raw probe artifacts are checked into this repository.
- Future implementation must re-read current source because concurrent workers may change it.

## Writer, reader, actor table

| Interface | Writer | Reader | Actor who decides | Notes |
| --- | --- | --- | --- | --- |
| A source snapshot | Existing host/job preparer | Resolver and validators | Host binds campaign, worldline, loop, owner, and revision | Must outlive queued jobs and restart through existing immutable packets/history. |
| A source locator | Host creates aliases/ordinals | Model sees alias; host resolves internal locator | Model selects; host extracts | No model-authored offsets, raw pointers, or opaque ids. |
| A text range | Host derives segment/range | Existing consumers read reconstructed quote | Model selects segment/relation | Use raw UTF-16 half-open internal units and reject surrogate splits. |
| A structured record field | Host exposes allowlisted field choices | Kernel validators and display code | Model selects record/field | JSON Pointer is prior art only for host-issued allowlisted fields; no arbitrary filesystem paths or JSON search. |
| A legacy quote field | Host reconstructs | Existing validators, warnings, displays | Host writes from resolved reference | Keeps historical consumer shape during migration. |
| B decision batch | Domain caller plans questions | Adapter sends one Jev request or bounded concurrent groups | Jev answers typed decisions | Policy stays at callsite. |
| B result coverage | Adapter records answered, unknown, unavailable | Domain consumer | Host applies owner policy | Unknown is real, not pass. |
| B retrieval shortlist | Existing retrieval plus widened channels | Classifier/ranker and Keeper context | Host filters permissions first | Corpus truth remains host/kernel fact. |
| B final context | Workspace selector / domain caller | Keeper | Host packs bounded evidence | Do not claim full corpus checked when truncated. |

## Trust and privacy boundaries

- Public player words remain the authority for admission; expanded retrieval query is not consent.
- Keeper-private facts must never enter action admission.
- Same-state Jev batches may share context only within one audience and trust stage.
- Workspace evidence stays advisory and never displaces current capsule or player text.
- Corpus truth, provenance, permissions, worldline, loop, receipts, and arithmetic remain host/kernel facts.
- PDF source reviews remain independent image/page reviews; Jev text classification is not independent source proof.
- Jev adversarial weakness means it is not a security boundary or prompt-injection firewall.

## External practice comparisons

- <https://docs.typesafe.ai/primitives>: Jev exposes typed forms and independent questions over one state; this supports batched classification, but question keys are not inferred instructions, so each question must name the span or record explicitly.  Its "Ask speculative questions" text now says question count is limited only by total token budget and loosely describes that budget as around 32k.
- <https://docs.typesafe.ai/patterns/fan-out>: speculative branch questions and host conditional routing match the proposed branch planning, with host selecting applicable answers.
- <https://docs.typesafe.ai/concepts/state>: all questions share state; Jev is text-only, English-strongest, and accepts CJK with lower accuracy, so CJK requires held-out validation.
- <https://docs.typesafe.ai/models>: primary comparison, checked 2026-09-19; `jev-1.13.0`, input price $0.042/M, output free, 64k state plus all questions, 32k state plus longest question, dynamic 250k tokens/sec and 1200 requests/min ceilings. This conflicts with the looser primitives page wording; it is not evidence that 64k is unsupported, but the implementation should use a conservative 32k total packing ceiling with token headroom until the intended endpoint and model profile are verified, while preserving the 32k state-plus-longest-question rule.  English character approximations are not CJK token guarantees.
- <https://docs.typesafe.ai/cookbooks/semantic_find>: primary comparison for typed choices; Choice supports up to 255 options, which supersedes the earlier unverified Choice cardinality note in this document. Split choices rather than one larger one-hot.
- <https://docs.typesafe.ai/patterns/fan-out>: primary comparison for independent speculative variants and host answer routing; it supports typed parallel choices plus independent existence questions, and the host still decides which branch applies.
- <https://docs.typesafe.ai/model-jaggedness/jev-1.13>: literalness, numeric/date precision, indirection, irrelevant context, adversarial state, and generation limits argue for host arithmetic and source binding.
- <https://docs.typesafe.ai/confidence>: confidence is probability-concentration derived and is not the probability that a result is correct; thresholds must be domain-evaluated.  Noul has no separate confidence field, and independent questions do not imply statistically independent errors.
- <https://docs.typesafe.ai/api>: `/v1/systemone` is distinct from Pi ChatCompletion; use native host fetch initially and do not assume normal lane-model plumbing, implicit SDK retries, unverified numeric question-count caps, or unverified Choice cardinality.
- <https://docs.typesafe.ai/cookbooks/parallel_questions>: vendor example shows shared-state batching benefits in one GDPR case; this is evidence for the shared-state mechanism only, not a project benchmark or a speedup multiplier.
- <https://docs.typesafe.ai/cookbooks/classifying_rag_passages>: relevant/evidence/contradiction/injection per passage matches B, but example retrieval does not prove this project's recall or permissions.
- <https://docs.typesafe.ai/cookbooks/rerank_typesafe>: rerank scores candidates after first-stage retrieval and cannot recover missing upstream items.
- <https://openrouter.ai/labs/jev/compile>: confirms generate-questions/evaluate split; this project should version fixed question families rather than add an LLM compiler every turn.
- <https://www.w3.org/TR/annotation-model/#text-position-selector>: primary comparison for explicit locator semantics; half-open text positions are useful prior art, but W3C assumes a normalized Unicode code-point model while this project deliberately binds immutable raw UTF-16 internal strings. State UTF-16 internal units and do not claim W3C conformance.
- <https://www.rfc-editor.org/rfc/rfc6901>: primary comparison for structured locator semantics; JSON Pointer is suitable prior art for structured values only when host-issued, allowlisted, and pinned to immutable source snapshots. It differs from our UTF-16 host alias contract, which keeps model-visible aliases and internal locators separate.

## Conversation-retained measured evidence

- First parent probe: 10 artificial Chinese admission cases with current English admission instructions.
- First probe result: `jev-1.13.0` returned HTTP 200 for all 10; all labels matched author expectations.
- First probe latency: 313-858 ms, median 351 ms; one correct continuation verdict confidence 0.41.
- First probe limitation: hand-authored diagnostics, not a live table and not an accuracy estimate.
- Second parent probe: fixed 16 artificial dialogue examples, 8 Chinese and 8 English.
- Second probe dimensions: intelligibility, response relevance, hidden-name disclosure, preserves choice.
- Second probe request count: one warmup, then 3 repeats each for 1/8/32/64 questions, then 1/4/8 concurrent waves of 32 questions.
- Second probe total: 26 requests, 79,092 input tokens, all HTTP 200.
- Second probe uniqueness: only 64 unique judgments; repeated fixture, not 732 independent cases.
- Latency by questions: 1 question [686,373,338] ms, median 373, input 1294 tokens.
- Latency by questions: 8 questions [428,326,399] ms, median 399, input 1740 tokens.
- Latency by questions: 32 questions [405,367,410] ms, median 405, input 3284 tokens.
- Latency by questions: 64 questions [817,816,793] ms, median 816, input 5384 tokens.
- Concurrency waves: 1x32 = 418 ms; 4x32 = 722 ms; 8x32 = 706 ms.
- Some response-relevance Noul values were 0.69-0.79 despite matching a diagnostic 0.5 threshold; Noul does not expose a separate confidence field.
- The 0.5 comparison was diagnostic only, not a deployment threshold.
- Caching, sustained max concurrency, p95, whole-turn latency, renderer latency, service errors, Choice cardinality, and production question-count limits remain unmeasured.
- Probe outputs are retained in conversation, not checked-in raw artifacts.
- Cost at published rate is an estimate, not a billed receipt.
- Parent-read retained campaign telemetry: `latency-trial-before-20260919` admission 7696/11451/9551 ms; continuity-review median 9043 ms, max 70791 ms, n=4.
- `docs/acceptance/keeper-latency-trial-20260919.md` rejects an earlier unrelated latency optimization and reports baseline warm-turn mean 68.0 sec vs 108.0 sec after; do not attribute improvement to Jev or A.

## Design alternatives and rejection reasons

1. Ask models to return exact quotes as today; rejected because copying is a fragile attention proof and causes reference mixups.
2. Ask models to return numeric offsets; rejected because offset calculation is not the model's job and is brittle under truncation.
3. Fuzzy re-anchor stale quotes; rejected because it can bind adverse findings to the wrong duplicate or revised source.
4. Replace names with opaque ids everywhere; rejected because semantic names are an existing valid selection interface.
5. Use CJK regex or hard-coded language tables for presentation; rejected because language/meaning decisions stay semantic.
6. Rewrite historical artifacts; rejected because retained artifacts remain read-only evidence.
7. Make verifier warnings blocking while refactoring quotes; rejected because verifier is post-delivery advisory.
8. Install Jev as a global lane model; rejected because existing lanes are generative Pi completions and Jev is a typed decision endpoint.
9. Add a generic workflow engine; rejected because domain callsites must own policy and question planning.
10. Use Jev to summarize or replace PDF page review; rejected because Jev is text-only and not independent page-image evidence.
11. Use current reviewer as sole truth for thresholds; rejected because it would tune to incumbent errors.
12. Increase rerank deadline silently; rejected because the current 500 ms budget is user-visible behavior.
13. Add a duplicate Jev-specific locator scheme; rejected because span-dependent B consumers must reuse A's accepted source-reference contract.
14. Let Jev generate query expansion text; rejected because Jev should select among existing candidates, while new paraphrases belong to an existing generative owner/output opportunity with measured cost.
15. Add keyword or regex semantic classifiers; rejected because semantic decisions stay model/domain decisions, not language-table shortcuts.
16. Let Jev summarize final Keeper context; rejected because final context should contain minimal selected original source material and counterevidence with attribution.

## Future validation matrix (historical narrow plan)

> Historical snapshot of the earlier narrow reranker/reviewer plan. The current slice plan and speed acceptance criteria are in the current architecture section at the end. Admission decomposition and complex-continuity decomposition are now later individually accepted families, not the primary rollout.

| Slice | Evidence seam | Pass criteria summary |
| --- | --- | --- |
| A1 resolver unit checks | Shared resolver tests | UTF-16 ranges, duplicates, stale revision, field allowlist, no surrogate split. |
| A2 audit migration | Existing audit submit/acceptance entrypoints | Exact excerpts reconstructed without model-authored copying and same semantic revise/pass behavior. |
| A3 correction reconciliation | Existing memory job submit seam | Correction and target rows selected without copied statement drift; chronology/worldline retained. |
| A4 presentation | Existing document/map presentation checkers | Keep-source preserves exact text, empties, paragraphs, mixed-language fragments, player edits. |
| B1 adapter unit checks | Host batch-decision seam | Encoding, coverage, cancellation, cache, unknown, budget, rate limit, and tracing work without provider secrets. |
| B2 same-candidate checks | Speech/voice/correction consumers | Typed decisions replace monolithic checks without losing semantic repair reasons, current per-line accountability, or attention coverage. |
| B3 wider retrieval | Optional workspace consumer | First slice recovers a labeled baseline omission while retaining permission filters, required evidence, attribution, omission metadata, scope, and bounded Keeper context. |
| B4 admission decomposition | Admission-specific seam | Whole-batch refusal, current-turn reuse/cancel, no Keeper-private leakage, unavailable fail-closed, and zero additional known critical unauthorized-action or disclosure errors. |
| B5 genuine play | Existing Grok Keeper live driver through the main session | One natural input at a time; evidence retained; no fake Keeper or scripted-player loop. |

## Remaining operational unknowns

- Exact native host fetch implementation details for `/v1/systemone` bearer authentication, cancellation, and timeout controls.
- Exact foreground latency budget for each consumer after measuring user-visible benefit.
- Maximum safe question count for this project client; provider docs do not independently verify production constants. The Choice cardinality cap is now documented as up to 255 options by `semantic_find`, superseding the earlier unverified note.
- How much wider candidate recall improves real defects before overwhelming context.
- CJK and mixed-language behavior on held-out retained real cases.
- Tail latency and service-error behavior under concurrent foreground and background tasks.
- Thresholds for each decision family after development tuning and held-out evaluation.
- Operator secret-vault naming and runtime exposure details for a future implementation; exact setting-field spelling is not an architecture blocker.
- Whether alternate-reviewer routes are needed only for scoped insufficient evidence, and for which consumers.
- How to report cost accurately once real invoices or provider receipts are available.

## Current architecture and evidence (appended)

This section supersedes the earlier narrow reranker/reviewer rollout framing. It records the selected design, current provider facts, and prototype evidence as design input only; nothing here is an implementation or acceptance claim.

### Selected architecture

- Host retains the original source PDF identity and page images, and builds a rebuildable page text, span, and navigation cache using native PDF text first. The kernel never parses PDFs. This is an explicit PROPOSED contract change from the current visual-reader policy; it does not assert that a retired OCR or Markdown production path is restored.
- The first slice uses native text plus the existing visual reader on demand, with no new OCR vendor. Sparse, scanned, and image pages remain explicit unknown coverage and use existing original-page and contact-sheet navigation.
- Whole-document text indexing can run without forcing full-document semantic deep-reading or blocking a supported opening.
- Jev supplies parallel typed decisions. Multi-label page roles (scene, NPC, monster, statistics, plot/causal, clue, handout/map, additional rules, navigation/other/unknown) are routing hints, not hard exclusion filters and not evidence of complete coverage.
- Before any current-scene graph filter, retrieval searches the whole available document universe in bounded partitions. Exact-name and alias lexical retrieval plus graph links supplement recall rather than preventing semantic discovery of a late-book location with another label.
- Choice ranking alone always produces a winner, so the host independently tests atomic support and existence and allows none, unknown, or partial. There is no universal relevance acceptance gate.
- The host reuses the existing lookup source answer/prepare queue, scoped lease/claim/finish, cancellation, generation, retained evidence, accepted-answer cache, and seven verbs. An answer-only consultation cannot create nodes, readiness, acquired clues, state changes, source publication, or receipts.
- The ModuleGraph stays small and incremental: root plus selected opening and only needed actors, places, relationships, and conditions. No mandatory full story graph, no node-per-sentence. Stable identities, aliases, provenance, secrecy, relevant causal dependencies, and required executable profiles stay in the graph; long exact source prose uses A source references. Existing published graphs and saves are not deleted. Index discovery works without an existing node.
- A fresh opening explicitly amends the current skeleton contract as a proposed change: fresh imports replace the module-wide structural-preparation prerequisite with a compatible minimal root and source-backed opening candidates, empty skeleton `ready_nodes`, and the chosen start scene ready only after accepted scoped detail. Existing campaigns continue via existing graph/effective-view code.
- Scope refinement is demand-driven: clinic hours yields a sourced answer, ordinary willing conversation yields existing minimal person/place private narrative material, and an actual rule operation yields only necessary typed parameters and conditions. The same NPC refines in place with additive conflict guards. UNKNOWN is not zero, not a template default stat, and not ready. Mechanics readiness is operation-specific at resolve/apply and actual readers.
- Relevant global rules, plot constraints, offstage triggers, and cross-page dependencies for the current decision must be searched/read even if elsewhere. Unresolved necessary dependencies block that operation; unrelated unread chapters do not. The Keeper interprets causal/novel content; there is no automatic plot advancement or reveal from relevance and no preemptive full future plot extraction.
- Rules use the current scene, exact player words, and public authorized facts to derive eligible RuleGraph decision families, then fan out rule/skill/check-needed/host-known-slot decisions independently. Deterministic eligibility filters only; missing facts are not false presence flags. The RuleGraph compiler and kernel bind numeric/source/runtime values and validate full preconditions, resource constraints, consent, cancellation, and receipts. Jev does not roll, authorize, fabricate consequences, or fill unknown stateful subsystem slots. Ordinary-check bindings first; unsupported combat/chase/magic stay on existing handling until their bindings pass. No-rule and uncertain are legitimate. Private module retrieval stays separate from public admission state.
- The adapter uses native host fetch to the official `POST https://api.typesafe.ai/v1/systemone` endpoint and pins `jev-1.13.0`. Choice/Score/Noul with shared state and independent questions; question keys are not inference input so instructions name targets. No same-batch answer dependency; independent speculative variants are allowed and the host routes answers. Bounded foreground-first concurrency, a common absolute caller deadline and cancellation, answer coverage validation bound to model/family/source-or-candidate revision/campaign/audience. Credentials use the existing host vault and never reach the renderer, logs, or repository. Optional capability; absent/unavailable reuses the declared incumbent or existing unavailable result; admission never fails open. No blanket second complete agent review after an accepted migrated typed decision; new visual/ambiguous evidence still uses the source reader/reviewer.
- The optional workspace 500 ms deadline stays separate from document discovery taking seconds. No default unlimited retries. Unknown, incomplete, refusal, and transport failures stay distinct. Rate limits and configurable concurrency are not guarantees.

### Provider facts checked now

- [Models page](https://docs.typesafe.ai/models): 64k total state plus all questions; 32k state plus longest question; text-only; $0.042/M input; output free; dynamic 250k tokens/s and 1200 requests/min.
- [`semantic_find`](https://docs.typesafe.ai/cookbooks/semantic_find): Choice supports up to 255 options, superseding the earlier unverified statement. Split choices rather than one larger one-hot.
- Use a conservative 32k total packing ceiling with headroom until endpoint limits are verified.
- Confidence is not correctness. Do not blindly copy the cookbook claim that arbitrary extra questions add no latency.

### Prototype evidence (design input only)

- Rule routing prototype: 13/13 routing, 7/7 skills, 4/4 top-five reference cases; 7 plan shapes compiled, 6 ordinary fully bound, first-aid subsystem binding missing; median 1146 ms, range 673-6845 ms, 26 requests, 612079 input, not execution. V1 first-aid failed the adapter with dense false flags and corrected production facts. Branch `codex/jev-rule-routing-prototype-20260919`, commit `c9e69f41eeed37d9fccefab2f06adb7888babc02`.
- PDF prototype: original 111 pages, 100 substantive text, extraction 851 ms; 700 role questions 4388 ms; 7 queries joint 3342 ms and not single query; single-query follow-up 3188 ms and 19 requests; 5 positive cases top-five yes including 2 clinic paraphrases; 0.7 gate 2/5 all targets only; atomic 405/465 ms; native word clinic absent found p32, stats p97, procedure p84, dehydration p93, fatigue p90; map p19 missing native unknown; not whole-PDF absence for MRI; 432805 plus 158744 input, estimate $0.0248 at published rate excluding observer; host directly extracted the hours span. Branch `codex/jev-pdf-routing-prototype-20260919`, commit `372a6754d62df0138b79e05b355787f8c35467b6`.
- Lean-graph prototype: four candidates read by tool Pi, final Jev 816 ms and 4686 input for type/scope/demand cases matching; 3 nodes including root and 1 relation before and after; same-NPC 3 aliases, FirstAid 55, Medicine 35, HP 11 in a fresh process; HP999 needed choice; final original review REJECTED because the reviewer misread a cult name, root disagreed on the page image, automatic rejection retained without override; no arithmetic probe, no canonical publication, no live play; reader/reviewer timeouts and source omissions retained. Branch `codex/jev-lean-graph-prototype-20260919`, commit `6edf276f43d20a2fb570a7a9093e4c6bcf0c0d8d`.
- Do not call the lean prototype full accepted graph generation, graphless play, total prep speedup, or no-LLM extraction.
- Whole-turn measurement is an implementation acceptance item, not a precondition to authoring the spec. Each migrated bounded decision family must remove its old unconditional generative work and reduce that measured foreground slice at non-regressed critical correctness; whole-turn gain is claimed only when measured.

### Shared locator contract

- A and B share one host-issued page/span/field selection contract. A stands alone; B does not define a second source store or page locator. B span-dependent consumers reuse A after its contract is accepted.

### Trace inventory paths (verified current code, 2026-09-19 read)

The specification keeps these paths out of its Implementation Decisions and records them here for traceability. They were verified against the read snapshot; concurrent workers may change them.

- Seven public tools: `extensions/kernel/tools.ts` — look439, lookup456, recall486, resolve591, apply603, ask618, narrate640.
- Main host pipeline: `extensions/kernel/index.ts` around 2583 (source ensure), 2604 (admission), 2607 (mods.prepare), 2636 (material_pending recovery).
- Current kernel read handlers: `kernel-ts/read/handlers.ts` 350 (look), 412 (lookup); 459+ (secret scope projection).
- Source lookup: `kernel-ts/read/handlers.ts`; native sourceSearch `extensions/module/source.ts:157` (literal indexOf over capped page batches); ReadingService `extensions/module/reading-service.ts` 332 ensure, 536 runJob, 640 verify; reader-review `extensions/module/reader-review.ts` 205/216 reviewCandidate answer and graph units.
- Module lookup: current graph.search name/alias, hard result 8; module-only task stays inside graph/index authority.
- Rule and catalog: `kernel-ts/rules/queries.ts:11` lexical token matching over rule names/families plus createRuleQueries `catalog.search`.
- Continuity: `kernel-ts/read/continuity.ts` continuityView traverses graph and receipt-backed acquired evidence.
- Adaptation: `extensions/kernel/adaptation.ts` tool-enabled create then review tasks, 30 s per task, 6 requests, 12 s foreground wait.
- Recall: `kernel-ts/memory/index.ts:151`, `kernel-ts/memory/recall.ts:164`, `kernel-ts/memory/pages.ts` bound 12 KiB, 20 rows, 4096 Unicode code points; about/kinds/turns, correction lineage.
- Resolve: `kernel-ts/resolve/pipeline.ts` derives decisions, skill candidates, session restrictions, slots.
- Apply: admission is `extensions/kernel/index.ts` around 2604 before the `mods.prepare` call at 2607; definition/usage authoring is `extensions/mods/index.ts:603`.
- Narrate: `extensions/mods/index.ts:235` continuity reviewer plus 603 delivery prepare.
- Admission: `extensions/kernel/admission.ts` semantic allow/refuse/ground choices.
- Post-delivery verifier: `extensions/kernel/verifier.ts` six finding kinds, advisory.
- Memory: `extensions/memory/index.ts` 127-135 correction target matching and fact kind/subject/attribution; new condensed statement generation remains generation unless an explicit extractive source-ref mode is accepted.
- NPC voice: `extensions/npc-voice/index.ts` and `extensions/npc-voice/writer.ts`; new dialogue generation remains, source fit, listener, repetition, and relevance can be Jev.
- Context workspace: `extensions/table/context-runtime.ts`, `extensions/table/workspace/reranker.ts`; existing 500 ms deadline and no-remote shadow mode preserved.
- Current kernel capabilities: answer and prepare both still read and review; no new acceptance claims.

### Internal-work replacement inventory

This inventory extends the seven-tool facade in the main specification; it records replaceable internal decision work, not a new public schema or an acceptance claim.

| Work | Replacement decision |
| --- | --- |
| admission (public current intent/batch) | Typed verdict/ground selections after independent family acceptance; fail-closed owner. |
| postdelivery verifier | Six typed defect families plus host source excerpts; advisory only. |
| memory write/organize and read/use | Full lifecycle over selectable immutable source spans and older-record packets: retain/skip/defer, relation classification (duplicate, new, reinforcement, contradiction, explicit correction, temporal change, unrelated, unknown), typed annotations and links, host validation and commit through existing memory job/submit, incremental rebuildable indexes, and bounded authorized retrieval with original spans and counterevidence. Generative novel text is only a scoped fallback. |
| NPC voice | Source-fit/listener/repetition/relevance checks replaceable; fresh dialogue generator retained. |
| document/map/character/UI | Keep-source vs translate/patch classification; exact text host copied; novel translations/descriptions generated; no language regex. |
| Mods define/usage | Existing-profile/object selection and compatibility replaceable; novel definitions generated; atomicity retained. |
| workspace | Classification/ranking optional 500 ms/no-remote current shadow semantics; no global proof new latency. |
| PDF import/preparation/graph construction | Uses lookup-task loop and existing publication; no independent all-book agent. |

### Current tool-loop design summary and primary comparisons

Goal, decision, action, real observation, adaptive continue: one tool call owns a bounded goal, Jev semantically chooses the next closed operation over host-issued candidates, the host executes it, appends the real observation, and continues with a new request. Inner independent questions batch together, while dependent answers always wait for the next request. Only the host executes reads, graph traversal, source publication, and commits. Stops are explicit: completion, partial, unresolved, needs_player, pending, failed, cancelled, or no-progress. Commit and mutation happen exactly once through existing idempotency; the full loop remains untested and is an implementation acceptance item.

Primary comparisons. TypeSafe [function calling](https://docs.typesafe.ai/cookbooks/function_calling) supports closed function and argument semantic choice, not a builtin autonomous agent, and not arbitrary free text or numeric generation; here a required missing numeric field stays unknown and never inherits a default. TypeSafe [fan-out](https://docs.typesafe.ai/patterns/fan-out) supports independent simultaneous questions, not same-batch dependent answers. TypeSafe [`semantic_find`](https://docs.typesafe.ai/cookbooks/semantic_find) combines ranking with support. Anthropic [building effective agents](https://www.anthropic.com/engineering/building-effective-agents) supports environment-feedback loops and stop conditions; our limited Jev/host loop is a proposed combination, not a claim that Jev has all generative agent capabilities.

### Additional tool inventory and source pointers

The source registration audit additionally covers one onboarding tool and five private helper tools beyond the seven play tools. The audit covers the seven play tools, setup, their internal semantic jobs, and these helper tools; general coding-agent filesystem and shell tools are execution primitives, outside this product redesign.

Source pointers, verified from source by the main session: setup `extensions/onboarding/index.ts:652`; private pdf `extensions/module/reader-pdf.ts:9`; read_audit_evidence and submit_audit `extensions/mods/audit-submit.ts:50/60`; submit_reading `extensions/module/reader-submit.ts:26`; submit_adaptation `extensions/kernel/adaptation-submit.ts:26`.

Classification. setup: Jev may match a stated occupation, skill, or equipment concept to existing catalog candidates, select the active brief slot for an actual player answer, and identify changed profile fields; the host copies the actual answer and existing values, new biography stays with the generative owner; the kernel owns step ordering and prerequisites, original card identity, numeric pins, allocation and rerolls; confirmation and reroll require existing player authorization, and a loop stops at such decisions and does not turn a semantic classification into consent; no new setup agent or tool is introduced, and this is a later closed-candidate subtask after lookup and catalog acceptance. pdf and read_audit_evidence: retained deterministic evidence access, optional targets chosen by Jev within the current task; PDF text navigation can feed the Jev loop, image-only observations require the existing visual reader, not passing an image to text-only Jev, and these are execution capabilities, not functions to replace with a model. submit_reading, submit_audit, submit_adaptation: retain deterministic artifact checks, scope/source/lease validation and checked final submission; Jev-selected fields and references may be materialized into eligible artifacts, and no semantic result bypasses validation or changes trust by itself.

## Promise recall and reward settlement (appended)

Current behavior. Runtime records are JSON/JSONL under `.coc/campaigns/<id>`, and the Git sidecar `.coc/repos/<id>.git` retains version history (`kernel-ts/git.ts:48-50`; `kernel-ts/write/history.ts:21-24` commits tracked campaign work). Recall does not semantically search git log on each call: `kernel-ts/memory/recall.ts:164` queries retained memory, transcript reads compare canonical turn-record text (`kernel-ts/memory/recall.ts:28-44`), and `kernel-ts/write/store.ts:96` reads turn JSON. Memory already has a promise kind (`kernel-ts/memory/jobs.ts:14,32-33`), with source turn/commit/receipts/worldline/loop attached by the host (`:362`). Retrieval ranks correction priority, entity overlap, kind tier, and recency (`kernel-ts/read/memory.ts:111-139`), which is not current-event semantic condition fulfillment. NPC history previews the last three promise ledger entries (`kernel-ts/read/capsule.ts:299`), but `kernel-ts/read/assemble.ts:284,299` passes all candidate rows to promiseObligations, whose `kernel-ts/read/memory.ts:217-224` projects all non-superseded promise candidates as obligations, so a global obligation projection exists and promises are not wholly forgotten.

Gap. `kernel-ts/memory/jobs.ts:352-359` lets a new promise supersede any prior active candidate of the same kind, subject, and sorted entities without testing whether it is the same independent promise, so two independent promises from one NPC to the same party can hide each other. Existing promises have no dedicated observed fulfillment receipt link in this pathway; generic Promise.allSettled status is not narrative fulfillment. `kernel-ts/apply/inventory.ts:93-118` accepts a found gift/debt or a quote naming a person, not only a printed price, so campaign-authored gifts/debts can land independently. Scenario SAN ending rewards remain separate rule authority, not fabricated from an NPC promise.

Design/evidence status. The promise recall and reward settlement scenario is assessed here as specified, not implemented, not tested. The producer/reader/actor contract and receipt-backed exactly-once settlement are design requirements; any claim that every asynchronous candidate is immediately a separate Git commit, or that a tested fix exists, is not made. The primary comparison [classifying RAG passages](https://docs.typesafe.ai/cookbooks/classifying_rag_passages) supports relevance/evidence/contradiction classification, but it does not implement promise settlement.

Independent precedent: Microsoft’s [Event Sourcing pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing) describes rebuildable projections, retained corrections and idempotent handling of duplicate events. This supports deriving memory indexes from existing records and binding reward fulfillment to durable receipts; it does not call for replacing this project’s Git and campaign storage with a new event-store architecture.

## Whole memory lifecycle design (appended)

Status: specified, not implemented, not accepted. This section records the full memory lifecycle design and the current pipeline limits; it does not claim implementation, tests, or provider success. The detailed promise example above remains one downstream case, not the memory architecture.

Current pipeline and limits (verified current source, supplied to avoid re-reading). `extensions/memory/index.ts` creates one post-turn asynchronous job queue through `createLaneQueue`. It resolves a generative `PI_COC_MEMORY_MODEL`, calls `runLane` to generate candidates and an optional story assessment, then calls `memory.submit`. There is one retry and a backlog; the lane does not block narration. Jobs attach host-only identifiers and provenance, not model-authored ones. `kernel-ts/memory/jobs.ts:14-18` candidate fields are kind, subject, knowers, statement, entities, privacy, state, confidence, corrects. Kinds are world_event, knowledge, belief, relationship, player_assertion, player_preference, keeper_correction, promise. Privacy is player_safe or keeper_only; state is accurate, uncertain, or distorted. Statement is 1-400 characters and a job accepts at most twelve candidate rows. The current instruction asks for a freeform statement and says no numbers or dice. Host `buildJob` currently supplies only twelve prior candidates and thirty correction targets. Arbitrary source references are not accepted candidate fields, so a direct Jev plug into the generative facade does not work; explicit packet, submission, and read-projection contract changes are required.

Submit replay returns the retained result for the same job and digest and rejects a changed submission. The host attaches source turn, commit, receipts, worldline, loop, and id. Prior pair-only supersession for relationship and promise can collapse independent claims, and current corrections bind exact prior statements. Files are stored as JSON/JSONL with campaign Git version history; there is no separate Git commit per asynchronous row claim. Current read ranking is correction priority, entity overlap, kind tier, and recency, with no proactive semantic query family. Memory candidates remain reports, not module truth or canonical world state; the existing ledger, capsule, and recall consume their views. Story alignment assessment currently ships with the extraction job and has acquired-evidence gates; preserve it or migrate only its accepted typed questions, and do not silently drop that output.

Selected design. Memory has two adaptive tasks with shared infrastructure. The write/organize loop turns a committed turn into host-prepared exact source spans, Jev retain/skip/defer and independent semantic metadata decisions, host-fetched older memory and original evidence when relationship or novelty is unclear, Jev relation classification (duplicate, new, reinforcement, contradiction, explicit correction, temporal change, unrelated, unknown), host validation and commit through the existing memory job/submit owner, and incremental index and read-projection updates. It replaces regular generative extraction for accepted candidate families and repeats only when a genuinely new observation is needed. The read/use loop turns the current scene, exact player action, new actual receipts, and query goal into wide authorized candidate retrieval, Jev relevance/usefulness/current applicability/support/contradiction judgments, link following and original-span fetch, re-evaluated coverage, and bounded context with original sources, counterevidence, and uncertainty. Several rounds may run inside one existing tool or context task, and a cold, missing, or lagged index falls back to retained originals with query/cache binding to worldline, source, and context revision.

Contract amendments. The existing memory job/submission contract is amended to offer selectable immutable spans and entity/older-record packets and to accept typed selections, annotations, and relations; the host materializes compatible read views. Legacy freeform statement rows are tolerated and preserved. A novel generated summary is optional, marked derived, source-linked, and not canonical fact; a genuinely new abstraction, unresolved coreference outside offered candidates, or truly novel interpretation may use the existing generative owner for that gap only. Maintenance distinguishes exact duplicate, multi-source report, independent claim, time evolution, and explicit correction; sharing an NPC or subject pair is not replacement authority; secrets are not merged with public claims; contradictions are not erased for low relevance; verified links target actual prior records; Jev may cluster, select, or hide from current context but does not delete originals or rewrite Git. Host ownership keeps schemas, revisions, scope, allowlists, idempotence, persistence, and Git in the kernel; retrieval stays read-only; mutations, including all promise world changes, go through existing apply, resolve, or accepted publication.

Primary comparisons. TypeSafe [autoformat](https://docs.typesafe.ai/cookbooks/autoformat) shows code-owned original text plus semantic classification without rewriting, using sequential dependent passes and batch independent questions; its whitespace normalization is not copied into the exact-source contract. TypeSafe [entity_alignment](https://docs.typesafe.ai/cookbooks/entity_alignment) supports semantic entity-candidate alignment, not automatic permission to merge historical truth. TypeSafe [classifying_rag_passages](https://docs.typesafe.ai/cookbooks/classifying_rag_passages) supports relevance, support, and contradiction classification. Microsoft [Event Sourcing](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing) supports incremental, rebuildable projections and idempotence, not a new storage requirement. The full memory pipeline is UNIMPLEMENTED and UNTESTED; the provider examples do not prove it works for this game, and prior prototype honesty is unchanged.
