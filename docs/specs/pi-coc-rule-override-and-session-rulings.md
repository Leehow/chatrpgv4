# Pi-Coc rule override layers and session rulings specification

> **Status:** Proposed. This document defines acceptance; it is not
> implementation authority. Implementation touches shared kernel files named in
> §8 and requires explicit user authorization per file before any edit.
> **ID:** `pi-coc-rule-override-and-session-rulings`
> **Track:** `ACTIVE_IMPLEMENTATION_TRACK=pi-coc`; Codex-host implementation,
> adapters, prompts, launchers, tests, and documentation remain off-limits.
> **Scope owner:** the CoC7 ruleset package and campaign rules state inside
> `plugins/coc-keeper/`.
> **Last updated:** 2026-09-02
> **Depends on:** [RuleGraph runtime](pi-coc-rule-graph-runtime.md),
> [`docs/ruleset-contract.md`](../ruleset-contract.md),
> [ADR 0003 system ontology composition registry](../adr/0003-system-ontology-composition-registry.md).
> **Evidence base:** measured on `0.8.1a@98d1246a`; every count in §2 is a
> measurement.

The words MUST, MUST NOT, SHOULD, and MAY below are acceptance requirements.

---

## 1. User job, success condition, and hollow delivery

Two things a Keeper needs and does not have. Optional rules, era supplements,
module supplements, campaign patches and house rules have no representation at
all, so nothing can say which rule wins when two of them speak to the same
situation. And a ruling the Keeper makes at the table — "in this warehouse, a
pushed Locksmith roll costs a round of noise" — exists only in the transcript,
so the same situation two hours later gets adjudicated differently. Inconsistent
adjudication over a long session is a measured pain from real play, not a
theoretical one.

Success looks like:

- a rule can state that it overrides, augments, disables or enables another
  rule, and a conflict nobody declared is a compile-time `RuleConflict` rather
  than something a model resolves at the table;
- layer priority orders *declared* patches and never silently rewrites a rule;
- a ruling the Keeper makes is recorded with its scope, its expiry, and the
  decision it bound to, and comes back to the Keeper the next time the same
  decision is reached;
- a house rule stated in natural language becomes a versioned patch through a
  reviewed path — never a keyword scan, and never applied before the user
  confirms what it will and will not change;
- none of this becomes a gate: rulings inform the Keeper, they never block an
  action, force a call, or add a blocking narrative step;
- one rules engine, not two.

Hollow delivery includes:

- adopting `docs/coc7-core-rulegraph-v0.1/` as a second executable rules source
  beside the production graph (§2.3) — the repository forbids a second rules or
  state engine, and two graphs disagreeing at runtime is worse than one graph
  missing a feature;
- a layer taxonomy in JSON with no consumer, which is what both graphs have
  today (§2.1, §2.3);
- parsing a house rule with a phrase list, a regex, or a keyword table;
- letting layer priority resolve an undeclared conflict, which converts "the
  system does not know" into "the system quietly guessed";
- a session ruling that changes dice, state, or a settled result;
- shipping a patch whose effect nobody can state as a test.

---

## 2. Evidence base

Measured on `0.8.1a@98d1246a`.

### 2.1 The production RuleGraph has no concept of override or layer

`plugins/coc-keeper/rulesets/coc7/rule-graph.json` carries 437 nodes and 672
relations across 10 promoted families.

| Relation kind | Count |
| --- | --- |
| `locks-input` | 125 |
| `part-of` | 125 |
| `invokes` | 110 |
| `applies-to` | 98 |
| `requires-input` | 87 |
| `available-when` | 34 |
| `emits` | 23 |
| `implemented-by` | 21 |
| `continues-as` | 16 |
| `reads-table` | 14 |
| `offers-choice` | 7 |
| `mutates-resource` | 5 |
| `forbids` | 4 |
| `requires-fact` | 3 |

`overrides` and `supersedes` are **in the contract's `relation_kinds` and used
zero times**. There is no `augments`, `disables` or `enables` kind at all.

Node properties across the whole graph are `adapter`, `computed_threshold`,
`effect_kind`, `expression`, `family_id`, `implementation`, `ownership`, `path`,
`policy`, `resolver_capability`, `resource_key`, `subsystem_kind`, `table_name`,
`value_type`. There is no `layer`, no `normativity`, no `enabled_by_default`, no
scope and no version. **A production rule cannot currently say that it is
optional, that it is off by default, or which layer it belongs to.**

### 2.2 `house_rule` is a stat label, not a rule

In `coc_state.py`, `house_rule` is the classification applied when a stat
adjustment names something that is not a known derived key:

```python
kind = "derived_override" if derived_match else "house_rule"
```

The value lands in the investigator sheet's `stat_overrides`. It carries no rule
reference, no scope, no version, no source, and no conflict analysis, and
nothing in the rules layer reads it. The name is the whole of the feature.

Nothing else in production models a rule-level house rule. There is no
pulp/classic profile mechanism. `optional_rules` exists only as a *scene* field
in the module projection registry and no rules code consumes it.

### 2.3 Session rulings die with the turn

`coc_story_director.py:4644` builds a `keeper_ruling_receipt` — source, rule
advice, the ruling itself, any proposal rejection — and
`coc_live_turn_runner.py:1367` copies it into the turn payload. Those are its
only two references in the tree. **No writer persists it**, no index reads it,
and no later turn can retrieve it. A campaign `save/` directory holds 21 entries
covering flags, threat, time, world state, rolls, quests and working sets; none
of them is a ruling record.

So the shape of a ruling already exists and its lifetime is one turn. That is
precisely the failure this specification exists to close.

### 2.4 The v0.1 pack already carries the design, and is not wired to anything

`docs/coc7-core-rulegraph-v0.1/` is present in the working tree and **untracked**.
It is real and internally consistent: its own `tools/validate_rulegraph.py`
reports zero errors, and `tests/run_reference_tests.py` passes 18 of 18.

It carries 465 nodes and 1470 edges — 176 `Rule`, 87 `Skill`, 68 `TestCase`, 18
`Invariant`, 9 `RuleTable`, 5 `EnginePolicy`, 3 `RuleSetProfile` — and its edges
are `SOURCED_FROM` 504, `HAS_LAYER` 184, `CONTAINS_RULE` 176, `CONTAINS_SKILL`
87, `USES_RESOLUTION_RULE` 87, `VERIFIES` 71, `HAS_TEST` 68, `SPECIALIZATION_OF`
33.

It declares the eight layers this specification adopts, and assigns every rule
to one through those 184 `HAS_LAYER` edges:

```
system_safety > session_ruling > house_rule > campaign_patch
  > module_supplement > era_supplement > official_optional > core
```

That ladder is reproduced here on purpose. The pack is gitignored as a design
reference and will never be in the repository, so a taxonomy recorded only
there would be lost the moment the working tree is cleaned.

Its README also states the rule this specification takes as law: priority never
silently rewrites, and a patch must declare `ENABLES`, `DISABLES`, `AUGMENTS` or
`OVERRIDES` with scope, version, reason and tests.

Two things it does **not** have, measured: **zero** `OVERRIDES`, `AUGMENTS`,
`DISABLES` or `ENABLES` edges — the patch vocabulary is documented in prose and
instantiated nowhere — and no connection of any kind to the production graph,
which uses a different schema, different node kinds, and different ids.

The conclusion that shapes §3.1: the layer taxonomy is worth adopting as design,
the pack is worth keeping as a reference, and it MUST NOT become a second
executable rules source.

---

## 3. Laws

### 3.1 One rules engine

The production RuleGraph and the ruleset resolver remain the only executable
rules authority. This work adds vocabulary, data and state to them. It MUST NOT
introduce a second graph, evaluator, adapter, or policy source, and MUST NOT
make `docs/coc7-core-rulegraph-v0.1/` a runtime input. Where that pack's
taxonomy is adopted, it is copied as design with attribution in the spec, not
imported as an artifact.

### 3.2 Priority orders declared patches; it never resolves an undeclared one

Layer priority answers "which of these two *declared* patches wins". It never
answers "these two rules seem to disagree, pick one".

- A patch MUST declare its relation (`overrides`, `augments`, `disables`,
  `enables`), its target rule id, its scope, its version and its reason.
- Two patches at the same layer targeting the same rule with incompatible
  relations are a `RuleConflict`, raised by the compiler, and the graph does not
  build. A model MUST NOT be asked to break the tie.
- Priority MUST NOT be implemented as "larger number wins" alone. The declared
  relation decides what happens; the layer decides only ordering among declared
  patches.

### 3.3 A ruling is a precedent, never an authority over results

A session ruling records what the Keeper decided and why, so the next
adjudication of the same decision can be consistent. It is advisory in the exact
sense `AGENTS.md` already fixes for advisory surfaces: the Keeper may adopt,
modify or ignore it, and its absence never blocks play.

A ruling MUST NOT mutate dice, HP/SAN/MP/Luck, settled results, or any state.
Those stay with `rules.*` and `state.*`. A ruling that would change a number is
a house rule and goes through §5 instead.

### 3.4 Natural language becomes a patch through review, never through matching

A house rule arrives as prose. Turning it into a patch is a semantic act and
MUST use the repository's existing artifact-mediated pattern: deterministic code
prepares a structured request, an external semantic step produces a candidate
bound to that request's digest, and deterministic code validates it. No keyword
list, phrase table, or regex over the user's sentence may appear anywhere in
that path.

The user confirms the patch before it takes effect, and what they confirm is not
the prose — it is the generated cases in §5.3.

---

## 4. Session rulings

The first slice, because it is the measured pain and it needs no change to the
source-bound graph.

### 4.1 Record

A ruling is persisted in campaign state as a closed record:

```json
{
  "ruling_id": "ruling:warehouse-pushed-locksmith-noise",
  "decision_ref": "decision:coc7:push-luck:pushed-roll",
  "scope_kind": "scene",
  "scope_id": "warehouse",
  "expires": "scene_end",
  "statement": "A pushed Locksmith roll here costs a round of audible noise.",
  "reason": "The doors are sheet metal and the corridor carries sound.",
  "bound_scene_id": "warehouse",
  "bound_session_seq": 1,
  "source_turn": 83,
  "superseded_by": null
}
```

- `ruling_id` is a semantic id per the Model-Facing Identifier Law: readable,
  meaning-bearing, stable across retries. The grammar requires at least two
  hyphen-separated capped segments, because a single-segment form accepts a
  lowercase hex digest — every digest character is `[a-z0-9]`. No grammar stops
  a digest chopped into hyphenated runs; the real guarantee is that code
  generates and verifies digests and never asks a model to relay one.
- `decision_ref` MUST be an existing RuleGraph decision id, so a ruling is
  retrievable by the decision it binds, not by prose similarity. A ruling that
  cannot name a decision is unretrievable by construction and MUST be refused.
- `scope_kind` is one of `scene`, `session`, `campaign`. Anything broader than
  `campaign` is a house rule, not a ruling.
- **`scope_id` names a scene and nothing else.** A session-scoped ruling is
  pinned by `bound_session_seq`; carrying the session in a second field would
  let one record disagree with itself, answering scope and expiry differently.
  One field per concern, so `scope_id` MUST be null for `session` and
  `campaign`.
- `expires` is one of `scene_end`, `session_end`, `never`, and MUST be
  compatible with the scope: a scene ruling may end with its scene or its
  session, a session ruling ends with its session, a campaign ruling never
  expires. A campaign-scoped ruling SHOULD be offered for promotion to a house
  rule rather than accumulating silently.
- `bound_scene_id` and `bound_session_seq` are what expiry arithmetic reads.
  They are recorded at the moment of the ruling and never recomputed.

Provenance binding — the receipts that tie a ruling to the turn that produced
it — arrives with the Keeper-facing operation in R1b, not here. The record
deliberately carries no `source_receipts` field yet: an unwritten field with no
producer is the dead-field shape this repository keeps rediscovering, and the
field set is closed, so a caller passing one is refused rather than silently
ignored.

### 4.2 Retrieval

When the Keeper reaches a decision that has an unexpired ruling in scope, that
ruling MUST be surfaced with the decision's context — in `rules.context`,
alongside the existing advisory material. It is presented as precedent with its
reason, not as an instruction.

Expiry is evaluated deterministically from scope and the current scene/session,
never by re-reading prose.

### 4.3 What it does not do

A ruling does not gate `rules.settle`, does not change a computed threshold, and
does not appear to the player as mechanics chrome. It is Keeper-facing.

---

## 5. House rules

### 5.1 Compilation

```
natural language
  -> deterministic request (targets the Keeper can name: rule ids, families)
  -> semantic compile step, digest-bound to that request
  -> RulePatch candidate
  -> deterministic validation (§5.2)
  -> generated cases (§5.3)
  -> user confirmation
  -> versioned patch admitted to the graph
```

### 5.2 RulePatch

A patch declares, and validation rejects it otherwise:

| Field | Meaning |
| --- | --- |
| `patch_id` | semantic id |
| `relation` | `overrides` \| `augments` \| `disables` \| `enables` |
| `target` | an existing rule or decision id in the production graph |
| `layer` | one of the eight layers in §2.4 |
| `scope` | campaign, or narrower |
| `version` | monotonic per patch id |
| `reason` | why the table wants it |
| `cases` | §5.3, non-empty |

A patch naming a target that does not exist is a hard failure, not a warning. A
patch whose `relation` conflicts with another declared patch at the same layer
and target raises `RuleConflict`.

### 5.3 Cases are what the user confirms

The compile step MUST generate, and the user MUST see before confirming:

- at least one **positive** case: a situation the patch changes, with the
  before and after result;
- at least one **negative** case: a situation a reader might expect it to change
  and it does not;
- at least one **boundary** case where its scope ends.

Cases become executable regression tests when the patch is admitted. A patch
whose behaviour cannot be stated as a case has not been understood well enough
to admit, and MUST be refused rather than admitted with an empty `cases`.

---

## 6. `RuleConflict`

Raised by the RuleGraph compiler, not at the table. It names the target, the two
patches, their layers, and their relations. It is an actionable error code and
MUST survive projection to whatever surface displays it, never collapsing into a
generic build failure.

Undeclared disagreement between two *core* rules is out of scope: this
specification detects conflicts between declared patches, which is a closed
question. Deciding whether two rulebook rules contradict each other is not.

---

## 7. Testing

- Deterministic unit tests for layer ordering, each relation kind, and expiry
  arithmetic.
- `RuleConflict` fires on a fixture with two same-layer patches on one target,
  and does not fire when the relations are compatible or the layers differ.
- Every check mutation-killable: deleting a check turns at least one test red.
  A suite that stays green with a check removed does not cover it.
- A ruling recorded on turn N is retrievable at turn N+k while in scope, and is
  gone after its expiry, proven by a replay rather than by a unit call.
- Prose isolation: a test asserts the house-rule path contains no regex, phrase
  table, or substring match over the user's sentence.
- A patch admitted without non-empty `cases` fails.
- `tests/test_plugin_metadata.py` MUST pass.
- Live acceptance for slice R1 is a real Pi-Coc RPC turn in which a ruling is
  recorded and a later turn surfaces it. No fixture stands in for that, and no
  scripted or batch-settled run is admissible evidence.

---

## 8. Shared files and coordination

Implementation touches these shared-kernel files. Each needs explicit
authorization before editing, and they are listed so the user can grant or
withhold per file:

| File | Slice | Why |
| --- | --- | --- |
| `plugins/coc-keeper/scripts/coc_state.py` | R1 | persist and read rulings |
| `plugins/coc-keeper/references/rule-graph-contract-v1.json` | R2 | add `augments` / `disables` / `enables`, layer and patch node kinds |
| `plugins/coc-keeper/rulesets/coc7/rule_graph_adapter.py` | R2 | conflict detection at build |
| `plugins/coc-keeper/rulesets/coc7/rule-graph.json` and its candidate shards | R3 | layer assignment for 126 rules |

**Coordination warning.** Another session has been committing to the RuleGraph
continuously and recently — `132fb7c3`, `15097a3b`, `7a86bb9e`, `ecf28936`,
`4c785a70`, `4e617fcd` all land in this area, and one of them closed the
combat→chase hinge that `CURRENT.md` still lists as open. R2 and R3 edit files
that session owns in practice. R1 does not: it lives in campaign state and adds
no graph relation. **R1 MUST be delivered first**, and R2/R3 MUST be
re-checked against that session's state immediately before starting.

---

## 9. Out of scope

- Deciding whether two rulebook rules contradict each other (§6).
- Making `docs/coc7-core-rulegraph-v0.1/` executable, tracked, or a runtime
  input (§3.1). That question is now settled independently: the pack was added
  to `.gitignore` during this work, as "External rulegraph reference pack —
  design reference only, never committed". §3.1 and that entry agree, and this
  specification records the layer taxonomy it borrowed so the design survives
  even though the artifact is not in the repository.
- Any change to dice, arithmetic, or settled-result authority (§3.3).
- Any new blocking gate in the turn (§1).
- A pulp/classic profile mechanism. It would sit naturally on the
  `official_optional` layer once R2 and R3 exist, and it is not this work.

---

## 10. Slices

| Slice | Content | Done when |
| --- | --- | --- |
| R1 | Session rulings: record, persist, retrieve by decision, expire | a ruling recorded in one live Pi-Coc turn is surfaced with its decision in a later turn of the same table, and is gone after its scope ends |
| R2 | Patch relations and `RuleConflict` in the contract and compiler, proven on fixtures with no production patch | two same-layer conflicting patches fail the build with a named actionable error; compatible ones build |
| R3 | Layer assignment for the production graph's 126 rules | every rule carries a layer, `official_optional` rules carry `enabled_by_default`, and the graph rebuilds byte-stably |
| R4 | House-rule import: semantic compile, validation, generated cases, confirmation, versioned patch | a natural-language house rule reaches the graph only after the user confirms its positive, negative and boundary cases, and those cases run as tests |

---

## Revision log

| Date | Change |
| --- | --- |
| 2026-09-02 | Initial specification. Measured on `0.8.1a@98d1246a`: the production graph uses `overrides`/`supersedes` zero times and has no layer or normativity property; `house_rule` is a stat-name label in `coc_state.py`; `keeper_ruling_receipt` is built per turn and never persisted. The eight-layer ladder is adopted as design from the untracked `docs/coc7-core-rulegraph-v0.1/` pack, which validates clean and passes 18/18 of its own tests but instantiates zero patch edges and is wired to nothing. |
