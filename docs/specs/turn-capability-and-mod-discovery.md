# Turn Capability and Mod Discovery

Status: implementation in progress; only initial pure components have been verified. The new policy supersedes whole-first Mod instruction loading only after implementation and acceptance gates pass. Until then, whole-while-it-fits and overflow-only indexed behaviour remain in force.

Tracking issue: [#112](https://github.com/Leehow/chatrpgv4/issues/112), labelled ready-for-agent. This label records a prepared implementation task; this specification does not start implementation.

Baseline: repository mainline 0.9.7a at ca51d7dfc, clean. The product kernel is TypeScript only. Related issues: #111 and #108. This is a new task and does not claim those are complete.

## Problem Statement

Every Keeper inference carries all active tool definitions and, while it fits budget, the full Mod instruction text. On approved real GUI runs the canonical system and tool checkpoint is 133,313 bytes: 47,426 bytes of Keeper prompt text and about 85,657 bytes of six tool definitions. The apply definition alone is 58,139 bytes with 26 effect variants (npc 11,774, object 7,784, cash 6,344, time 3,031). The brief is 71,855 bytes and the turn capsule 35,134 bytes; recent conversation is only 3,494 bytes. The slowest turn's first call carried 62,461 input tokens, rising to 72,794, with roughly 268,000 to 327,000 serialized request bytes. Provider token counts include cache hits and are not a per-component accounting.

Eight active Mod instruction bodies total 65,374 UTF-8 bytes against a 65,536-byte default budget, so every row takes the full form and indexing never activates. Serialized instruction rows are 66,693 bytes; raw body budget and serialized size are distinct. Even if all packages were indexed, about 28,942 bytes of resident text would remain, and narration-craft contributes about 16,732 of them. Its resident classification is overbroad.

Consequences: large schemas and Mod prose are sent on every request regardless of need; the apply union is a measured input burden (its schema is large relative to what a typical turn needs), but this spec does not claim it is the proven cause of model semantic errors; indexing is triggered by overflow rather than relevance; and the prior index experiment reached needed-section recall of only 0.69, largely because host actions were not evident in player words. Current before_apply and before_resolve triggers supply instructions only on the request after a call, too late to shape the first action.

Duplicate instruction removal is not claimed as a saving: the brief carries instructions once and the outgoing capsule removes its copy, and no same-request duplication was found. Of the slowest turn's roughly 211 seconds, 185.7 seconds were main model calls; historical query wait (11.6 s) and admission (7.9 s) are context only. Historical query timeout and the upstream 37.8-second model-event silence are out of scope.

## Solution

Replace the all-tools and whole-instruction default with turn-scoped capability and schema discovery integrated into the existing hybrid RunDriver, context assembly, Jev decision port, Mod catalogue and section read, and canonical dispatcher. There is no second executor and no new autonomous loop.

Five parts:

1. **Semantic capability split.** Tool definitions are split into semantic fragments, including subuses within the npc and object effects. The canonical seven-verb contract is unchanged; in hybrid mode resolve stays host-owned. In version 1, selected fragments are projected under canonical names, notably a narrowed apply effects union, with no model-visible aliases that commit independently.
2. **Versioned catalogues.** Capability and Mod catalogues hold index cards: semantic name, owner and version, authored category, applicability summary, exclusions, state requirements, dependencies, and an immutable reference to detail or schema.
3. **Two-stage selection.** Stage A is one batched Jev relevance decision over index cards and a slim context. Stage B fetches candidate detail through host interfaces and asks independent per-candidate questions where applicability is still semantic. The host, not Jev, enumerates dependencies and mandatory sections.
4. **Readiness and expansion.** Intended operations from the existing compile and host plan seed necessary fragments and sections before the first relevant Keeper inference. A call revealing a missed purpose is held before any mutation and returns a structured expansion naming the missing capability; the Keeper re-decides through the ordinary loop.
5. **Index-first Mod loading with bounded fallback.** Packages declaring the new index contract load index-first; bulky situational prose moves into authored sections. Coverage failures widen only the affected family or fall back explicitly to the current whole view for the bound request, and every fallback is counted.

The Keeper always sees a small semantic core of non-negotiable rules and a compact discovery entry. A selected set controls visibility only; it is not authorization or proof of legality. Authorization, arithmetic, state, and receipts stay with existing kernel and host owners.

## User Stories

1. As a player, I want a turn that only asks about the world to skip the write capabilities it does not need, so that the response starts sooner.
2. As a player, I want a mixed action (time, scene, NPC) to commit as one transaction, so that a partial failure never leaves the world half-changed.
3. As a player, I want a rarely used capability such as a document or money effect to be available even when my words do not name it, so that the action I intend is not lost.
4. As a player, I want a capability discovered mid-turn to be recovered before any state changes, so that no half-applied action reaches the world.
5. As a Keeper, I want to call a compact discovery entry with a semantic name or purpose query, so that I can find what I need without echoing opaque identifiers.
6. As a Keeper, I want the non-negotiable rules visible on every request, so that discovery can never hide a rule from me.
7. As a Keeper, I want a refused batch to name the exact invalid effect, so that I can resend a valid batch without guessing.
8. As a Keeper, I want an expansion result to name the missing capability precisely, so that I can re-decide with the right material.
9. As a designer, I want each Mod to publish instruction cards with validated references to existing capabilities, dependencies and applicability, so that the selector can judge relevance cheaply without granting write authority.
10. As a Mod author, I want to move bulky situational prose into sections whose full detail is retained, so that the resident text stays small without losing rules.
11. As a Mod author, I want new or unknown categories to stay discoverable without editing a code classifier, so that my package is not hidden by an outdated taxonomy.
12. As a Mod author, I want resident text to be genuinely unconditional and brief, with shared invariants owned once, so that nothing is duplicated across packages.
13. As an operator, I want a disabled Mod or wrong catalogue epoch never used on any request, so that I can trust what the Keeper was shown.
14. As an operator, I want existing saves and locked Mod versions to remain readable without silent upgrade, so that play history stays reproducible.
15. As an operator, I want a legacy unsectioned package to stay full and be labelled legacy-full, so that savings are not inflated by it.
16. As an operator, I want a fresh indexed package to use index-first only after rollout gates pass, so that a default change is backed by evidence.
17. As an operator, I want every fallback to the full view recorded with its byte cost, so that selective success is never overstated.
18. As an operator, I want a slow or unavailable selector bounded by the existing first-wait and decision lifecycle, so that a turn cannot stall indefinitely.
19. As an operator, I want a slow selector not to add a fixed wait to every model call in a turn, so that latency stays predictable.
20. As an operator, I want resume, fork and restore to recompute visibility and never restore obsolete instructions from transcript checkpoints, so that stale rules do not return.
21. As a developer, I want the projection observable through the public request projection, so that I can verify what the provider receives.
22. As a developer, I want telemetry to report selected versions, reasons, byte breakdowns, provider tokens and waiting time, so that I can diagnose selection decisions.
23. As a developer, I want held-out cases pre-registered and reported per family with sample counts, so that accuracy claims are not tuned on the test set.
24. As a release owner, I want the default to change only if median end-to-end latency improves and p95 does not materially regress, so that a rollout never trades away responsiveness.

## Implementation Decisions

**Capability split.** The apply definition is decomposed by effect family, with separate fragments for the npc and object subuses. Each fragment keeps the exact types, required fields and constraints of its canonical validator. A request's projected schema is the union of its selected fragments under the canonical apply name, generated from the same definitions and never relaxing constraints. Common transaction narration shape stays usable. Description-only fixes that keep the whole union are insufficient.

**Mixed batches.** A time, scene and npc batch remains one canonical apply transaction with all-or-nothing validation and normal idempotency. Any invalid effect refuses the whole batch and writes nothing. Observed activity is never overwritten by an inferred one. Recovery from a refused or conflicting batch must either preserve the recorded evidence or record a genuinely supported transition through the normal established/observed path. A chosen action is never automatically deleted, and no basis is promoted to force acceptance.

**Capability catalogue.** Core schema fragments are host-owned and derived from the canonical definitions. Mod authors publish instruction descriptors with validated capability references; they cannot override validators and cannot grant core write authority. Authoring and install reject dangling references, dependency cycles and changed bytes under the same version. Entries carry a semantic name, owner and version, authored and validated category and type, short applicability summary, exclusions, state requirements, dependencies, and an immutable detail or schema reference. Instruction detail carries applicability scope and version, and host retrieval resolves the exact frozen text. Multiple capabilities and packages may be selected together. The host may deterministically exclude a capability illegal in the current phase; it never infers meaning from regular expressions over player text. Category scores never permanently hide unclassified entries or unknown future Mods; new unknown categories remain in the broad or uncertain discovery path.

**Mod catalogue and sections.** A Mod declares an index contract version. Under that contract it supplies index cards for sections and a resident set limited to unconditional brief text, with shared invariants owned once. Mods reference validated existing capabilities and author instruction cards; they do not add core write authority. Bulky situational prose becomes authored sections read whole through the existing immutable section-read path. Topic tags are first-stage hints; detailed section applicability participates in verification. Budgets guide authoring and selection; they never silently truncate sentences or delete required rules. If mandatory material cannot fit, capacity is surfaced explicitly or an adequate wider view is used, and that is never reported as success.

**Selector stages.** Stage A is one batched Jev decision over index cards and a slim context (player input, current scene and people, canonical time and state, and available compile features). Noul emits independent relevance and fit probabilities per candidate; these are not free-form answers. The host derives selected, none, uncertain, unavailable or read-more outcomes from versioned policy. Only genuinely exclusive control questions may use a Choice; no single winning capability is selected. There is no hard top-k cut that could silently drop a required item. Mandatory state and host conditions are included without selection. Large catalogues are split into stable category partitions and bounded batches; the whole capsule is never sent to Jev. Stage B is conditional on semantic ambiguity: it fetches candidate detail through host interfaces and asks independent per-candidate questions only where applicability is still semantic. It never re-asks deterministic dependencies, which the host enumerates. Jev never writes text, executes a call, invents an identifier, or authorizes an action. Existing calibrated decision infrastructure is reused. Results bind to campaign, worldline, loop, turn, input and source versions; stale or cross-campaign answers are rejected. Thresholds are versioned and calibrated on held-out cases, not claimed as established accuracy.

**Discovery entry.** The existing lookup surface gains a capability and instruction discovery kind accepting a semantic name or purpose query. The host returns detail and expands the next request through the same catalogue. Relevance exclusion is never permanent inaccessibility. Host-owned rule, receipt and consequence prerequisites bypass optional scoring. No fixed time-of-day NPC schedule and no scenario keyword routing are introduced.

**Readiness and expansion.** Intended operations from the existing compile and host plan seed their schema fragments and sections before the first relevant Keeper inference. If a call reveals a missed purpose, it is held before any mutation, the detail is loaded, and a structured expansion names the exact missing capability. Partial batches never execute, inferred never silently becomes observed, and mutating calls are never replayed automatically. The Keeper re-decides through the ordinary loop. The readiness gate is scoped to the absence of REQUIRED capability or detail, not optional stylistic advice, so merely missing optional prose does not block a valid action. Mutating batches still hold atomically before first execution when required material is absent. Loaded detailed instruction is distinct from an exact proof that the Keeper understood it; semantic use is a live acceptance concern. A discovery load is read-only and never implicitly authorizes subsequent writes. Expansion for the same bound request is deduplicated; after one failed expansion the documented wider safe view or existing explicit failure path is used, never an unbounded retry. Negative or error outcomes are never counted as successful actions. Coverage recovery is distinct from parameter errors and network retries.

**Activation and compatibility.** Index-first applies to packages declaring the compatible index contract; budget overflow is no longer the activation condition. Locked Mod bytes, versions and saves remain readable. Changing section metadata or resident membership requires a new package version; locks are never silently upgraded. Legacy or incompatible packages stay full and are labelled legacy-full. The Daily Life advice channel is preserved and, where safe, shares selection facts and dependencies rather than being duplicated or made mandatory clock logic. Restore, fork and refresh recompute bound visibility and never restore obsolete instructions from transcript checkpoints.

**Request projection.** Projection acceptance means only the selected manifest's schemas, or an explicitly recorded full fallback. The same validation and dispatch routes apply to alias-free fragment projection. The existing public context-with-system, request-projection and active-tool interfaces are reused. The first host-triggered request, later requests, restore, error paths and fallback must each be shown, by captured provider request, to match their selected or explicit fallback manifest. The narrator-only design kept full schemas to avoid checkpoint churn; that constraint is measured, not removed. No direct agent-state mutation, no edits to dependencies, no new Pi patch, and no dependency change. Schema registration, dispatch capability inventory and historical transcript records remain canonical. Each operation keeps exactly one execution adapter.

**Selector lifecycle.** Both selector stages reserve from the existing run allowance rather than creating fresh per-call budgets. Results, including in-flight ones, are cached by epoch; repeated model calls in an unchanged epoch do not restart waits. Material changes invalidate only the affected decisions and never silently reset the spent budget. Turn-local expansion does not accumulate selected bodies across closed turns; the next turn rebuilds a bounded view from current versions and state.

**Cache and lifecycle.** Catalogue versions, order and the core are stable. Within a turn the selected set normally only expands; reevaluation occurs after material state change. Cross-turn reuse is keyed by relevant state and package and schema versions. Raw evidence stays append-only; transport projections are ephemeral and recorded by manifest and digest rather than another full declaration per step. Append-only messages do not guarantee prompt-cache preservation, since providers may prefix tool definitions; cache-read and uncached tokens are measured. Native Anthropic deferred tool references are precedent only and are not assumed to work on Grok. The existing Grok conversation cache routing header is not proposed as a missing fix.

**Failure handling.** No silent omission. A deterministic required section and a still-compatible previous selection may be reused when justified. Otherwise the affected family widens, or the bound request falls back explicitly to the current whole view when coverage cannot be established. Every fallback and its bytes are counted and excluded from claimed selective success. The existing bounded first-wait and decision lifecycle is reused; no unbounded critical-path wait is added. In-flight selector work is cached within the epoch, cancelled on replacement or shutdown, and its actual waiting is recorded.

**Telemetry.** Existing request, run and mod-sections lanes gain catalogue and selected versions; mandatory, relevance, dependency and fallback reasons; byte breakdowns by system prose, tool schema, Mod resident text, selected sections, current state and history; actual provider delivery; selector and awaited durations; cache-read and uncached tokens; schema and section misses; expansion round trips; canonical refusals; and player-visible first and final delivery timing. Credentials are never logged. Raw logging is not promoted to default. Selection counters are never fed to the Keeper as obligations.

**Writer, reader and actor map.** Each row names the existing owning module and its observable output. This is a specification interface, not new process machinery.

| Stage | Writer | Reader | Actor | Observable output |
|---|---|---|---|---|
| Catalogue | Core capability owner, package authoring and install validation | Selector and host detail retrieval | Host resolves selected immutable detail | Index cards and detail references by version |
| Selection | Host policy binding Jev answers and deterministic dependencies | Projection assembly | Context owner assembles the current view | Bound selected manifest with dependency reasons |
| Provider view | Host context assembly | Keeper through the provider request | Keeper chooses supported calls or discovery | Captured request matching the selected or explicit full fallback manifest |
| Expansion | Canonical dispatcher readiness check | Keeper ordinary loop | Keeper re-decides after required detail is available | Structured missing-capability result with no-commit meaning |
| Receipt | Canonical kernel transaction | Context projection, history and telemetry | Keeper narrates the recorded outcome | Existing gameplay receipts; selection and fallback metadata remain separate telemetry |

**Proposed interface semantics** (names are semantic; hashes stay host-owned; no new executors):

| Interface | Fields |
|---|---|
| Index card | capability or section name, owner, version, category, applicability summary, exclusions, state requirements, dependencies, detail reference |
| Detail result | name, version, applicability scope, frozen text, required flag, deterministic reason |
| Selected manifest | campaign, worldline, loop, turn, bound epoch, selected items, dependency reasons, fallback flag and bytes |
| Discovery input | semantic name or purpose query; the host supplies the bound epoch, never the model (read-only) |
| Discovery output | matched index cards and detail results (read-only; authorizes no write) |
| Readiness expansion status | requested, loaded, missing capability name, no-commit flag (no world mutation or committed gameplay receipt; diagnostics remain recorded) |

**Responsibilities.** Catalogues are written by package authoring, validated at load and read by the selector. The selector writes bound selected-detail results, which the projection reads. Host context assembly writes each request's projection, which the provider reads. Execution happens only through the canonical dispatcher's one adapter per operation, and every effect is recorded in existing receipts.

**SQLite compatibility decision.** Source queue and module metadata are managed by the source-reading SQLite owner through ModuleStore and sourceMetadata. Static Mod packages and tool definitions, and campaign transactions, remain with their existing owners. SQL exports are not authority. Imported scopes never fall back to stale JSON after a DB error; the failure is explicit. Selection binds a coherent source-scope snapshot and keeps four versions distinct: storage revision, published generation and digest, catalogue and package versions, and input epoch. Unrelated background queue writes must not invalidate all selections; only changes to the bound scope invalidate affected decisions. The selector fetches a snapshot and releases any DB transaction before Jev or model work, then validates the relevant versions after async completion. Storage and lock waiting count toward the shared preparation deadline. The current migration uses synchronous node:sqlite with busy_timeout 25000, a potential budget issue rather than a measured stall. Read-only tests operate on bootstrapped scopes and compare logical SQL state, not volatile WAL bytes. Both modes are benchmarked on identical SQLite runtime, state and locks. The source migration originated at ddff2f931 and was integrated by its owner through039b9ffaa; implementation consumes its published ModuleStore/sourceMetadata interfaces and does not add another source authority.

**SQLite regression requirements.** A DB error in an imported scope must fail explicitly and never read stale JSON. A selection bound to one scope snapshot must be rejected if the relevant generation or digest changed after async completion. An unrelated queue write must not invalidate unrelated selections. A DB transaction must not be held across Jev or model work. Storage lock waiting must be included in the preparation deadline and produce a bounded explicit outcome when exceeded. Logical SQL state, not WAL bytes, is compared in read-only tests.

## Testing Decisions

Tests use the highest existing seam: real provider-request capture from normal host context assembly, followed by ordinary dispatcher and kernel receipts. Small deterministic tests cover schema dependency, atomicity and idempotency, but do not substitute for captured requests or live Keeper proof.

**Held-out evaluation.** Tuning and held-out cases are pre-registered and disjoint. The held-out set has at least 60 inputs spanning waiting, day and night transitions, travel, NPC dialogue and awakening, objects, documents and money, investigation, combat and specialized rules, out-of-character and no-match inputs, mixed actions, failures and legacy Mods. Cases capture ordinary future capability use, not only keywords in the sentence. Recall is reported per family with missing-item cases.

**Release gates (proposed criteria, not measured results).** All deterministic mandatory items are present before execution; zero required capability or section omissions remain unresolved after recovery; no unauthorized or partial write occurs; optional first-pass recall is at least 0.95 overall and at least 0.90 in each adequately sampled family, with exact denominators; under healthy configured Jev on routine traffic, at most 5 percent of requests need a discovery-repair Keeper round and at most 5 percent fall back to the whole view. Forced-outage tests are reported separately. Median provider rounds per completed objective must not increase, and median end-to-end latency must improve with no material p95 regression, with the p95 tolerance pre-registered before any live comparison. A missed-capability rate is not a failure by itself, since controlled recovery and first-pass recall below 1 are designed in. There are zero unresolved gameplay blockers in live cases.

**Comparison.** Selective and forced-full runs use identical state and identical new package locks, so package text changes are not attributed to selection. The original ca51d7dfc production baseline is reported separately for migration impact. Canonical branch tool and output constraints remain identical.

**Byte targets** on paired captured fixtures with identical state and locks: median selected tool-schema plus Mod instruction bytes at most 50 percent of the full baseline; median total request bytes at most 65 percent of baseline. There is no universal hard token cap and no promised latency number. Cold, warm and reload runs are measured separately; provider total, cached and uncached tokens are reported distinctly.

**Latency targets.** Discovery selection plus detail fetch: p50 at most 800 ms and p95 at most 2000 ms. Keeper inference time is excluded from these selector targets. Actual blocking time and all added Keeper requests are measured separately and included in end-to-end totals. Default enablement requires a measured end-to-end median improvement with no material p95 regression, with repetitions, sample counts and provider variability reported. A byte-only win does not pass; coverage, recovery frequency and provider-round gates above must also pass.

**Required regression cases.** A full schema still reaching the provider through a system checkpoint despite a selective manifest must fail. A wrong catalogue epoch or disabled Mod in use must fail. An invalid effect in a mixed batch rolls back all effects. Observed activity is never overwritten by inferred. A hidden capability is recovered before its first mutation. First and later calls each receive their requisite instructions. No-Jev, slow-Jev and invalid-answer cases end in bounded, explicit outcomes. No-match inputs are handled. Unclassified topics and sections remain discoverable. Changed NPC, scene or time updates selection. Version upgrade and legacy lock are handled without silent change. Resume and fork recompute visibility. Overflow behaves as specified. Prompt-cache drift is measured. Text coverage and rules are preserved; no text is shortened to meet a count.

**Live acceptance.** Source tests and builds run on the LAN box when available; live models and the GUI stay on the Mac. Comparisons use explicit Grok 4.7 low and Haiku 5.5 thinking-off settings, with no silent switching. Acceptance uses the approved real web GUI or canonical driver, with the root as sole natural player; scripted Keepers are never labelled gameplay. Meaningful objectives continue; no fixed turn count is proof. Coverage includes day, night and morning, an NPC interaction, a mixed world-state action and a surprise capability requiring discovery. All campaign and evidence data is preserved. Native App and package acceptance is a separate gate, required only if packaging is later authorized.

## Out of Scope

- Fixing the Historical Reference six-second query timeout.
- Changing Keeper, provider or model defaults.
- Finding the upstream stall behind the 37.8-second model-event silence.
- Replacing the RunDriver.
- Changing game rules, transactions or the world scheduler.
- A broad PDF reader or memory redesign.
- Packaging or deployment.
- Whole-scenario completion claims.
- New workers or chats.
- Unrelated prompt or style rewrites.

Moving capability-specific instructions into the same selected-detail owner is in scope; removing core invariants is not.

## Further Notes

Related issue #110 owns Historical Reference; its six-second query writer issue remains outside this spec. The historical 0.69 replay result motivates held-out coverage work. This spec claims no new accuracy or latency result. Native App and full package acceptance are not required before packaging is authorized.

Implementation sequence (all checkboxes unchecked):

- [ ] Public-seam feasibility, contract amendment and baseline measurements.
- [ ] Versioned capability and Mod catalogues.
- [ ] Two-stage selection, readiness and fallback.
- [ ] Request projection and dispatch parity.
- [ ] New Mod versions and held-out gates.
- [ ] Live cold and warm measurements and controlled default rollout.

Source evidence and references:

- `docs/specs/mod-section-index.md`: superseded prototype numbers and the implemented overflow-only policy; historical results kept intact.
- `docs/pi-host-contract.md`: current public projection and canonical transcript guarantees.
- `docs/specs/jev-decides-llm-writes-tickets/06-narrator-only-setting.md`: full schemas kept to avoid checkpoint and cache churn.
- `docs/specs/jev-decides-llm-writes-tickets/07-setup-driven-engine.md`: public per-step projection precedent.
- `CONTEXT.md`: decision boundary, object instance, object usage and usage profile.
- Evidence directory (link only): `/Users/haoli/leehow/code/chatrpgv4-research/reports/handoff-20261008/temporal-world-implementation-20261009/gui-evidence/acceptance.json`.

Prior art (bounded summaries):

- https://docs.typesafe.ai/cookbooks/skill_suggestion: a 182-skill short index, shortlisted detail read and verified in a second stage, with at most one skill in that example. This project needs multiple independent capabilities, deterministic requirements and rollback safety, so it does not copy the single-winner policy or its accuracy claims.
- https://docs.typesafe.ai/patterns/fan-out: independent closed questions in one request, with a dependent second stage only after detail arrives.
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool: deferred discovery expands only selected definitions into context over a small always-loaded surface. Provider wire protocol and server-side catalogue differ from the Grok host projection.
- https://docs.x.ai/developers/advanced-api-usage/prompt-caching/how-it-works: exact prefix caching can be evicted or routed differently, so measured cache behaviour is required rather than assumed.
