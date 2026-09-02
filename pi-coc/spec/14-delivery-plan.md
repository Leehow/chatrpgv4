# 14 — Delivery plan

## WP-010 — Contract hardening
Generate/runtime-validate wire schemas and compatibility tests.

## WP-020 — PostgreSQL event ledger
Implement one-transaction commit, idempotency, optimistic concurrency, fork, replay, checkpoints, and outbox.

## WP-030 — Full rule-graph loader and validator
Load all 465 nodes and 1,470 edges; index domains, layers, triggers, provenance, tests, and event types. Reject duplicates, dangling refs, illegal modes, and invalid overlays.

## WP-031 — Effective rule-set compiler
Implement core/optional/era/module/campaign/house/session overlays, conflicts, scope, expiry, and version hash.

## WP-032 — Generic check family
Implement percentile thresholds, bonus/penalty dice, opposed/combined checks, push, and optional Luck with pending decisions and receipts.

## WP-033 — SAN and insanity
Implement SAN loss, temporary/indefinite/permanent insanity, bout/underlying phases, daily threshold, and recovery.

## WP-034 — Combat and wounds
Implement initiative, intents, fight back/dodge, maneuvers, firearms, damage, armor, major wounds, dying, first aid, and medicine.

## WP-035 — Chase
Implement chase setup, locations, movement actions, hazards, obstacles, vehicles, and UI events.

## WP-040 — Content graph repository
Implement Canon/Mystery/Narrative/Epistemic/Presentation access, source spans, actor views, and bounded traversal.

## WP-041 — Semi-automatic module compiler
Build layout extraction, typed claims, human review, immutable packs, and lint, beginning with an original mini-scenario.

## WP-050 — Context Capsule v1
Implement mandatory facts, relevance scoring, graph budgets, provenance manifest, secrecy proof, and token accounting.

## WP-060 — Production Pi host
Bind Pi SDK with isolated lane loaders, schemas, cancellation, receipts, retries, and no-coding-tool enforcement.

## WP-061 — Director contract
Implement intent, rule requests, consequences, time proposal, reveal selection, redirection, and validator feedback.

## WP-062 — Narrator and verifier
Implement presentation graph, frame-only prose, fact/knowledge/style audit, and bounded repair.

## WP-070 — Chronicle Kernel production path
Connect PostgreSQL, projections, rules, time, graphs, lanes, outbox, and evidence while preserving `COMMITTED_UNPUBLISHED`.

## WP-073 — Electron Keeper workstation
Implement game desk, timeline, branches, graph views, rule inspector, compiler review, and test laboratory.

## WP-080 — Evaluation
Implement evidence bundles, rule Oracle runner, invariant runner, locked traces, snapshot counterfactuals, AI-player matrix, and blind baseline comparison.

## WP-090 — Pi Core RFC, only if justified
Candidate generic changes: external-state checkpoints, typed context providers, capability-scoped tools, transactional lifecycle hooks, structured streams, and replay drivers. No CoC-specific rule belongs in Pi Core.
