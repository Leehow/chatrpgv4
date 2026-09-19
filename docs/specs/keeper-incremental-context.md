# Keeper Incremental Context: complete the evidence reuse path

Status: approved for implementation on 2026-09-19; supersedes completion claims for the reference-only KIC implementation, not its retained evidence.
Baseline: `0.9.3a`, `8fee62f7d`.
Implementation status: P0–P4 core changes are present locally, with package 1.1.0. Source/contract checks and a short Grok 4.6 scene-return run are verified. Actual Workpad adoption, configured-provider rerank and the A–E performance comparison remain open in #98; default-off remains the release policy. See the companion ticket document for exact test counts, retained failed attempts and evidence locations.

## Problem Statement

The Keeper receives bounded history but loses useful evidence between turns. The current KIC implementation injects source locations instead of their contents. Its evidence store has no production consumer, scene changes do not invalidate the prepared request, and a late ranking response can restore an old request. A scene workpad is currently shared across every scene on one worldline. The player therefore still pays for repeated preparation, while the new optional layer has freshness and isolation gaps.

Success means that a subsequent model request already contains verified, relevant material from the current or revisited scene, without restoring an old world, authorizing an action, leaking Keeper data, or adding mandatory model calls. An index, passing fixtures, a high cache-hit count or an unpaired short game is not evidence of that outcome.

## Solution

Complete the existing host-owned KIC path. Keep the seven Keeper verbs, the current capsule, current tool results, admission, continuity review and kernel transactions authoritative. Preserve ordinary lookup and recall as the way to fill explicit gaps.

Ship a static evidence baseline independently of Workpad and rerank. Reuse verified source excerpts, source-backed static profiles and complete rule references. Retain dormant scene references and restore their valid bodies when returning. Refresh current state after successful or uncertain mutations. Workpad remains optional scene-local advice; rerank remains optional selection over already-authorized candidates.

## User Stories

1. As a player, I want follow-up questions about the same person to reuse verified background so that I do not wait for the same preparation again.
2. As a player, I want returning to a scene to restore its valid references so that investigation continuity survives travel.
3. As a player, I want current NPC positions to prevail so that old source material never moves someone back.
4. As a player, I want ownership and discovered knowledge to remain authoritative so that cached descriptions cannot give or remove objects or clues.
5. As a player, I want a successful move to refresh the next model request in the same turn so that the Keeper uses the destination context immediately.
6. As a player, I want a refused move to leave the actual scene unchanged so that a proposed destination is not mistaken for arrival.
7. As a player, I want a new input to cancel obsolete optional work so that a late response cannot overwrite my current request.
8. As a player, I want carried objects and accompanying people to retain relevant references across scenes so that context is not limited to a map identifier.
9. As a Keeper, I want loaded evidence bodies and their limits, not only locations, so that another lookup is optional when the answer is present.
10. As a Keeper, I want static source material separated from current state so that I do not mistake authored background for a live fact.
11. As a Keeper, I want source and independent rule revisions checked so that obsolete references disappear after an update.
12. As a Keeper, I want partial excerpts and omitted dependencies identified so that I can read missing material before relying on it.
13. As a Keeper, I want player words to remain the primary retrieval query so that yesterday's hypothesis cannot determine today's evidence.
14. As a Keeper, I want available graph relationships to widen candidates before the final cut so that useful material beyond the old first eight entries can participate.
15. As a Keeper, I want a scene-local optional workpad so that returning to a place can restore its questions without carrying its whole plan everywhere.
16. As a Keeper, I want failed or cancelled deliveries to discard their patch so that undelivered plans do not become progress.
17. As a Keeper, I want changed dependencies to mark notes for recheck so that an old interpretation cannot silently become current.
18. As a player, I want workpad content excluded from notes, rulings, obligations, admission and UI so that tentative ideas cannot become official facts or choices.
19. As an operator, I want independent static, Workpad and rerank switches so that each component can be evaluated and rolled back separately.
20. As an operator, I want rerank skipped when evidence already fits so that optional ranking adds no unnecessary wait.
21. As an operator, I want shadow observation not to wait on remote ranking so that the baseline remains measurable.
22. As an operator, I want explicit remote-data permission checked before sending candidates so that configuring a provider alone does not disclose Keeper material.
23. As an operator, I want invalid or foreign candidates removed before transmission so that a later projection filter is not the only isolation boundary.
24. As an operator, I want one bounded ranking attempt with cancellation and deterministic fallback so that a vendor outage cannot stall the game.
25. As an operator, I want cache keys to include exact candidate order, revisions, query and provider configuration so that listwise scores are never reused on another set.
26. As an operator, I want all cache bytes and temporary reservations governed together so that long games cannot fill the disk.
27. As an operator, I want concurrent writers coordinated across instances and processes so that revisions and quotas cannot be bypassed by races.
28. As a player, I want cache corruption or deletion to lose only optional context so that my campaign remains intact.
29. As a developer, I want actual outgoing Pi requests tested so that an unconsumed field cannot count as delivery.
30. As a developer, I want real scene transitions distinguished from worldline transitions so that a passing branch fixture does not claim scene restoration.
31. As a maintainer, I want separate found, valid, injected and adopted evidence measurements so that a cache hit is not reported as an avoided model round.
32. As a maintainer, I want cold/warm, revisit, restart and failure results retained so that a performance claim can be reproduced and challenged.

## Implementation Decisions

- Extend the existing pure workspace read, context policy and cache interfaces; add no second agent loop, new Keeper verb, new authoritative database or Python production path.
- The pure read returns a scene identity, current dynamic stamp, source and independent rule/projection revisions, bounded static evidence groups and explicit coverage. Reuse the existing campaign snapshot and graph indexes. Do not replay player-facing look/lookup or start reading, adaptation or memory work.
- Static profiles contain explicitly selected authored fields. Dynamic NPC position, HP, inventory, ownership, knowledge, clocks and executable markers are excluded. Campaign adaptations preserve their authority. Incomplete groups remain excerpts or source cards and never become complete rule authority.
- The host owns persistent evidence capture, content-addressed bodies and scope/scene/entity/thread references. Source revisions and projection versions validate reuse; merely advancing a turn does not invalidate static bodies. Evidence storage must have a real producer and consumer in the request path.
- Use current scene and structured entity identities, retained scene references and bounded graph neighbors for candidate retrieval. Keep a direct raw-player-query lexical/index channel where available; it is retrieval, never semantic intent classification. Do not scan cold PDFs, invoke a query-rewrite model, or assume pronoun resolution. Historical conversation-report retrieval remains disabled in this static slice; existing recall and memory correction paths remain available.
- One serialized request controller owns invalidation and cancellation. Successful or uncertain world mutations refresh the current snapshot before the next model request; rejected actions do not invent changes. New input, shutdown, source publication and scope changes cancel obsolete work. Every await that can outlive a request is followed by an epoch check before publication.
- Capture successful supported reads as source references under the call's starting binding. Do not retain mixed dynamic tool payloads wholesale. Failed/pending source work contributes no complete evidence.
- Scene Workpad binds to campaign, worldline, loop and scene. Publish only after the same successful delivery using a cross-instance revision comparison; an older patch loses. Revisit restores only that scene's notes. Dependency changes produce recheck status; discarded entries are not projected. The focus line is bound and invalidated with its document.
- Strip workpad annotations before Mod, admission and kernel execution. Bad patches and cache write failures never reject an otherwise legal delivery or add repair-model calls. A scope transition does not inherit the old scene's notes.
- Filter scope, audience, coverage, authority and source revisions before rank or injection. Rank is permitted only when enabled, configured, explicitly allowed to receive data and needed for a real budget/count choice. Shadow performs local selection and measurements without remote ranking.
- Ranking has a hard deadline from dispatch, propagates cancellation and ignores late success. Validate candidate identifiers and finite scores; rank cache binds the exact ordered list, contents, query, scope, revisions and provider/template version. No retry or semantic repair call.
- Start with a 24 KiB workspace ceiling, 24 active evidence groups, 128 candidate inspections, 48 rerank candidates, 48 KiB total rank documents, 2 KiB per rank document, 2 KiB scene Workpad and 1 KiB patch. Settings are validated and consumed; all limits include serialized metadata where applicable. Current player input, pending choice and authoritative context take precedence. Account for system/tool overhead and output reserve when deriving optional request headroom.
- Cache governance counts body, reference/index, Workpad and temporary reservation bytes under a common root, with campaign and global ceilings. Reuse native advisory locking, atomic publication and bounded eviction. Never GC campaign saves, events, transcripts, module sources or playtest evidence. A lock/write/quota failure is an optional cache miss.
- Keep default-off behavior. Add independent Workpad and rerank settings plus an explicit remote-data setting. Do not change unrelated provider, UI or campaign configuration.
- Telemetry records counts, hashes, byte sizes, reasons and spans; it does not log secret evidence bodies. Runtime input-to-delivery and provider-round measurements remain distinct from local cache/rank timing.

## Testing Decisions

- The user approved the primary seam on 2026-09-19: real TypeScript kernel RPC through Pi context/tool hooks to the model's actual outgoing request. Assert observable evidence, authority, turn/scene binding and tool pairing rather than private helper structure.
- Reuse existing workspace, Workpad, context-policy and real-kernel extension harnesses. Add focused storage fault/concurrency tests where the high seam cannot deterministically induce disk failures. Faux providers are valid only for deterministic contract tests, never as real-table evidence.
- Prove repeated NPC lookup evidence reaches the next first request as a body; process restart and real A→B→A restore it. Use actual move receipts, not a worldline switch or a hand-injected replacement capsule.
- Prove current NPC/ownership/knowledge state wins over old authored material. Repeated actions still produce new formal settlement. Source/rule/adapter revisions invalidate the matching optional views.
- Hold rank completion across new input, shutdown, source change and a same-turn mutation. Assert cancelled work cannot publish or populate a cache for the new request. A deliberately non-cooperative rank stub still cannot exceed the host deadline.
- Prove pre-transmission filtering, no-send without explicit permission, no rank when everything fits, no shadow wait, input byte limits, malformed-result fallback and exact-list cache invalidation.
- Prove patch failure/cancel/refusal, scene dormancy, dependency recheck, cross-line isolation, concurrent revision conflict, corrupt cache, quota/temp accounting and unchanged formal campaign files.
- Map results to v2.0 KIC-01–36. Mark dynamic-dependency and historical-semantic cases deferred rather than passing them with static fixtures.
- Freeze the comparison protocol before measurements: A baseline/off; B static evidence; C B+Workpad; D B+rerank; E B+both. Hold model, thinking, admission/review, prompt/source versions and cold/warm history fixed. Report failures/cancellations and quality counterexamples. Targets remain repeated reads -30%, delivery p50 -15%, mixed p95 degradation <=5%; these are gates for an acceleration claim, not promised outcomes.
- Real acceptance uses the repository RPC play driver, Grok Keeper and the main session as the only natural-language player, one turn at a time. Preserve every run. Do not claim configured-provider or performance acceptance when credentials, sample size or comparison quality are insufficient. Keep such tickets open with their exact remaining gate.

## Out of Scope

- P5: embedding cold recall, dynamic derived-state caching, incremental transcript replacement, provider KV/prefix optimizations and large skill selection.
- New story content, language tables, semantic keyword classifiers, automatic plot plans, changes to admission/review strictness or public lookup/recall semantics.
- Packaging/restarting the installed App, deployment, pushing branches, dependency upgrades and cleanup of unrelated files or worktrees.
- Treating an authored initial state as current world truth, or treating a cache as an action receipt.

## Further Notes

- Implementation baseline contains a default-off reference-only workspace, an unconsumed EvidenceStore, delivery-bound Workpad and a basic rerank caller. Preserve these useful seams, while replacing the reference-only completion claim.
- The prior four-turn live run verifies limited continuity/restart behavior; it has no successful external rerank and no Workpad events. Retain it as historical evidence, not acceptance of the new requirements.
- The source design remains `docs/chatrpgv4-keeper-incremental-context-v2.0.md`; it is user-owned and will not be overwritten. The binding runtime contract remains `docs/kernel-rpc.md`.
- [Sentence Transformers retrieve-and-rerank](https://www.sbert.net/examples/sentence_transformer/applications/retrieve_rerank/README.html) confirms that ranking operates after candidate retrieval; it cannot recover evidence outside the candidate pool. Our bounded graph/source path does not require their embedding stack.
- [Node filesystem documentation](https://nodejs.org/api/fs.html) warns that concurrent file modifications require coordination. Atomic replacement alone is not revision exclusion or a multi-file quota transaction; reuse the project's existing advisory-lock backend.
- Source and test proof, real-table proof, performance proof and installed-App proof are separate. Only the first three belong to this task; none is silently inferred from another.
