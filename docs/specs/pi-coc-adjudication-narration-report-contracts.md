# Pi-Coc adjudication, narration, and evidence contracts

Status: **Proposed**

Implementation track: **`ACTIVE_IMPLEMENTATION_TRACK=pi-coc`**

Scope owner: Pi-Coc host plus the canonical `plugins/coc-keeper/` product

Ruleset: CoC 7e through the existing ruleset resolver seam
Last updated: 2026-08-23

This document is an implementation specification, not implementation authority.
It authorizes no edits to shared kernel, state, registry, contract, skill, Codex
track, push, deploy, migration, or historical playtest evidence. Shared-file
implementation requires explicit approval after this specification is reviewed.

## 1. User job and success condition

The user is trying to prevent an AI Keeper from producing internally
inconsistent play even when its prompt drifts: repeated rolls for the same
attempt, unearned disclosure, social success beyond an NPC's knowledge, scene
scope explosion, narration that takes control of an investigator, and battle
reports whose prose and mechanical evidence describe different runs.

Success looks like:

- retries may rewrite fiction but cannot reroll or reapply settled mechanics;
- social and concealed-Psychology decisions have stable identities and
  source-bound inputs;
- module secrets and authored milestones cannot be unlocked by unsupported
  improvised facts;
- scene-scope drift is visible, explicitly promoted when adopted, and a hard
  acceptance failure when silently committed;
- ordinary narration is incremental, player-owned decisions remain player
  owned, and forced behavior has a current rules receipt;
- one canonical evidence set produces a player-safe report and a separate
  Keeper/development audit;
- a report with missing run identity, unbound transcript text, orphaned public
  rolls, stale state, or leaked secrets can only be `INCOMPLETE`.

Hollow delivery would be:

- adding more Keeper prompt prose without executable receipts and tests;
- creating a second turn engine, monolithic `journal.jsonl`, or host-specific
  Pi facade beside the canonical plugin;
- making Director, Storylet, narration review, or scene budgets a fixed
  per-turn pipeline;
- treating focused contract tests as proof of real Pi-Coc Keeper quality;
- blocking legitimate improvisation or a player-created branch merely because
  it was not authored in advance;
- streaming unaccepted prose to the player and validating it afterward;
- declaring a battle report complete while `run_segment_id` is missing.

## 2. Evidence and existing product shape

This specification deepens existing paths; it does not replace them.

| Concern | Existing canonical path | Required change |
| --- | --- | --- |
| Turn identity and output | `state.journal` → `turn.output_context` → `turn.finalize` | Add action/contract projections and accepted revision identity; retain the existing authority order. |
| Mutation idempotency | Per-tool `decision_id`, atomic state writes, turn manifest and source cursor | Bind retries to original parameters and reject same-id/different-intent calls. Do not defer all state until narration. |
| Social adjudication | `rules.social_adjudicate` | Correct goal identity, validate leverage provenance, add complete feasibility and outcome ceilings, route CoC arithmetic through the CoC7 adapter. |
| Concealed Psychology | `rules.psychology_observe` | Separate hidden settlement from player-safe realization; use explicit conversation/observation revisions rather than a hash of every NPC-state change. |
| Scene scope | `scene.context`, scene-contract projection, `state.promote_scene` | Compile a versioned contract for every authored scene; preserve runtime advisory authority while making silent scope drift an acceptance failure. |
| Narration | `narration.brief`, `narration.review`, finalization coverage | Add accepted revision binding, minimum-privilege inputs, bounded rewrite behavior, and structured control-override sources. |
| Report export | `coc-export-battle-report` | Extend the existing player/audit projections and completeness dimensions; do not add a second exporter. |

The current source already contains the required foundation, but the following
known gaps must be captured as red tests before repair:

1. `rules.social_adjudicate` currently includes `approach` in `goal_key` while
   claiming that switching approach does not reopen the goal.
2. Strategic leverage is accepted by string reference and the first two rows
   count without proving existence, relevance, credibility, or independence.
3. `rules.psychology_observe` accepts caller-authored visible observation text
   before its concealed roll and stores it unchanged.
4. Any content change in the NPC psych entry changes the observation window,
   including changes too small to justify a fresh read.
5. Scene truth ceilings and budgets are advisory, but the final report does not
   yet fail acceptance for unpromoted scope drift.
6. Narration review records caller-supplied semantic findings and cannot by
   itself prove absence of agency violations.
7. A checked-in report currently displays `run_segment_id=MISSING` while its
   completeness classification is complete.

## 3. Authority model

The design has three enforcement levels. They must not be collapsed.

### 3.1 Runtime hard invariants

These are deterministic or source-verifiable and may fail closed:

1. Dice, numeric outcomes, and state arithmetic come only from canonical
   rules/state receipts.
2. A mutating `decision_id` is idempotent for one immutable request. Reuse with
   different immutable parameters returns `idempotency_conflict` without a
   write or roll.
3. Module source is read-only; Keeper-only facts never enter player-safe
   projections without a canonical earned route or explicit campaign-local
   public assertion.
4. A played turn is finalized only from the exact pending-turn manifest after
   all ordinary rules/state writes and the exact player journal.
5. Public mechanical rows render exactly once and concealed rows render zero
   times as dice.
6. A structured voluntary PC action, belief, or commitment requires a matching
   player-input source; a structured forced action requires an active control
   override receipt.
7. Improvised local-only facts cannot satisfy authored milestone prerequisites
   or grant authored ending authority.
8. Complete report classification requires exact run identity, accepted
   transcript/finalization bindings, dice completeness, state consistency, and
   secrecy validation.

### 3.2 Pre-delivery semantic rewrite responsibilities

These require Keeper semantic judgment and are not a second mechanical rules
engine:

- prose-level investigator-agency violations;
- semantic repetition of the player's just-declared action;
- scene truth or implication that exceeds the currently adopted scope;
- psychology realization depth and fumble misinterpretation;
- excessive length, repeated imagery, and low new-information density.

The Pi-Coc host may request a bounded rewrite of the same draft against the
same frozen settlement. A rewrite never invokes `rules.*`, `state.*`, combat,
sanity, or another mutation. The first version allows at most two narration
revisions. Exhaustion is recorded as a narration-quality failure; it does not
authorize a template Keeper or mechanics replay.

### 3.3 Post-run acceptance hard failures

The following make a run invalid for the named acceptance dimension even when
play continued:

- an unpromoted transit scene commits tier-3/tier-4 mainline truth;
- an improvised local-only fact unlocks an authored milestone;
- repeated concealed Psychology roll for the same observation window;
- player-visible secret or concealed die disclosure;
- prose-level voluntary PC decision with no player source or rules override;
- orphaned, duplicated, malformed, or unrendered public mechanical evidence;
- `run_segment_id` missing, transcript row unbound to an accepted revision, or
  final state not matching canonical receipts.

Narrative length and style findings are soft quality failures unless they
cause another hard failure.

## 4. Deep module and seams

### 4.1 One deep turn-settlement module

The external interface remains the existing small surface:

```text
state.journal
turn.output_context
turn.finalize
session.delivery_ack
```

The implementation may use internal modules for manifests, visibility,
mechanics placement, narration contracts, and report evidence. Those internal
seams are not new Keeper-facing calls.

Deletion test: removing this module must force every host to reimplement turn
isolation, exact mechanical rendering, causal coverage, transcript identity,
retry behavior, and delivery recovery. That leverage justifies the module.

The design explicitly rejects a new all-purpose `turn_receipt.create`, a
pre-state narration transaction, or a monolithic event-sourced replacement for
existing canonical state.

### 4.2 CoC7 adjudication adapter

CoC-specific difficulty ladders, social skill names, Psychology rules, bonus
dice, pushed-roll behavior, and result levels belong to the existing ruleset
resolver seam. Kernel code owns identity, provenance validation, visibility,
idempotency, and persistence.

The optional resolver capabilities are:

```python
social_difficulty(request, npc_defense) -> SocialDifficultyResult
psychology_policy(check_result, question_kind) -> PsychologyOutcomePolicy
```

They are optional ruleset capabilities exposed through `public_api_index()`.
Unsupported rulesets return `unsupported_ruleset_operation`; the kernel never
substitutes CoC behavior.

This extends an existing real seam with multiple ruleset adapters and the
conformance test adapter. It does not create a speculative port.

### 4.3 Scene-governance projection

`scene.context` is the single Keeper-facing projection of authored scope,
current promotion, budget use, exits, and drift findings. Scene compilation,
runtime counters, and report validation remain internal.

### 4.4 Evidence projection

The canonical evidence remains the existing typed receipts and append-only
logs. Player report and audit attachment are two read models over that evidence.
The exporter must not become the owner of gameplay state or reconstruct missing
facts from prose.

## 5. Turn and revision contract

### 5.1 Identity hierarchy

```text
run_segment_id
  └─ session_id
      └─ turn_id                  # one exact external player message
          ├─ action_ref[]         # compound semantic actions in that message
          ├─ decision_id[]        # exact rule/state mutations
          └─ finalization_id
              └─ accepted_revision
```

- `turn_id` continues to derive from campaign identity and journal identity.
- `action_ref` is not a new state authority. It identifies one semantically
  distinct attempted commitment or action inside a compound declaration and
  groups existing receipts.
- `decision_id` remains the idempotency key for each authoritative operation.
- `accepted_revision` identifies narration only. It never changes settled dice
  or state.

### 5.2 `turn.output_context` additions

The existing result gains a versioned `contract_projection`:

```json
{
  "schema_version": 1,
  "turn_id": "turn-v1-...",
  "source_digest": "sha256:...",
  "settlement_snapshot_id": "turn-effect-v1:...",
  "action_refs": [
    {
      "action_id": "action-0042-01",
      "player_goal": "让科瓦连科说明失踪者的去向",
      "source": "player_input:journal-decision-id"
    }
  ],
  "scene_contract": {},
  "control_overrides": [],
  "narration_budget": {},
  "player_safe_facts": [],
  "keeper_only_obligations": [],
  "mechanical_obligations": []
}
```

`player_safe_facts` is allowlisted at construction. It is never created by
serializing a secret-rich object and deleting keys afterward.

### 5.3 `turn.finalize` additions

Input adds:

```json
{
  "turn_id": "turn-v1-...",
  "source_digest": "sha256:...",
  "revision": 1,
  "draft": "...",
  "coverage": [],
  "mechanics_placements": []
}
```

Receipt adds:

```json
{
  "finalization_id": "finalize-v1-...",
  "turn_id": "turn-v1-...",
  "source_digest": "sha256:...",
  "settlement_snapshot_id": "turn-effect-v1:...",
  "accepted_revision": 1,
  "accepted_draft_sha256": "sha256:...",
  "rendered_text_sha256": "sha256:...",
  "rendered_text": "..."
}
```

Rules:

- same `turn_id + source_digest + revision + draft hash` replays exactly;
- same revision with a different draft is `revision_conflict`;
- a later revision is legal only while no revision has been delivered;
- accepting a later revision dispositions the earlier narration revision but
  does not disposition or rerun mechanics;
- after delivery acknowledgement, no later revision is legal;
- no player-visible prose streams before an accepted finalization receipt.

## 6. Social adjudication contract

### 6.1 Request

```json
{
  "investigator": "ivanov",
  "npc_id": "kowalenko",
  "conversation_window_id": "conv-021",
  "commitment_id": "admit-record-tampering",
  "goal_summary": "承认篡改档案并协助撤离",
  "approach": "persuade",
  "motive": {
    "direction": "oppose",
    "intensity": 2,
    "evidence_refs": [
      "npc_state:kowalenko-protects-village",
      "scene_fact:nkvd-purge-risk"
    ]
  },
  "leverage_refs": [
    {
      "leverage_id": "physical-film-sample",
      "source_event_id": "event-0392",
      "independence_group": "physical-evidence"
    }
  ],
  "tactical_conditions": [
    {
      "condition_id": "private-conversation",
      "source_ref": "scene_state:private-room"
    }
  ],
  "decision_id": "social-adjudication-0042"
}
```

`commitment_id` is a Keeper semantic classification with a concise reason in
the audit record. It is never inferred from keywords or a normalized prose
hash. The goal identity is:

```text
npc_id + conversation_window_id + commitment_id
```

`approach` is deliberately excluded. Changing Charm to Persuade does not reopen
the same requested commitment.

### 6.2 Provenance validation

The kernel resolves every reference before CoC7 arithmetic:

- motive refs must resolve to authored agenda, canonical NPC state, relationship
  state, campaign canon, or an adopted scene fact;
- leverage source events must exist and be player-known;
- the same source event may count once;
- at most two distinct `independence_group` values count strategically;
- credibility and relevance are Keeper semantic judgments recorded with source
  refs and reasons, never string-category arithmetic;
- tactical bonus/penalty dice cap at two after cancellation under CoC7 rules;
- a fabricated or secret-only player leverage ref is rejected.

### 6.3 Result

```json
{
  "goal_key": "social-goal-v1:...",
  "feasibility": "automatic | roll | conditional | impossible",
  "base_difficulty": "regular | hard | extreme",
  "defense_value": 55,
  "defense_source_ref": "npc:kowalenko:skills:psychology",
  "motive_adjustment": 1,
  "strategic_adjustment": -1,
  "bonus_dice": 1,
  "penalty_dice": 0,
  "final_difficulty": "hard",
  "requirements": [],
  "outcome_ceiling": {
    "goal_scope": "承认篡改记录并协助撤离",
    "npc_knowledge_refs": ["npc_fact:tampered-records"],
    "scene_truth_max_tier": 3,
    "forbidden_fact_refs": ["mythos_fact:entity-identity"]
  },
  "resolution": "new | reuse",
  "source_digest": "sha256:..."
}
```

Feasibility rules:

- `automatic`: the NPC is already willing; no roll;
- `roll`: conflict exists and the requested commitment is achievable now;
- `conditional`: new leverage, safety, authority, relationship, or situation is
  required; return actionable in-world requirements;
- `impossible`: the NPC lacks the knowledge, ability, authority, or logical
  means to satisfy the goal.

Changing difficulty inputs without a canonical state/event revision is an
idempotency conflict, not a fresh adjudication. A pushed roll uses the existing
CoC pushed-roll path and the same goal identity.

## 7. Concealed Psychology contract

### 7.1 Observation window

Identity:

```text
observer_scope + target_npc_id + conversation_window_id + observation_revision
```

For a single-investigator game, `observer_scope` is the investigator id. For a
party, it is a team observation id with one primary observer and optional
structured assistance; party members cannot serially reroll the same target.

`observation_revision` changes only on an explicit event whose semantic kind is
one of:

- `decisive_evidence_presented`;
- `identity_exposed`;
- `threat_state_changed`;
- `hostility_state_changed`;
- `confession_or_betrayal`;
- `left_and_reencountered`;
- `scene_changed`.

Ordinary trust/fear/suspicion deltas do not automatically open a new window.

### 7.2 Settlement

The initial call accepts a concrete question and source-bound observable
behavior, but not finished player-visible interpretation prose:

```json
{
  "observer": "ivanov",
  "target_npc_id": "kowalenko",
  "conversation_window_id": "conv-021",
  "observation_revision": 3,
  "question": "他更害怕调查员还是门外的人？",
  "observable_fact_refs": [
    "scene_observation:kowalenko-looked-at-door"
  ],
  "decision_id": "psychology-conv-021-r3"
}
```

The hidden result stores roll id, outcome, permitted inference depth, relevant
Keeper-only truth refs, and fumble policy. It does not store a pre-roll answer.

```json
{
  "insight_id": "psych-insight-0092",
  "resolution": "new",
  "visibility": "keeper_only",
  "inference_depth": "uncertain | immediate_intent | motive_link | deep_conflict",
  "misread_policy": "none | plausible_wrong_on_fumble",
  "reusable_until_revision": 3
}
```

Outcome policy:

| Result | Keeper realization ceiling |
| --- | --- |
| Regular success | True immediate emotion or intent. |
| Hard success | Immediate intent plus one grounded motive relationship. |
| Extreme success | Deep motive or contradiction, still capped by NPC knowledge and scene scope. |
| Failure | Ambiguous, shallow, or insufficient observation; no mandatory inverse truth. |
| Fumble | One plausible but wrong interpretation is allowed, not required. |

The Keeper realizes the hidden contract into a player-safe observation during
drafting. Only the realized external behavior/inference enters the narration
projection; roll id, outcome, truth refs, and reliability never do.

Repeated calls in the same window return the existing `insight_id` and no roll.
They may say only that no new observable change has occurred. A differently
worded question does not reopen the window.

## 8. Scene contract

### 8.1 Compiled form

Every authored scene may carry:

```json
{
  "schema_version": 1,
  "scene_contract_id": "scene-first-sovkhoz-v1",
  "scene_id": "first-sovkhoz-leninsky-2",
  "role": "transit",
  "authored_purposes": [
    "允许车辆加油",
    "允许修理油桶",
    "展示异常丰收",
    "展示工人的恐惧与愤怒"
  ],
  "truth_scope": {
    "max_tier": 1,
    "max_bridge_clues": 1,
    "allowed_domains": [
      "local_work_conditions",
      "route_information",
      "surface_emotions"
    ],
    "forbidden_domains": [
      "main_farm_disappearances",
      "mythos_entity_identity",
      "mainline_resolution"
    ]
  },
  "improv_budget": {
    "named_npcs": 1,
    "new_locations": 0,
    "local_clues": 1,
    "complications": 1,
    "soft_turn_limit": 6,
    "review_turn_limit": 10
  },
  "exit_affordances": [
    "车辆修好",
    "天气窗口即将关闭",
    "主农场方向获得明确指引"
  ]
}
```

Truth tiers:

| Tier | Meaning |
| ---: | --- |
| 0 | Atmosphere, sensory facts, local color. |
| 1 | Local facts and actionable local information. |
| 2 | Bridge clues pointing to another scene. |
| 3 | Mainline structure, antagonist plan, key causality. |
| 4 | Mythos truth, final solution, ending-level information. |

### 8.2 Runtime behavior

- Contracts inform Keeper judgment; they do not deny player actions.
- Crossing a ceiling produces a structured drift finding with proposed options:
  downgrade to symptom, convert to bridge, create local consequence, or promote
  the scene.
- A scene role changes only through idempotent `state.promote_scene`, recording
  from/to roles, reason, source events, module divergence, and a new contract id.
- Promotion is a campaign-local canonical event; it never edits authored module
  source.
- Budget exhaustion supplies pressure and exits. It never says “nothing else
  can be investigated” and never forces a transition.
- `soft_turn_limit` is a review trigger, not a quota. `review_turn_limit` is an
  acceptance diagnostic, not an automatic ending.

### 8.3 Improvised facts

Every improvised fact carries:

```json
{
  "provenance": "improvised",
  "scene_contract_id": "scene-first-sovkhoz-v1",
  "truth_tier": 1,
  "domain": "local_work_conditions",
  "local_only": true,
  "can_unlock_authored_milestone": false,
  "source_event_id": "event-..."
}
```

An improvised fact may later become broader campaign canon only through an
explicit semantic adoption/promotion event with provenance retained. It never
silently becomes authored module truth.

A transit scene may still contain a causally valid investigator death,
abandonment, arrest, or campaign-ending player decision. The forbidden domain
is silent **mainline resolution**, not every possible terminal session event.

## 9. Narration and player-control contract

### 9.1 Minimum-privilege narration input

The narrator receives:

- exact player action text or a source-bound action uptake;
- player-safe scene facts and approved reveals;
- visible NPC actions and speech constraints;
- authoritative public mechanics and visible state changes;
- player-safe Psychology realization, never its hidden basis;
- current length budget and control overrides;
- facts that must not be revealed as opaque ids/categories, not secret prose.

### 9.2 Incremental narration

Ordinary narration may add only:

1. an external change;
2. an NPC action or response;
3. a visible consequence of a settled result;
4. a newly available condition, route, opportunity, or danger.

It does not automatically repeat the player's action, recap all clues, restage
the same weather/sensory motifs, or decide what the investigator believes.

Initial budgets are upper bounds, never targets:

| Mode | Max Chinese characters | Max paragraphs |
| --- | ---: | ---: |
| Routine resolution | 350 | 2 |
| Costly result | 550 | 3 |
| Reveal or transition | 900 | 5 |
| Climax, madness, ending | 1500 | 8 |

The first product metric is: routine-turn P95 ≤ 450 Chinese characters over a
real-play sample. A single long turn is not mechanically rejected solely for
length.

### 9.3 Ownership matrix

| Claim | Owner/source |
| --- | --- |
| Voluntary investigator action, speech, plan, belief, moral judgment, trust, or active emotion | Exact player input or a prior player-authored campaign-canon event. |
| NPC action, speech, secret, agenda, and reaction | Keeper, constrained by authored/campaign state. |
| Environment and objective sensory change | Keeper/source/state receipt. |
| Involuntary physiology | Rules/Keeper within established conditions. |
| Forced investigator behavior | Active control-override receipt only. |

Allowed control overrides are versioned, time-bounded, and source-bound:

- bout of madness;
- explicit mind control or spell compulsion;
- unconsciousness/incapacitation;
- currently triggered rules-backed phobia or mania;
- a player-accepted pushed-roll consequence whose scope explicitly includes
  involuntary behavior.

Expiry returns control immediately. A prior override cannot justify later
voluntary decisions.

### 9.4 Review and rewrite

`narration.review` records:

```json
{
  "turn_id": "turn-v1-...",
  "revision": 1,
  "draft_sha256": "sha256:...",
  "findings": [
    {
      "rule_id": "agency_violation | semantic_repetition | scope_overreach | over_length",
      "subject_ref": "pc:ivanov",
      "source_ref": null,
      "reason": "concise semantic reason"
    }
  ]
}
```

Review uses proposition-level semantic judgment, not prohibited-word matching.
Deterministic checks may count characters, paragraphs, receipt ids, and exact
source bindings. A rewrite receives the same frozen output context and produces
`revision + 1`; it cannot reopen mechanics.

## 10. Player report and Keeper audit

### 10.1 Source model

Do not introduce one new authoritative `journal.jsonl`. The canonical evidence
set is the existing typed state/rules/finalization/transcript records joined by
stable identities and hashes. The exporter reads cold evidence only.

Every accepted player-visible transcript row must bind:

```text
run_segment_id + session_id + turn_id + finalization_id
+ accepted_revision + rendered_text_sha256
```

### 10.2 Player-safe report

`artifacts/battle-report.md` contains:

1. run identity and verification status;
2. opening investigator snapshot;
3. exact accepted exchanges grouped by scene;
4. public checks and visible consequences;
5. confirmed discovered clues;
6. investigator impressions and unresolved guesses, explicitly separated from
   confirmed facts;
7. visible relationship changes;
8. ending summary;
9. final investigator state and development.

It excludes concealed dice, NPC truth, undiscovered clues, scene budgets,
internal ids, prompt text, audit scores, and Keeper reasoning.

### 10.3 Audit attachment

The existing `artifacts/audit/` grows to:

```text
audit/
├── manifest.json
├── transcript.jsonl
├── rolls.jsonl
├── rule-decisions.jsonl
├── social-resolutions.jsonl
├── psychology-hidden.jsonl
├── scene-budget.jsonl
├── narration-revisions.jsonl
├── state-diffs.jsonl
├── report-validation.json
├── rules-audit.md
└── hashes.sha256
```

`psychology-hidden.jsonl` and Keeper-only payloads are not part of the player
distribution. Packaging/publishing code must expose the player-safe artifact
set separately from the development audit set.

### 10.4 Completeness dimensions

`COMPLETE` requires every dimension to pass:

| Dimension | Required proof |
| --- | --- |
| `run_identity` | Campaign-owned `save/run-identity.json` (`schema_version: 1`) is present and current: exact `campaign_id`, `run_segment_id`, `session_id`, `plugin_version`, `ruleset_id`, `ruleset_version`. Harness `run.json` / `playtest.json` cannot override it. Missing, corrupt, sentinel, or conflicting identity fails closed. |
| `accepted_transcript` | Every journaled player row and finalized Keeper row appears exactly once and binds the accepted revision. When the canonical identity is present, only matching run/session rows are selected. |
| `dice` | Every public/consequence-public roll is well formed, source traceable, bound, and rendered exactly once; concealed rolls render zero times. Unchanged by the Git-proof work. |
| `state` | Structured Git proof `state_integrity_proof(...).to_dict()` is `PASS`; `FAIL` and `NOT_PROVEN` stay distinct. Visible typed deltas still require a registered state receipt. Never read `save/commit-snapshots`. |
| `settlement_uniqueness` | Session/ending/development settlement keys are unique and idempotent. |
| `scene_scope` | No unpromoted hard acceptance drift or improvised authored-milestone unlock. |
| `agency` | No accepted prose-level voluntary PC claim lacking source; every override is current and scoped. |
| `secrecy` | No Keeper-only field, hidden roll, NPC secret, or undiscovered clue in the player projection. |
| `projection_hashes` | Manifest and file hashes match all emitted artifacts. |

`--allow-partial` may emit an explicitly **UNVERIFIED / INCOMPLETE** report for
diagnosis. It cannot mark the run complete, serve as the formal evaluation
baseline, or reconstruct missing facts from prose.

Player evidence is schema 8; the Keeper/development audit envelope is schema 2.
Player `state_integrity` is bounded (`status`, `reason_codes`, `repo_present`,
`history_valid`, `fsck_ok`, `tree_clean`, `history_reset`, counts). The full
Git proof lives only in audit `finalization_binding.git_history`. The retired
`commit_snapshot_id` / `latest_commit_snapshot_present` fields are gone.

Current-schema law: only an exact-current-schema campaign is acceptable.
There is no identity or snapshot fallback, no dual reader, and no migration.
Historical reports stay read-only. A later `COC-History-Reset` is
`NOT_PROVEN`, never `PASS`. Acceptance that treats harness `run.json` as
identity, leftover `commit-snapshots` as state proof, or a reset history as
complete is `invalid-for-acceptance`.

## 11. Error model

New or normalized error codes:

| Code | Meaning | Writes allowed |
| --- | --- | --- |
| `idempotency_conflict` | Same decision id, different immutable request. | No |
| `social_goal_already_settled` | Same commitment/window without a legal reopen condition. | No new roll |
| `leverage_source_invalid` | Missing, secret-only, duplicated, or ungrounded leverage. | No |
| `psychology_window_settled` | Reuse existing insight. | No new roll |
| `observation_revision_invalid` | Revision lacks an allowed window-transition event. | No |
| `revision_conflict` | Same narration revision id, different draft. | No |
| `turn_source_changed` | Output context digest no longer matches pending turn. | No finalization |
| `delivery_already_acknowledged` | Attempt to revise delivered output. | No |
| `report_incomplete` | One or more completeness dimensions failed. | Partial artifacts only when explicitly requested |

Scene drift and narration quality remain structured findings rather than
ordinary tool errors unless they cross a deterministic hard invariant.

## 12. Implementation slices

Each slice is independently reviewable. No slice authorizes the next.

### Slice 0 — Characterization tests

Add red tests for the seven known gaps in §2, including the checked-in
`MISSING + COMPLETE` contradiction. Do not change schemas in this slice.

### Slice 1 — Run identity and accepted revision

- extend pending-turn/finalization/transcript bindings;
- add report `run_identity` and `accepted_transcript` dimensions;
- make missing run segment unconditionally incomplete;
- retain old historical reports read-only; clean-slate campaigns use only the
  new exact schema, with no migration or dual reader.

### Slice 2 — Social and Psychology

- route CoC arithmetic/policies through the CoC7 resolver;
- fix semantic goal identity and parameter binding;
- validate motive/leverage provenance;
- add explicit conversation/observation revisions;
- remove pre-roll finished Psychology observation prose;
- preserve concealed visibility and exact no-reroll behavior.

### Slice 3 — Scene compilation and evidence

- validate/compile scene contracts during scenario import/hydration;
- project effective role, promotion, budgets, exits, and drift;
- enforce local-only facts against authored milestone unlocks;
- add report acceptance findings without creating a fixed scene pipeline.

### Slice 4 — Narration revisions and control ownership

- extend minimum-privilege narration projection;
- bind review to turn/revision/draft hash;
- add bounded same-settlement revision support;
- add structured PC claim sources and control overrides;
- prohibit player-visible pre-finalization streaming.

### Slice 5 — Audit projection

- extend the sole canonical exporter;
- add audit streams and manifest hashes;
- keep player-safe and Keeper/development distribution sets separate;
- verify no secret-bearing audit object enters primary evidence JSON.

### Slice 6 — Real Pi-Coc acceptance

Run a fresh campaign through the required method:

1. launch canonical Pi-Coc in RPC mode;
2. Grok is the Keeper;
3. one main-session or designated agent is the only player, replying naturally
   one message at a time;
4. exercise social resistance/leverage, repeated Psychology request, scene
   pressure/promotion, routine narration, and at least one valid control
   override if naturally reached;
5. continue to a natural structured ending or a genuine operational blocker;
6. preserve all campaign, transcript, tool, and run evidence;
7. export through `coc-export-battle-report` and read both projections end to
   end.

No scripted player, canned scene, batch turns, fixed turn count, reconstructed
transcript, or deleted campaign evidence qualifies.

## 13. Validation matrix

### 13.1 Deterministic contract checks

At minimum:

```bash
PYTHONDONTWRITEBYTECODE=1 uv run --frozen python -m pytest \
  tests/test_social_psychology.py \
  tests/test_scene_contract.py \
  tests/test_turn_finalization_vertical.py \
  tests/test_settlement_boundary_idempotency.py \
  tests/test_coc_export_battle_report.py \
  -q -p no:cacheprovider

PYTHONDONTWRITEBYTECODE=1 uv run --frozen python -m pytest \
  tests/test_plugin_metadata.py -q -p no:cacheprovider
```

If CoC7 rule data changes:

```bash
PYTHONDONTWRITEBYTECODE=1 uv run --frozen python -m pytest \
  tests/test_rulebook_data_audit.py -q -p no:cacheprovider
```

Pi-Coc host changes additionally run the focused Pi policy, tool-surface,
finalization-gateway, mechanical-output, continuation/resume, and Web RPC
projection tests selected from the touched files.

### 13.2 Required adversarial cases

- same social commitment, different approach name: no fresh adjudication;
- same decision id, changed motive/leverage: conflict;
- duplicate evidence under two leverage ids: counts once;
- secret-only leverage: rejected;
- NPC cannot know the requested fact: `impossible`, no roll;
- same Psychology window, four party investigators: one concealed roll total;
- minor trust delta: no observation revision;
- decisive evidence transition: one new observation window;
- Psychology failure: no forced inverse truth;
- Psychology fumble: wrong interpretation stays out of confirmed clues;
- transit scene tier-3 reveal without promotion: play evidence retained,
  acceptance fails;
- promoted player-created branch: permitted, divergence recorded;
- transit-scene investigator death: terminal event allowed without silently
  granting mainline resolution;
- narration revision after settlement: no new roll or state write;
- revision after delivery ack: rejected;
- voluntary PC belief with no source: acceptance failure;
- expired control override: cannot authorize later behavior;
- player report contains hidden roll or NPC secret: secrecy failure;
- `run_segment_id=MISSING`: incomplete regardless of every other dimension;
- public roll missing/duplicated/orphaned: dice failure;
- partial transcript requested explicitly: labeled unverified, never complete.

### 13.3 Product acceptance

Component tests prove interfaces, schemas, arithmetic, idempotency, and
projection safety. Only the real Pi-Coc RPC workflow in Slice 6 may support
claims about Keeper quality, narrative brevity, player agency, scene discipline,
or report usefulness.

## 14. File ownership candidates and scope gates

The likely implementation surfaces are listed for planning only:

- shared canonical turn/state/report implementation under
  `plugins/coc-keeper/scripts/`;
- CoC7 resolver and rules package under
  `plugins/coc-keeper/rulesets/coc7/`;
- canonical tool contract archive and plugin skills;
- Pi-Coc-only host policy/extensions/prompts under `plugins/coc-keeper/pi/`;
- sole report exporter and focused tests;
- possibly scenario import/hydration schemas for scene contracts.

Most of these are cross-track shared files. Under the active track law they are
off-limits until explicitly authorized by exact file/scope after this spec is
accepted. Codex-host adapters, prompts, launchers, tests, and documentation
remain off-limits for this Pi-Coc task except read-only non-regression checks.

The current primary checkout contains concurrent uncommitted edits in several
of these likely surfaces, including toolbox/runtime/contract/Pi/Web files. An
implementation intake must identify their owner and either wait, use a
task-owned isolated worktree from a clean accepted base, or narrow the slice.
It must not absorb, stash, revert, reset, clean, or silently complete those
changes.

## 15. Done definition

The initiative is done only when:

1. all deterministic and adversarial acceptance rows relevant to the approved
   slices pass;
2. the interfaces remain the existing deep turn/adjudication/scene/report
   seams rather than a second engine;
3. no opposite-track or unauthorized shared-file change is integrated;
4. a fresh real Pi-Coc RPC run produces preserved accepted transcript,
   finalization, state, dice, scene, social, Psychology, and revision evidence;
5. the player report is readable and secret-free;
6. the audit attachment proves exact run identity and cross-projection
   consistency;
7. the report is honestly `INCOMPLETE` for every deliberately corrupted
   fixture, especially missing run identity;
8. unrelated dirty work and every prior playtest evidence directory remain
   untouched.
