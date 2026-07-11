# Diagnosis Ledger

**As of:** 2026-07-12
**Scope:** the two user-provided architecture/release reviews that initiated the
full-hardening blueprint. This is the terminal classification; the reviews are
historical snapshots, not current instructions.

| Original claim | Current classification | Root cause | Fix/evidence | Acceptance ID |
|---|---|---|---|---|
| Canonical single-track plugin architecture is established | RESOLVED | Accurate positive finding | `plugins/coc-keeper/` remains canonical; metadata/single-track tests | A05, A06 |
| Structured-state/Semantic Matcher Constitution is established | RESOLVED | Accurate positive finding | repository constitution plus structured intent, affinity, lifecycle and audit regressions | A18, A21, A25 |
| The Haunting and White War provide practical starter content | RESOLVED | Accurate positive finding, but rights certainty was overstated | starter installation tests; rights remain explicitly `UNVERIFIED` | A02, A05 |
| Atomic state writes and a migration framework exist | RESOLVED | Accurate positive finding | atomic file I/O, typed gateway, corruption backup and production v1→v2 migration tests | A28, A29 |
| Player/Narrator bridges have appropriate responsibility separation | RESOLVED | Accurate architecture finding; lifecycle/performance was incomplete | explicit composition, safe envelopes and reusable workers | A25, A30-A32 |
| Rulebook extraction caches were tracked and publish-risky | REAL_DEFECT → RESOLVED | Generated source material was committed and ignore rules were incomplete | caches removed from HEAD/ignored; content inventory records unresolved rights | A01, A02 |
| Git history may require `filter-repo` | UNVERIFIED / NON-GOAL | Repository review could establish HEAD state, not make a legal necessity determination | no history rewrite; rights/history decision remains external | A02 |
| The Haunting redistribution basis needs explicit review | UNVERIFIED | Repository contained no conclusive rights evidence | `CONTENT_LICENSES.md` records `UNVERIFIED`; no legal claim is made | A02 |
| `dying` was treated as immediate death in live match | REAL_DEFECT → RESOLVED | Harness collapsed distinct investigator outcome states | live rescue/death-clock flow and end-to-end injury tests distinguish dying, unconscious, stabilized and dead | A07, A14 |
| Terminal detection used the last scene array element | REAL_DEFECT → RESOLVED | Legacy linear ordering leaked into a graph-aware product path | structured graph/session terminal evidence, including non-last terminal regression | A08 |
| `--live` plus an arbitrary fake runner could manufacture gameplay evidence | TEST_ENSHRINES_DEFECT → RESOLVED | Caller-controlled metadata was treated as provenance; old tests accepted it | generated receipt, pinned runner identity/hash and spoof/tamper rejection | A09, A10 |
| `brain=pi` was only an expensive proxy to debug | MISLEADING_NAME_OR_METADATA → RESOLVED | A single `brain` label hid planner/rules/narrator/player composition | v2 resolved pipeline, legacy warning/migration, Pi constrained to safe narrator/player roles | A30 |
| CI covered only Python 3.11/pytest and omitted the product surface | REAL_DEFECT → RESOLVED | Workflow predated Node adapters, dependency declarations and product lifecycle | Python matrix, plugin, Node adapter and product jobs with lockfiles/dependencies | A03, A04, A33 |
| Ruff/type checking/audit/coverage should be added | UNVERIFIED / NON-GOAL | These were recommendations, not demonstrated correctness defects or approved acceptance criteria | current gates prioritize executable product contracts; no unsupported claim of those tools | A33 |
| Documentation contradicted current starter count and completed plans | STALE_DOCUMENT → RESOLVED | Historical audit/plan prose was mistaken for live status and current files were not mechanically aligned | authoritative `CURRENT.md`, consistency tests, historical banners and this ledger | A05, A34 |
| Version metadata regressed and disagreed across hosts | MISLEADING_NAME_OR_METADATA → RESOLVED | tag chronology and manifest SemVer had diverged | manifests agree on `0.16.0-alpha.1`; release tag intentionally not created | A05, A06 |
| Runtime sessions lacked locks, TTL, close and restart recovery | REAL_DEFECT → RESOLVED | initial open-runtime registry was deliberately minimal | locked registry, TTL/tombstones, close, durable sanitized snapshots and recovery | A27 |
| Runtime IDs and paths allowed traversal/symlink escape | REAL_DEFECT → RESOLVED | IDs were interpolated before a shared containment boundary existed | conservative IDs plus pre/post-create realpath and symlink containment gates | A26 |
| PublicState silently replaced corrupt JSON with defaults | REAL_DEFECT → RESOLVED | PublicState bypassed the typed state gateway | corruption backup, typed health/recovery projection and exact schema checks | A28 |
| Migration existed only as an empty framework | PARTIAL_WIRING → RESOLVED | API shape had no production migration proving it | world-state v1→v2 round trip, exact schema validation and forward-version rejection | A29 |
| Player, Narrator and Pi spawned a process/session per turn | REAL_DEFECT → RESOLVED | one-shot adapters were the initial compatibility implementation and the first pool implementation was not wired into canonical SDK sessions | canonical Pi narration now passes a session/campaign/match/role+runner scoped JSONL pool; close/expiry retire scopes; isolation/reuse/crash/timeout tests | A31 |
| Runtime lacked per-turn performance telemetry | REAL_DEFECT → RESOLVED | no stable privacy-safe receipt contract existed | phase/model latency, tokens, fallback and runner telemetry; persistence/reload tests | A32 |
| SAN was only a point-loss check; no madness model | PARTIAL_WIRING → RESOLVED | standalone SAN pieces existed before the canonical live continuation was complete | typed bouts, involuntary action, pending Keeper choices and multi-turn live regressions | A12 |
| Idea Roll was absent | STALE_DOCUMENT → RESOLVED | the review predated the signpost-aware recovery implementation | free/Regular/Extreme INT recovery with structured costs and live coverage | A11-A13 |
| Pushed Roll was absent | PARTIAL_WIRING → RESOLVED | failure consequences existed, but offer/confirm/reroll was not live/resumable | canonical origin receipts, typed offer/confirm/cancel/resolve and replay-safe consequence | A13 |
| Combat lacked Major Wound, unconscious/dying and Dodge/Fight Back | PARTIAL_WIRING → RESOLVED | standalone combat tests were initially mistaken for product-path integration | live defense, damage/wound, dying/rescue and Fight Back damage regressions | A14, A15 |
| Chase was only narration / absent as a rules subsystem | PARTIAL_WIRING → RESOLVED | an engine existed without complete canonical live wiring | live start/move/hazard/barrier/combat receipt/end persistence journey | A16 |
| Director lacked a scene-purpose model | REAL_DEFECT → RESOLVED | scene type/dramatic question did not provide a normalized six-field function | compile/runtime `scene_function`, goals, reveals, failures, exits and affinities | A19 |
| NPCs lacked active agendas and persistent effects | PARTIAL_WIRING → RESOLVED | authored agendas existed, but ordinary live turns did not reliably consume persisted agency state | live NPC effects, affinity, relationship and schedule state | A20, A21 |
| NPC disclosure lacked knowledge/trust/lie/schedule gates | REAL_DEFECT → RESOLVED | narrator-facing social channels could precede canonical disclosure decisions | exact request/result binding, structured gates and zero-decision privacy tests | A21, A25 |
| Faction clocks did not make persisted pressure active | PARTIAL_WIRING → RESOLVED | Director used authored fronts while persisted progress could be ignored | merged threat state, structured selection affinities/reasons and receipt-backed effects | A17, A18 |
| Investigation and crisis used one undifferentiated rendering loop | REAL_DEFECT → RESOLVED | crisis-frame builder existed but production dispatch did not require it | explicit render modes and production seven-slot crisis frame | A22 |
| All scenario types shared one weight table; time-loop/multi-faction mechanics were absent | REAL_DEFECT → RESOLVED | `structure_type` was metadata rather than specialized state strategy | explicit time-loop and multi-faction strategy state/capability findings | A23 |
| Horror narration lacked sensory-first/unknown-information controls | PARTIAL_WIRING → RESOLVED | envelope and secrets existed, but final production rendering/audit was not fully bound | bounded horror profile, render contracts, minimum-privilege envelope and final audit | A24, A25 |
| Horror style profiles were absent | REAL_DEFECT → RESOLVED | tone tags did not form a bounded narrator contract | seven-axis structured horror profile reaches Narrator without secret prose | A24 |
| NPC dialogue could not hide, lie, deflect or gate facts | PARTIAL_WIRING → RESOLVED | agenda data existed but conversation state was incomplete | knowledge/willingness/lie/schedule rules and persisted social decisions | A20, A21 |
| Existing tests proved standalone components but not `run_live_turn` wiring | TEST_GAP → RESOLVED | injected results and subsystem unit tests were overinterpreted as product evidence | canonical live SAN/push/combat/chase/social suites plus `test_product_smoke.py` | A07-A25, A33 |
| Full-suite counts in documents were not evidence for latest HEAD | STALE_DOCUMENT → RESOLVED | historical self-reported counts had no terminal validation binding | Task 15 reruns focused/full/Node/adversarial gates and records exact results | A33 |
| Extreme-cold quick observation inherited a 20-minute room-search duration | REAL_DEFECT → RESOLVED | action defaults overrode structured intent detail | White War live regression proves quick observation stays at most five minutes | A11 |
| SDK exceptions should always become structured error Events | PARTIAL / EXPLICIT NON-GOAL FOR V1 | expected state-health failures are projected structurally, but programmer misuse and unknown/closed sessions intentionally retain typed Python exceptions | `UnknownSessionError.kind`, PublicState `state_health`; no claim that every exception is an Event | A27, A28 |
| Codex, Claude Code and Cursor all need install/activation smoke evidence | PARTIAL / REAL-HOST INSTALL NOT PERFORMED | initial review predated thin-host manifests; repository metadata tests do not prove installation inside three real host applications | Codex/Claude/Cursor manifests, marketplace and thin-entry contracts pass, but actual host installation smoke remains blocked/not performed in this local gate | A04-A06 |
| Incremental context/deepcopy and p50/p95 latency needed proof | PARTIAL / OUTSIDE A01-A34 | cache isolation uses defensive deep copies and per-turn telemetry exists; statistically meaningful p50/p95 requires an external runner/workload | cache tests and A32 receipts; no fabricated performance percentile claim | A32 |
| Contacts remains a rules backlog item | UNVERIFIED / APPROVED NON-GOAL | full hardening targeted live-path correctness, not every optional/rules-depth backlog item | structured contact difficulty helper exists, but no claim of a complete Contacts subsystem | A33, A34 |
| Training and in-play Aging remain backlog items | UNVERIFIED / APPROVED NON-GOAL | not part of A01-A34; creation aging and development are separate existing surfaces | explicitly retained as future rule-depth scope | A33, A34 |
| Credit Rating daily spending/overspend/employment review remains backlog | UNVERIFIED / APPROVED NON-GOAL | creation finances and social CR use do not equal a complete campaign-economy subsystem | current tests cover finance derivation/social use only; no completion claim | A33, A34 |
| Public combined/opposed API and physical-limit rules remain incomplete | PARTIAL / APPROVED NON-GOAL | structured tables and combat resolution exist, but the requested universal public API was not an A01-A34 requirement | combined/opposed rule tests; future API consolidation remains separate | A33, A34 |
| Optional Combat Spot Rules are missing | UNVERIFIED / APPROVED NON-GOAL | optional knock-out/location/DEX-roll variants were explicitly left in the rule-depth backlog | core combat acceptance is A14-A15; optional variants are not silently called complete | A14, A15, A34 |
| A real 10–20-turn external-model journey is available | UNVERIFIED / BLOCKED EXTERNALLY | no credentialed external runner evidence is present in the repository | deterministic smoke is explicitly `NON-GAMEPLAY`; no synthetic artifact is called a battle report | A09, A10, A33 |
| PDF-derived epistemic facts lacked page/hash provenance | REAL_DEFECT → RESOLVED | the original scenario compiler consumed Markdown without a source-evidence bridge | page map, source/text hashes, parser manifest, anchor/range and confidence gates | A33, A34 |
| Epistemic meaning could be deterministically guessed when semantic results were absent | REAL_DEFECT → RESOLVED | no artifact-mediated evaluator contract existed | request/result SHA binding, evaluator/staleness checks and fail-closed install | A33, A34 |
| A clue could update only one cognitive question | REAL_DEFECT → RESOLVED | v1 contract encoded one mode/target | schema-v2 independent effects; unready REFRAME holds without suppressing ready effects | A33, A34 |
| Question open/close state depended on inferred narrative meaning | REAL_DEFECT → RESOLVED | lifecycle conditions were not explicit structured contracts | clue/evidence/flag/scene/payoff/explicit lifecycle reducer | A33, A34 |
| Storylets could invent or reframe truth without compiled setup | REAL_DEFECT → RESOLVED | generic storylets lacked epistemic eligibility constraints | cognitive storylet tags and reveal-contract/setup gates | A25, A33 |
| Narrator might receive truth/source/compiler-secret material | REAL_DEFECT → RESOLVED | epistemic state had no dedicated least-privilege projection | player-safe question/effect projection; secret/truth/source/reason exclusion tests | A25, A33 |
| Reports lacked cognitive narrative metrics | REAL_DEFECT → RESOLVED | belief events did not carry replayable metric inputs | eight structured metrics and conditional report section | A10, A33 |

## Why the misdiagnoses happened

The incorrect or obsolete conclusions were not random. They came from four
repeatable documentation/evidence failures: historical plans looked current;
standalone engines looked equivalent to canonical live wiring; tests asserted
caller-controlled or injected behavior; and metadata names (`live`, `brain=pi`)
promised more than their implementation guaranteed. The hardening initiative
therefore repaired both the product and the evidence model used to describe it.

## A01–A34 current acceptance status

| Acceptance | Status | Terminal evidence |
|---|---|---|
| A01–A06 | Done | tracked-cache/content/CI/metadata/consistency gates |
| A07–A10 | Done | live outcome/terminal and adversarial evidence receipt suites |
| A11–A16 | Done | live cold/SAN/Push/combat/Fight Back/chase journeys |
| A17–A21 | Done | persisted threat, structured selection, scene function and NPC disclosure suites |
| A22–A25 | Done | crisis/strategy/horror profile/semantic secret audit suites |
| A26–A29 | Done | containment, session lifecycle, state health and production migration suites |
| A30–A32 | Done | resolved composition, scoped worker reuse and telemetry suites |
| A33 | Review pending | local full/focused/Node/adversarial gates pass; independent terminal acceptance not yet granted |
| A34 | Review pending | all original claims are classified here; independent completeness review not yet granted |

There is no `Partial`, `Missing` or `Untested` acceptance item hidden in this
table. “Review pending” records the actual governance state rather than
pre-emptively claiming independent acceptance.
