# COC Keeper Full Hardening Design

**Date:** 2026-07-10  
**Status:** Approved design, pending implementation plan  
**Target:** Current `release/0.2-alpha` head and all confirmed post-`v0.2a` issues

## 1. Goal

Close the complete set of confirmed release, live-play, rules-integration,
Director, narration, runtime, evidence, performance, and documentation defects
without treating a partial milestone as completion.

The terminal outcome is a release-candidate-quality Alpha in which:

- canonical `run_live_turn` executes stateful CoC subsystems rather than only
  exposing standalone engines;
- live-match termination and gameplay evidence are derived from structured,
  verifiable facts;
- Director and Narrator consume the state they persist;
- runtime boundaries are safe and observable;
- CI exercises the supported Python, plugin, Node-adapter, and product surfaces;
- current documentation cannot be confused with historical plans; and
- every original diagnosis is classified by evidence and root cause.

## 2. Completion Policy

This is one full-scope initiative. Implementation may use independent worker
lanes, but a worker handoff, one subsystem passing, or one milestone landing is
not a completion condition.

Completion requires every acceptance item in Section 10 to be `Done`, or an
explicit user-approved deferral. No silent deferrals are allowed.

## 3. Non-Goals and Protected Boundaries

- Do not push, deploy, create a release tag, or publish a package.
- Do not rewrite Git history or remove historical blobs with `filter-repo`.
- Do not make a legal determination about redistribution rights. Record the
  repository evidence and mark unresolved rights as `UNVERIFIED`.
- Do not reintroduce a second plugin tree. `plugins/coc-keeper/` remains the
  canonical single track.
- Do not classify semantic behavior with free-text keyword lists. New
  decisions must consume structured fields or semantic-router evidence with a
  recorded reason.
- Do not replace deterministic rules adjudication with LLM-generated math.
- Do not claim a synthetic fixture or formatter sample is a gameplay battle
  report.

## 4. Diagnosis Classification

Every finding must be assigned one root-cause class in the final audit:

| Class | Meaning |
|---|---|
| `REAL_DEFECT` | Current production behavior is wrong. |
| `PARTIAL_WIRING` | A schema or standalone engine exists, but canonical live execution does not use it end to end. |
| `STALE_DOCUMENT` | The claim was once true but current code has moved on. |
| `TEST_GAP` | Tests omit the product path or only test injected/standalone state. |
| `TEST_ENSHRINES_DEFECT` | A current test asserts behavior that should be rejected. |
| `MISLEADING_NAME_OR_METADATA` | Naming or caller-controlled metadata implies stronger behavior than exists. |
| `RESOLVED` | Current production path and regression evidence both satisfy the requirement. |
| `UNVERIFIED` | Repository evidence is insufficient for a factual conclusion. |

The final audit must explain why each obsolete or incorrect diagnosis occurred,
not merely mark it false.

## 5. Architecture

### 5.1 Canonical turn pipeline

`run_live_turn` remains the only ordinary live-play entry point. Its execution
order becomes:

1. validate identifiers and paths;
2. load state through the typed state gateway;
3. resolve structured player intent;
4. build a Director context that merges authored definitions and persisted
   runtime state;
5. select a Director action and create typed subsystem commands;
6. execute commands through a stateful `SubsystemExecutor`;
7. apply state changes idempotently;
8. build a minimum-privilege narration envelope;
9. render and audit player-visible narration;
10. emit typed events, telemetry, and evidence receipts.

The executor is the sole bridge between Director requests and mutable rules
engines. It must support resumable player decisions instead of pretending that
multi-step interactions fit in one percentile roll.

### 5.2 Stateful subsystem commands

Introduce typed command/result contracts for:

- `sanity_check`, `bout_tick`, `bout_end`, and involuntary action;
- `push_offer`, `push_confirm`, and `push_resolve`;
- combat creation, attack, defense selection, damage, wound triage, dying
  clock, stabilization, and conclusion;
- chase creation, movement, hazard, barrier, conflict, escape/capture, and
  conclusion; and
- Idea Roll recovery.

Pending choices are persisted with stable IDs so the next player turn can
continue the same rule interaction. Results must update the canonical campaign
and investigator state, not only append a roll record.

### 5.3 Outcome and terminal model

Investigator state distinguishes:

- `active`;
- `unconscious`;
- `dying`;
- `stabilized`;
- `dead`;
- `temporarily_unplayable`; and
- `permanently_unplayable`.

Only `dead` or an explicit scenario/match policy may immediately end play.
`dying` enters rescue/death-clock resolution. A single unconscious investigator
does not imply campaign termination.

Scenario terminal state is derived from the existing graph-aware terminal
helper plus structured `session_ending`/ending evidence. Array position is a
legacy graph-compilation fallback only; live-match reporting must never compare
the active scene with `scenes[-1]` directly.

### 5.4 Evidence model

Replace caller-controlled evidence eligibility with a generated
`evidence.json` receipt containing:

- evidence schema version;
- player and narrator runner kinds;
- runner hashes or stable package identities;
- selected model identities when supplied by the runner;
- external-model turn counts;
- template/prose-degradation fallback counts;
- start/end timestamps;
- transcript and event-log hashes;
- validation findings; and
- computed `eligible_as_gameplay_evidence` plus reasons.

`--live` becomes a user claim only. It cannot set evidence eligibility.
Scripted or unknown runners remain ineligible even when `--live` is passed.

### 5.5 Director context and strategies

Director context merges authored threat-front definitions with
`save/threat-state.json`. Clock selection uses structured scene/front/faction
affinity and recorded reasons rather than taking the first incomplete clock.

Scenes gain a normalized function contract:

- `scene_function`;
- `goals`;
- `required_reveals`;
- `failure_modes`;
- `exit_options`; and
- `mode_affinity`.

Legacy scenes compile into this shape from existing `scene_type`,
`dramatic_question`, clues, affordances, pressure moves, and exit conditions.

`structure_type` keeps shared infrastructure but may install a strategy module
for type-specific state, including time-loop memory and multi-faction pressure.
Unsupported specialized mechanics must be explicit rather than simulated by a
weight table alone.

### 5.6 NPC agency and conversation state

NPC psychology remains structured and persistent. The live pipeline produces
typed effects for trust, fear, suspicion, known facts, lies, promises, and
relationship changes.

NPC disclosure is governed by structured knowledge and willingness evidence:

- facts known;
- facts currently revealable;
- required trust/leverage;
- lie/deflect options;
- active reaction triggers; and
- schedule/availability state.

Narration receives only the selected player-visible move and dialogue seed,
never raw secret agendas.

### 5.7 Narration and horror style

`investigation`, `social`, `pressure`, and `crisis` become explicit render
modes. Crisis mode invokes the existing crisis-frame builder in the production
path.

Horror style is a structured profile with bounded axes such as cosmic,
gothic, body horror, isolation, gore, mystery, and helplessness. Scenario tone
and content flags seed the profile; they do not directly leak hidden facts.

The output path enforces observable/sensory evidence before interpretation.
Final secret protection consumes structured forbidden-secret evidence or a
semantic audit result with reasons. It must not introduce a keyword blacklist.

### 5.8 Runtime state gateway and session registry

All runtime identifiers use a conservative allowlist and all derived paths are
resolved and checked for containment inside the workspace. Symlink escape and
`..` traversal are rejected.

The session registry adds:

- a concurrency lock;
- last-access timestamps and TTL cleanup;
- explicit close semantics;
- recoverable session metadata; and
- typed error conversion at the SDK boundary.

PublicState reads through the typed state gateway used by `coc_state`, so
corrupt files are backed up and reported instead of silently turning HP, SAN,
or scene state into empty defaults.

Land at least one real v1-to-v2 production migration and exercise load,
rewrite, forward-version rejection, corruption backup, and recovery.

### 5.9 Runtime composition and performance

Replace ambiguous `brain=pi` semantics with an explicit composition:

- deterministic planner;
- deterministic rules;
- template or Pi narrator; and
- human or Pi player for playtests.

Keep backward-compatible config migration for existing `brain` values.

Player, narrator, and Pi adapters gain a reusable worker/session transport.
A one-shot compatibility mode may remain, but ordinary multi-turn use must not
create a fresh Node process and agent session on every turn.

Emit per-turn structured telemetry for intent, Director, rules, persistence,
player model, narrator model, total latency, token counts when available, and
fallback status. Define deterministic tests for telemetry shape and process
reuse; performance thresholds must tolerate CI variance.

### 5.10 Release and documentation governance

- Remove tracked rulebook extraction caches from HEAD and ignore their local
  regeneration paths.
- Add `CONTENT_LICENSES.md` covering scenarios, rule data, images, generated
  extracts, and third-party packages. Use `UNVERIFIED` where evidence is
  incomplete.
- Keep historical extraction removal separate from Git-history rewriting.
- Make one current-status document authoritative. Historical plans receive a
  prominent non-executable banner.
- Update README starter counts, CHANGELOG state, known issues, runtime wording,
  and test commands.
- Restore monotonic SemVer by moving manifests and marketplace metadata to
  `0.16.0-alpha.1`; do not create a tag in this initiative.

## 6. CI and Validation Design

CI is split into independently diagnosable jobs:

1. Python 3.11, 3.12, and 3.13 test matrix with declared dependencies.
2. Plugin and marketplace metadata/single-track validation.
3. Node adapter install and contract tests for player, narrator, and Pi.
4. Schema/static checks and documentation/version consistency.
5. Product smoke: quick start, live turns, save, close/reload, resume, and
   continued play.

Required local validation before completion:

- full Python suite;
- plugin metadata minimum required by `AGENTS.md`;
- Node adapter contract checks;
- new subsystem end-to-end tests through `run_live_turn`;
- adversarial path, corruption, evidence-spoofing, and secret-boundary tests;
- starter scenario compilation and graph reachability; and
- one evidence-grade 10-to-20-turn live playtest when a real external model
  runner is available.

If external model credentials are unavailable, the live playtest item is
`Blocked`, not silently replaced with a scripted fixture.

## 7. Worker Ownership Model

Use Codex built-in subagents with disjoint ownership and explicit handoffs.
Suggested lanes are:

- release, CI, content inventory, and documentation consistency;
- live-match terminal and evidence provenance;
- canonical SAN/push execution;
- canonical combat/chase execution;
- Director scene/threat/NPC state;
- narration modes, profiles, and secret audit;
- runtime safety, migrations, and session lifecycle;
- adapter process reuse and telemetry; and
- independent integration review and validation.

Shared hotspot files such as `coc_live_turn_runner.py`,
`coc_playtest_driver.py`, `coc_story_director.py`, and shared narrative docs
must have one owner at a time. Parallel workers may research them, but code
integration is serialized.

## 8. Error Handling and Compatibility

- Reject invalid identifiers before filesystem access.
- Convert expected runtime failures into typed error events at the SDK edge.
- Preserve original corrupt files as backups and record recovery details.
- Preserve old scenario data through normalization/compilation.
- Preserve old runtime config through explicit migration warnings.
- Fail closed for evidence eligibility and secret-boundary uncertainty.
- Fail open only for narration rendering, with a recorded deterministic
  template fallback that never changes rules outcomes.

## 9. Test Strategy

Every behavior change follows red-green regression discipline. Tests must prove
both component correctness and canonical-path wiring.

In particular, tests that inject fabricated `rules_results` directly into
`apply_plan` do not count as live push/combat/chase evidence. A passing
standalone `CombatSession` or `ChaseSession` test does not close a
`run_live_turn` acceptance item.

Any existing test that legitimizes a defect, including a scripted runner
becoming evidence-grade only because `live=True`, must be changed to reject the
behavior.

## 10. Acceptance Ledger

| ID | Acceptance item | Required evidence |
|---|---|---|
| A01 | OCR/extraction caches removed from HEAD and ignored | Git tracked-file check + ignore test |
| A02 | Repository content inventory exists with unresolved rights explicit | Static inventory validation |
| A03 | CI installs all declared Python dependencies | Workflow check + clean-env collection |
| A04 | Python version matrix and Node/plugin/product jobs exist | Workflow/schema validation |
| A05 | README, CHANGELOG, plans, starter count, and version agree | Consistency test |
| A06 | Version metadata is `0.16.0-alpha.1` everywhere | Metadata tests |
| A07 | `dying`, unconsciousness, stabilization, and death differ in live match | End-to-end state tests |
| A08 | Terminal reporting uses structured graph/session evidence | Branching/multi-ending tests |
| A09 | Evidence eligibility cannot be created with `--live` and a fake runner | Adversarial runner test |
| A10 | Generated evidence receipt records provenance and hashes | Schema + tamper tests |
| A11 | Cold-scene quick observation does not inherit 20-minute room search | White War regression test |
| A12 | SAN bouts and involuntary actions progress through live turns | Multi-turn live regression |
| A13 | Pushed Roll offer/confirm/reroll/consequence is resumable | Multi-turn live regression |
| A14 | Combat writes defense, damage, wounds, dying, and rescue to state | End-to-end combat test |
| A15 | Successful Fight Back can damage the attacker | Combat regression test |
| A16 | Chase can start, advance, resolve hazards/conflict, persist, and end through live turns | End-to-end chase test |
| A17 | Director reads persisted threat-clock progress | Context/selection regression |
| A18 | Threat selection uses structured relevance evidence | Multi-front test |
| A19 | Scene function is normalized and available to Director | Compile + live-plan test |
| A20 | NPC state effects are produced and consumed in ordinary live play | Multi-turn social test |
| A21 | NPC knowledge/willingness/lie/schedule gates disclosure | Conversation state tests |
| A22 | Crisis render frame is invoked in production crisis mode | Live narration test |
| A23 | Scenario strategies support explicit specialized state | At least time-loop and multi-faction tests |
| A24 | Horror style profile reaches narrator without leaking secrets | Envelope/adapter tests |
| A25 | Final narration has structured/semantic secret audit evidence | Adversarial paraphrase test |
| A26 | Runtime rejects traversal and symlink escape | V4 path tests |
| A27 | Session registry is locked, expiring, closable, and recoverable | Concurrency/TTL/restart tests |
| A28 | PublicState uses the typed state gateway and reports corruption | Corruption/recovery tests |
| A29 | A real production v1-to-v2 migration exists | Migration round-trip tests |
| A30 | Runtime composition replaces ambiguous Pi proxy semantics compatibly | Config migration + SDK tests |
| A31 | Adapter worker/session reuse works across turns | Process identity/contract test |
| A32 | Per-turn telemetry contains latency, token, fallback, and runner fields | Schema/integration tests |
| A33 | Full local validation passes with no unexpected workspace changes | Complete validation log |
| A34 | Each original diagnosis has a current root-cause classification | Final audit review |

## 11. Stop and Escalation Conditions

Stop and request direction only for:

- a required product tradeoff outside this design;
- credentials or paid external-model access;
- legal conclusions beyond repository evidence;
- destructive history rewriting;
- push, deploy, tag, or release actions;
- unexpected pre-existing dirty files that overlap worker scope;
- an irreversible migration; or
- validation that remains ambiguous after focused investigation.

Routine implementation, test repair, worker revision, and integration choices
inside this design do not require additional user approval.
