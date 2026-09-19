# Bounded play context with retained evidence

_Date: 2026-09-15. Status: proposed; implementation requires approval. Basis: current 0.9.3a working tree at 58c78520e, including unrelated uncommitted work. This document does not declare implementation or live acceptance._

## Problem Statement

The player wants a long campaign to remain responsive without forgetting commitments, corrected statements, the investigation's causal relations, or the player's choices. Success is a bounded contribution from closed history, reliable retrieval of the original evidence, and continuity demonstrated at a real table. Hollow delivery would be a lower token count accompanied by forgotten promises, repeated source lookups, fabricated recollections, extra waiting, or forced plot progress.

The current COC fold discards old capsules and tool round trips but copies every player, delivered Keeper and retained host text into an accumulating summary. Its `details.coc_fold.lines` also accumulates. This reduces regenerable noise but does not bound the old conversation sent to the model. Most host notes survive regardless of whether their original turn has ended.

The kernel already owns durable state, receipts, transcripts, candidate memories, corrections, notes, rulings, NPC ledgers, module evidence and story assessments. These must not be replaced with a new prose state store. Candidate extraction is asynchronous and can fail: removing dialogue without exposing that gap would be a new continuity regression.

Two additional entry points undermine a bounded policy: transcript recall currently returns full entries automatically for ranges of three turns or fewer, and a single explicit transcript read returns the entire utterance. History has row limits in places but no universal response-byte ceiling.

### Current evidence

- `extensions/table/fold.ts`: type-based classification, two-user-turn cut preference, fallback to Pi's cut, cumulative transcript rendering and 70% threshold.
- `extensions/table/index.ts`: before-turn pre-compaction, custom compaction and post-compaction note.
- `extensions/kernel/index.ts`: `table.player_input` supplies the current capsule; delivered assistant text is replaced with the committed rendering.
- `kernel-ts/read/assemble.ts`: bounded sections, current memory and story inputs, first-process briefing, optional Mod contexts; no independent global Mod cap.
- `kernel-ts/memory/recall.ts`: transcript cards and unbounded short-range/full-utterance returns; history and candidate reads.
- `kernel-ts/read/memory.ts`: six capsule candidates, corrections first when relevant, authority annotations.
- `kernel-ts/read/continuity.ts`, `thread.ts`, `story.ts`: evidence relations, bounded local continuity and worldline-bound causal re-entry.
- `extensions/memory/index.ts`: asynchronous extraction, one retry, backlog and bounded startup backfill.
- Pi 0.85.1 local `docs/compaction.md`, `dist/core/agent-session.js` and `dist/core/compaction/compaction.js`: compaction appends rather than deletes; extensions supply a cut plus replacement text; preparation may fail before the extension hook; split-turn cuts are possible; usage becomes unknown after compaction until another valid assistant response.

## Solution

Keep one context owner: the existing table extension, collaborating with kernel-owned read projections. Introduce one pure context-selection policy reused by an outbound `context` hook and the existing compaction hook. The outbound hook controls what actually reaches a request; the compaction hook persists a bounded representation and keeps Pi's retained session context manageable. They are two adapters of one policy, not competing compressors.

The policy separates three things:

1. **Evidence archive:** existing Pi session entries and canonical campaign records remain complete and unmodified.
2. **Active request:** current instructions, a current capsule, the current player input and unresolved tool exchange, plus bounded recent dialogue and retrieval references.
3. **Recovery:** existing candidate memory, obligations, rulings, NPC history and continuity projections supply relevant context; bounded `recall` returns original evidence when needed.

There is no summarization model, embedding service, new Keeper verb, extra foreground semantic lane or independent long-term memory database in this proposal. A later KIC slice may add a bounded, discardable host evidence cache, an optional deterministic rerank adapter and a default-off policy package; those remain outside this bounded policy's authority and are not a second memory registry.

## User Stories

1. As a player, I can continue a long campaign without the entire opening conversation being resent forever.
2. As a player, I can ask what someone said earlier and receive an answer grounded in the retained original, not an invented recollection.
3. As a player, an old correction does not disappear merely because its original turn leaves the active window.
4. As a player, unresolved commitments and relationships remain available through the existing ledgers and memories.
5. As a player, a memory-lane outage does not silently become a claim that nothing noteworthy happened.
6. As a player, compression never settles my pending choice, repeats a roll, or discards an unresolved tool transaction.
7. As a player, changing worldline or rewinding does not import another line's dialogue as current reality.
8. As a Keeper, I receive the current book briefing and active package instructions again when their only active copy would otherwise disappear.
9. As a Keeper, I can follow a small history card to a bounded original-text page and then continue reading without losing or duplicating characters.
10. As an operator, I can distinguish reduced historical input from an oversized current turn and from a memory/retrieval failure.
11. As a developer, one selection policy governs both live request projection and persisted folding.
12. As a developer, old sessions remain readable without rewriting their records or their prior compaction entries.

## Implementation Decisions

### D1. The guarantee concerns closed history, not arbitrary input

The hard guarantee is that model-visible material contributed by **closed conversation history** has a fixed byte ceiling independent of total campaign length. Bounded recall responses have a separate ceiling.

The policy does not claim that an arbitrarily large current user message, an unresolved tool exchange, system prompt, tool schema or active capsule can always fit a model window. These are accounted for separately. If those protected inputs alone exceed the usable window, report a capacity limitation using the host's existing failure/recovery surfaces; do not erase current inputs, fabricate successful delivery, or repeatedly compact unchanged history.

Initial defaults are engineering starting points, not measured optima:

| Area | Initial bound / preference |
| --- | --- |
| Closed-history contribution per request | 32 KiB serialized UTF-8, including historical quotes, labels and retrieval references |
| Recent dialogue | Prefer both sides of the latest two committed played turns, newest first, inside the same 32 KiB budget |
| Historical locator / missing-coverage metadata | At most 4 KiB within that 32 KiB, never an additional unbounded packet |
| One model-facing recall response | 12 KiB serialized UTF-8, including annotations and pagination metadata |
| One transcript text page | Up to 4096 Unicode code points, shortened further to fit the response-byte budget |
| Transcript/history listing | Up to 20 records per page, further reduced by response bytes |

A result's total serialized size, not just its `text` field, is measured. UTF-8 bytes are the deterministic limit; token estimates and provider usage remain separately labeled measurements. There is no language detector or language-specific divisor. Window pressure can reduce historical allocations further; it never expands the historical maximum.

Keep existing capsule section budgets initially. Do not silently trim hard-state fields, the current pending choice or active package laws to meet an arbitrary global target. Audit fixed/capsule costs in telemetry; a global Mod-budget redesign is out of scope.

### D2. One outbound projection, cached for a player turn

Use existing structured capsule/session metadata and successful delivery boundaries to bind a history group to campaign, worldline, loop and canonical turn. Do not infer boundaries or identity from prose. Add host-only binding metadata where current events lack it; do not expose opaque session entry IDs to the Keeper.

At a stable boundary, derive the bounded history view from committed campaign records and the active Pi branch. Recent player and Keeper wording comes from the original records. Old tool exchanges and old capsules do not enter this history view: they are regenerated or retrieved through existing tools.

Current input, current capsule and **all messages belonging to an unresolved current exchange** are protected. An input that answered an `ask` does not license deleting the pending-choice context before the new capsule and retained current exchange represent it. Intermediate messages after a successful `narrate` but before Pi finishes its run are not treated as freely removable merely because the kernel turn committed.

The outbound hook returns a projected copy; it does not mutate, delete or rewrite raw session entries. It distinguishes new active messages from historical quotations. Partial historical quotations are explicitly marked as partial and carry a turn, role, returned range and next-read arguments. They are never silently presented as the complete original player input.

Compute history selection on a new player input, restart, worldline/loop change, explicit compaction or changed recovery binding. Reuse the stable prefix through tool round trips; append/protect the live exchange instead of recomputing all history for each provider call. Cache against structured state, not prose similarity. Avoid rescanning and hashing the entire transcript on every request.

If authoritative bindings or the current capsule cannot be obtained, do not guess an aggressive cut. Preserve the affected active region, emit a bounded degraded/capacity diagnostic, and recover through existing host mechanisms. Unknown custom messages are retained conservatively until classified; an unclassified input is a reported exception, not a hidden success against the budget.

### D3. Closed dialogue is a rolling window, not a new summary

Within the history budget, first reserve metadata needed to interpret omissions and locate originals. Prefer the latest two committed dialogue pairs. If both do not fit, keep the newest complete pair first; if even that pair is too large, return explicitly labeled bounded excerpts and original-read references. Do not keep half a historical quotation without identifying the omission.

There is no semantic keyword relevance filter. Older causal context comes through existing memory and continuity projections, not a new heuristic selection of old sentences. The Keeper can retrieve an older original when needed; the design does not promise that every literary nuance remains active without a read.

The compact history header explains only: which active campaign/line the references address, the retained/omitted turn ranges, whether memory extraction is incomplete, and how to use existing recall. It contains no duplicate world state or new plot obligation.

The archive is not copied into every new `details` object. New fold metadata uses a versioned bounded manifest: policy version, source/binding references, cut/retention ranges, measured sizes and omission reasons. Old version-1 `lines` remain readable historical data; they are neither deleted nor appended wholesale into version 2. Canonical records and old session entries remain the original evidence.

### D4. Compaction is persistence and pressure relief, not the only enforcement point

The existing compaction hook renders the same bounded history view and chooses a safe retained suffix. It validates that no retained tool result is orphaned and no unfinished current exchange is discarded. The usual preference is a completed-turn boundary; a blind fallback to Pi's split-turn cut is removed.

If a valid safe cut cannot be represented, return an explicit cancellation/degraded outcome rather than silently invoking Pi's generic model summary. Do not call a different model to repair this condition. The outbound projector still enforces its closed-history policy where bindings are valid; Pi's `prepareCompaction` being unable to prepare a cut is not permission to resend unbounded closed history.

Keep `PI_COC_COMPACT_AT` as a pressure threshold (default 70%) for persistence. Historical projection does not wait for it. Respect unknown post-compaction usage; do not present an estimate as a provider measurement. Coalesce work for the same source revision, do not compact when the plan makes no progress, and record a no-progress reason instead of retrying on every tool round trip. Test the `manual`, `threshold` and `overflow` paths with the same policy.

The single-cut API is sufficient to replace an old region with bounded text. Its limitation is that it cannot directly express arbitrary retained-message sets; the outbound adapter handles the selective view. No Pi fork or SDK patch is authorized.

### D5. Rehydrate current context; do not preserve stale instructions

Extend the existing read-only capsule request with an explicit host-only rehydration option. It reconstructs the current module briefing, full active package instructions and full craft context when a new context epoch needs them. It must not reopen a turn, consume `firstStyleTurn`, change world state or persist new facts. Use the same existing builders rather than a second authored briefing.

A rehydration is needed on cold resume, after losing the previously supplied full briefing from active context, or after a package/source/worldline revision invalidates it. Cache that briefing within the epoch; do not resend full package files by repeated tool calls. If the complete mandatory instructions plus current state are themselves too large, expose the fixed-cost limitation rather than silently shortening package rules.

Live choice/recovery/adaptation/reading requirements come from their current structural owners. Prior-turn host notes whose closed `kind` and turn binding prove them expired may leave the active view. A persistent or unknown kind must remain or be regenerated explicitly. Never use text matching to decide whether an instruction is obsolete. The new compacted note does not accumulate across epochs.

### D6. Use the existing memory planes, with an explicit coverage signal

Keep candidates as `conversation_report`, retain their `status`, `state` and correction/supersession information, and keep the existing no-promotion rule. Transcript integrity means the words were recorded intact; it is never a certificate of module truth.

Do not invent a new relationship, promise, ruling or story store. Existing projections remain responsible for obligations, current NPC histories, rulings and causal reentry. For capsule candidate ranking, extend the structural anchor set to include the current scene and the latest acquired evidence already selected by continuity, besides present NPCs and investigators. Preserve correction-first semantics, candidate authority and the existing six-row/byte budget. No prose relevance classifier is added.

Expose a compact coverage annotation derived from committed turns and existing memory job/backlog states: recent pending/failed turn ranges, total older gaps, and retrieval arguments to page their existing history. It is not a completion guarantee: an extraction that succeeded with zero candidates can still have missed a nuance. Do not call the model synchronously to make this indicator green, and do not retain an unlimited raw-history tail while waiting for extraction.

The annotation is Keeper-only service evidence, not a story obligation or instruction to replay every old turn. If a gap matters to the current response, the Keeper reads the original; otherwise play continues with grounded state. On a failed original read, the information stays unavailable rather than being silently synthesized.

The candidate `promise` kind already accepted by the kernel is exposed on the Keeper recall tool so the recovery path can actually ask for it. Other incidental recall/schema mismatches do not expand this slice.

### D7. Bounded recall is part of the feature, not optional hardening

Keep the seven verbs and existing `recall` modes. Version/amend the wire contract and tool descriptions before implementation.

- **Transcript browse:** cards only by default, including for one-to-three-turn ranges. No automatic hidden `entries` payload of whole prose. Cards carry canonical turn, role, size, a bounded original head and a next read. Listings page by semantic turn/role positions, not opaque model-copied cursors.
- **Transcript read:** optional Unicode-code-point offset and requested limit; the default is the bounded page above. Return total characters, actual returned range, `truncated` and exact next-read arguments. Integrity verification is against the complete canonical utterance before slicing; explicitly retain `verification_scope: record_integrity_only`. Pages never split surrogate pairs or silently skip/repeat characters. No model-facing unlimited-text switch.
- **History:** a bounded timeline/event page with explicit omitted/more information and continuation arguments. Each oversized event is represented by its type/turn and a bounded detail locator, not silently cut into an apparently complete fact. Reuse the existing history mode for detailed event paging when necessary. Diff output is bounded and pageable too; a large entity set must not bypass the response ceiling.
- **Memory:** retain deterministic entity selection and authority annotations, subject to the same response ceiling; paginate remaining hits using a stable ordered position in the current snapshot. Expose `promise` and explain correction/source status in the tool description. Concurrent mutation invalidates a stale page rather than silently splicing two snapshots.

Pagination bindings include the active campaign/worldline/loop and source revision internally. Models use readable names, turn/role and offsets. A stale binding returns a bounded refresh instruction. Full original text remains in the existing retained files and can be reconstructed by following all pages; no original file is shortened or replaced.

The existing `lookup continuity` stays graph/evidence-based. Its current bounded previews point to the new transcript read for exact wording; do not create a second semantic retrieval service.

### D8. Worldlines and recovery

Reset the active-context selection when the canonical line/loop changes. Do not blend an old Pi conversation suffix into a new line's current reality. Current-line canonical state and inherited evidence follow the existing worldline restore rules: do not naively reject every candidate whose origin differs from the current line, since legitimate inherited history exists.

Explicit cross-line knowledge continues through existing `worldlines`, `from_other_lines` and recall capabilities. The new projector does not grant investigators additional knowledge. Previously issued pagination positions do not silently resolve to the same turn number on a different line.

On restart, regenerate from current canonical records and compatible session metadata; do not require the last process's cache. Old version-1 folds stay readable. If a canonical original cannot be located, use retained session data only as a labeled recording with its known binding; otherwise report unavailable. Never create replacement evidence to make recovery pass.

### D9. Telemetry without a new player UI

Extend existing fold/context telemetry, not the story text. Record policy version, trigger, outcome, current state identity (host-only), protected bytes, closed-history bytes before/after, capsule/fixed estimates when observable, recall bytes/pages, missing memory coverage, rehydration/cache outcome, no-progress reason and duration.

Record provider-reported input/cache tokens and latency when available; label local estimates separately. The integration checks must inspect the actual outbound request, since raw `session.messages` may intentionally exceed the projected view. The exact projection plan or bounded manifest is retained once per changed plan so an incident can be reconstructed without copying all prose into telemetry.

Do not feed token counts, compression frequency, recall counts or unadopted offers back into plot obligations. Add no dedicated settings page or dashboard in this slice.

## Three Ends of the New Data

| Data | Producer | Reader/projection | Consumer/action |
| --- | --- | --- | --- |
| Context binding and retention manifest | Host from structured capsule/delivery/session events | Table policy and compaction metadata | Outbound selection, restart and stale-reference rejection; never game state |
| Rehydrated briefing | Existing kernel module/craft/Mod builders | Existing capsule channel | Keeper sees the same current instructions after rebasing; no new receipt authority |
| Memory coverage annotation | Existing committed turns and extraction job/backlog state | Bounded Keeper-only context metadata | Keeper uses original recall when needed; no automatic fictional debt |
| Historical source/page references | Canonical recall/history records | Bounded history and recall result | Keeper's next `recall` reads the original; correctness measured through actual read and subsequent narration |
| Context/recall accounting | Host request/fold/read outcomes | Existing telemetry only | Human verification and performance comparison; never next-turn story direction |

## Testing Decisions

### Primary seams

Use the highest existing seams: a real Pi `AgentSession` with the repository's `openTable` harness for projection/folding and actual outgoing messages, and current TypeScript RPC plus Keeper tool calls for recall/rehydration. Pure selection tests support those seams; they do not replace them. Test-only synthetic histories are allowed for deterministic boundary and scaling checks, explicitly not as gameplay or acceptance.

Tests must cover:

1. Hundreds of closed records produce a bounded closed-history payload; the current user and unresolved tools remain intact.
2. Default recent dialogue, oversized prior utterance, enormous current input, empty session and unavailable capsule each take the documented path.
3. Every retained tool result has its call; pending mechanics choices and in-flight narration survive manual, threshold and overflow attempts without duplicate receipts.
4. Repeated folds are idempotent with respect to visible content; old version-1 data does not regrow the active summary; raw session and canonical evidence remain readable and unchanged.
5. `prepareCompaction` fails before the hook, usage is null, no safe cut exists, or no saving is possible: no generic summary call, no same-revision retry loop, no false success.
6. Recall returns bounded cards/pages/diffs; concatenated text pages reproduce the original Unicode string; all metadata fits the response cap; stale/worldline-changed pages are rejected honestly.
7. Memory delayed, failed and successful-empty cases; correction priority; old promise recall; NPC relation and ruling continuity; candidate authority never upgraded.
8. Rehydration restores full current briefing and active package instructions without changing turn or game state, including Mods-off and old-session cases.
9. Worldline switch/rewind and cold restart keep only the authorized history and prior-loop knowledge; turn numbers do not collide across lines.
10. Actual outgoing provider context reflects the bounded view, while persisted raw history still contains the original evidence. Prefix reuse avoids reshuffling unchanged historical context on each tool call.

### True-play acceptance

Follow `docs/acceptance.md` and the project method: `tests/play/driver.py` transports RPC to `bin/pi-coc`, the configured Grok Keeper runs the table, and the main session is the only player, one natural utterance at a time. Do not use scripted players, keyword routing, fabricated Keeper turns or bulk settlements. Do not force a story route merely to hit a checklist. Fresh campaign IDs preserve all evidence.

A deliberately lowered compaction threshold may exercise the mechanism during a genuine table, but is labeled as such and never claimed as production-window pressure. Pure scaling tests establish the mathematical bound; real play establishes usable continuity. Observe an older promise/relationship, an explicit correction, a causal explanation involving already acquired evidence, retrieval of an old original and a real restart; cover a pending mechanics choice if normal play reaches one. Do not claim unvisited cases passed.

Acceptance requires both:

- Structural safety and bounded historical contribution are demonstrated at the executable seams.
- Real play retains the relevant facts and freedom, and the additional recall/rehydration overhead does not defeat the intended responsiveness. Report the actual trade-off; a token reduction alone is not acceptance.

No fixed percentage latency win is promised before baseline measurement. Compare before/after request composition and available real-table measurements under the same model/effort. Retained baseline sessions may be analyzed read-only; do not replay them as a synthetic player and call it a new table. Package installation and PipiUI restarts are not verification steps.

## Implementation Slices

All slices are proposed. A single contract owner updates the relevant existing sections before dependent code, without overwriting unrelated dirty work. Each slice includes its interface, implementation and focused tests.

| ID | Depends on | Deliverable and acceptance |
| --- | --- | --- |
| `bounded-recall` | none | Bounded browse/read/history/diff/memory responses through the existing Keeper verb, source/range metadata, Unicode pagination, `promise` exposure, stale-page and original-integrity tests. Contract: recall sections and host tool schema. |
| `context-rehydration` | none | Read-only rehydrated briefing, structural context binding and bounded memory-coverage metadata; relevant scene/evidence candidate anchors; cold-load/worldline/Mods tests. Contract: capsule/recovery and memory projection sections. |
| `bounded-context-policy` | both above | One outbound/fold policy, protected active exchange, bounded closed history, version-1 compatibility, stale host-note lifecycle, no generic-summary fallback, coalescing and accounting. Actual Pi request and raw-evidence tests. Contract: context folding/host behavior. |
| `context-live-acceptance` | bounded context policy | Integrated focused/full suites as appropriate, genuine table and restart evidence, actual cost/latency/recall trade-off, fix/recheck for defects within this scope, final whole-code review. No packaging. |

### Implementation map (navigation, not parallel ownership)

- Bounded recall: `kernel-ts/memory/recall.ts`, current memory RPC dispatch, `extensions/kernel/tools.ts`, existing recall tests plus new TypeScript-focused extension/RPC tests.
- Rehydration/coverage: current `table.capsule` dispatch in `kernel-ts/write/index.ts`, `kernel-ts/read/assemble.ts`, candidate and job read projections, existing kernel bridge/capsule events.
- Context policy: `extensions/table/fold.ts`, `extensions/table/index.ts`, a small private planner module if needed, narrow kernel event binding where necessary, `tests/extension/fold.test.mjs`, prompt/host contract wording.
- Acceptance: existing `tests/play/driver.py`, KPI and retained evidence paths; add only the accounting required by this feature.

No worker may edit the same shared contract region or host binding as another worker concurrently. Kernel implementation stays in TypeScript. Focused tests use the current TS runtime; the frozen Python oracle is never modified to match this feature.

## Out of Scope

- A second summary model, vector database, embeddings, a semantic keyword classifier, or a second memory registry. KIC's single default-off policy package and host-owned bounded evidence cache are the named compatibility path, not an independent context owner.
- A model-generated chapter summary or an extra summarization lane. Reconsider only if genuine-play evidence identifies missing continuity that existing projections and bounded originals cannot serve well.
- Changing Director scores, story assessment categories, admission authority, or turning compression metrics into narrative pressure.
- Automatically promoting memory to truth, closing promises, repairing candidate semantics, retrying all backlog jobs, or modifying old evidence.
- General cross-campaign memory, new worldline knowledge rights, unrestricted cross-line transcript APIs, or arbitrary branch-summary redesign.
- General `look`/`lookup` payload hardening, global Mod budgets, package UI, installation or unrelated current dirty changes. KIC's optional rerank consumer, Workpad lifecycle and workspace read/projection implementation belong to their later slices.

## Further Notes

The 32 KiB/12 KiB/page defaults are intentionally visible proposals and may be tuned from real measurements without changing the authority boundaries. Do not describe them as token-accurate or empirically optimal.

Recon correctly identified that the current fold is unbounded, but the claim that Pi's cut-plus-summary interface itself prevents bounded replacement is too strong: a bounded replacement is possible. Selective outbound projection and rehydration solve the remaining interface/lifecycle constraints without patching Pi.

The lack of perfect semantic retention is stated, not hidden. This design makes old wording recoverable and current obligations available; it does not claim that a small context can preserve every nuance of an arbitrarily long story without retrieval. A design approval authorizes implementation of these slices, not deletion of evidence or automatic packaging.
