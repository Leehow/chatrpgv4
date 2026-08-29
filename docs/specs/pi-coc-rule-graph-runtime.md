# Pi-Coc RuleGraph source compiler and RulesRuntime replacement specification

> **Status:** Review-annotated — reviewed against repository reality on 2026-08-29. The R1 slice is authorized. R2–R7 remain unauthorized pending their own gates; production implementation beyond R1 is not authorized by this document.
> **ID:** `pi-coc-rule-graph-runtime`
> **Track:** `ACTIVE_IMPLEMENTATION_TRACK=pi-coc`; Codex-host implementation, adapters, prompts, launchers, tests, and documentation remain off-limits.
> **Scope owner:** Pi-Coc host plus the canonical ruleset packages under `plugins/coc-keeper/rulesets/`.
> **Ruleset:** Generic contract with `coc7` as the first production Adapter.
> **Last updated:** 2026-08-29 (revised against repository reality; see Revision log).
> **Depends on:** [`docs/ruleset-contract.md`](../ruleset-contract.md), [`docs/rulebook-abstraction-paradigm.md`](../rulebook-abstraction-paradigm.md), the PDF Source Bundle Contract in `AGENTS.md`, and the existing operation/state/finalization contracts.
> **Prototype evidence:** Artifacts recovered uncommitted in the sibling worktree `chatrpgv4-wt-rule-graph-prototype-20260829` at `/Users/haoli/leehow/code/chatrpgv4-wt-rule-graph-prototype-20260829/plugins/coc-keeper/pi/prototypes/rule-graph/` (`rule_graph_prototype.py`, `candidate-rule-graph.json`, `built-rule-graph.json`, `test_rule_graph_prototype.py`, `README.md`, `VERDICT.md`), based on `0.7.1a@43552e2c`. They are external evidence, not committed to the repository. Future implementation branches use the **`pi-coc/`** prefix.

This is an implementation specification, not implementation authority. It
authorizes no edits to shared kernel, state, registry, ruleset contract, graph
contract, Skill, generated projection, Codex track, push, deploy, migration, or
historical playtest evidence beyond the explicitly authorized R1 slice in §18.1.
Shared-file implementation beyond R1 requires explicit user approval after this
specification is reviewed.

The words MUST, MUST NOT, SHOULD, and MAY below are acceptance requirements.

---

## 1. User job, success condition, and hollow delivery

The user is trying to replace Pi-Coc's Keeper-visible rule-tool choreography
with a deeper rules module. The Keeper should choose one semantic adjudication;
the rules module should discover the applicable source-bound rules, lock
machine-owned inputs, invoke the existing resolver or subsystem, persist through
the existing state/receipt path, and return the next legal decisions.

Success looks like:

- the rulebook is compiled into one evidence-bound RuleGraph rather than being
  separately reinterpreted in JSON tables, checklists, operation descriptors,
  resolver indexes, and Keeper instructions;
- a normal Keeper turn sees one selected `rules.settle` interface, not a list of
  unrelated low-level rule operations;
- `scene.context` and subsystem context can project currently applicable
  `RuleDecisionCard` values without turning them into action gates;
- an improvised or long-tail rule question can exact-discover `rules.context`
  and receive bounded candidates with reasons and source refs;
- each accepted card compiles into the existing ruleset resolver or canonical
  subsystem command path;
- dice, arithmetic, RNG, transactions, state writes, crash recovery, receipts,
  public/concealed projection, and finalization remain with their existing
  deterministic owners;
- the Keeper still decides whether a roll is warranted and semantically chooses
  method, skill, goal, stakes, motive, leverage credibility, and fictional
  consequence;
- graph-backed rule families retire their old Keeper-visible orchestration after
  exact parity and real Pi-Coc acceptance; there is no permanent dual authority;
- new rulesets implement the same small runtime interface while retaining their
  package-specific resolver and subsystem implementations.

Hollow delivery includes:

- wrapping the same 19 `rules.*` operations inside one `kind + arguments:any`
  tool whose interface is just as complex;
- adding RuleGraph beside the current rule index, checklist, tool map, and Skill
  choreography without a staged retirement owner;
- building a second dice engine, state machine, transaction manager, receipt
  store, or finalization path in graph code;
- asking a generic graph traversal or score to select the player's intent,
  social approach, clue relevance, NPC motive, or narration outcome;
- generating the graph from existing JSON/checklist alone and calling that
  source validation;
- using keyword lists or regex over free player prose as rule applicability;
- exposing opaque hashes, UUIDs, generation names, or receipt digests for the
  model to copy between calls;
- replacing CombatSession, ChaseSession, or SanitySession with a universal
  graph interpreter;
- retaining both old and new execution paths after a family reaches accepted
  cutover;
- claiming full-rulebook or whole-product acceptance from the bounded prototype;
- claiming prototype or acceptance evidence that is not present in the
  repository.

### 1.1 Scope

| In scope | Out of scope |
| --- | --- |
| Evidence-bound RuleGraph source compilation | Repository PDF/OCR parser |
| RuleGraph v1 ontology, conditions, coverage, and manifest | Full rulebook extraction in the first slice |
| Deep `RulesRuntime.context/settle` interface | New dice, arithmetic, state, receipt, or finalization engine |
| Compilation to current resolver/subsystem Adapters | Rewriting CombatSession, ChaseSession, or SanitySession |
| Pi card projection and smaller model-visible rule surface | Fixed per-turn rules pipeline |
| Shadow comparison, family cutover, and old-surface retirement | Permanent legacy/graph dual authority |
| Mapping and staged retirement of current 19 `rules.*` operations | Automatic semantic intent/skill/motive selection |
| Ruleset conformance, parity, and real Pi-Coc acceptance | Codex-host track implementation |
| Source/JSON/checklist/code discrepancy findings | Production/shared implementation under this spec-only request |

---

## 2. Confirmed current system and measured gap

The exact-current repository projection, verified against the live registry on
2026-08-29 (`recon-coc7-rules`), contains:

- 143 canonical operations (the `coc_toolbox.py` runtime registry count;
  reconciled from a remembered 141-operation baseline);
- 19 operations under `rules.*` (`coc_toolbox.py:135-154`);
- 32 capabilities advertised by `coc7/resolver.py::public_api_index()`
  (`resolver.py:654-800`);
- 46 `rules-json/*.json` resources, with 89 indexed rule records in
  `rules-json/rule-index.json`;
- six ordinary play/acting baseline operations, including both `rules.roll` and
  the low-level `rules.check` integration primitive.

Current operation execution is:

```text
Keeper typed operation
  -> OperationSpec / operation policy / Pi working set
  -> coc_operation_* adapter
  -> coc_operation_kernel helpers
  -> active ruleset resolver or coc_subsystem_executor
  -> canonical state + source receipts + logs
  -> turn.output_context -> turn.finalize
```

The prior registrar migration successfully moved canonical handlers into
domain-owned `coc_operation_*.py` files and made generated MCP/Pi projections
deterministic. It did not yet create a deep rules module:

- operation-to-capability and resource requirements remain separately declared;
- `public_api_index()`, OperationSpec schemas, generated policy, rules-json,
  rule-index, checklist, and Skill procedures overlap in meaning;
- the Keeper still learns multi-operation sequences from prose;
- rule-specific receipt, retry, target, and route logic remains mixed into the
  large cross-domain operation kernel;
- the existing subsystem executor already accepts strict command kinds and is
  the natural compilation target, but Director `rules_requests` reach it through
  a legacy adapter rather than a source-bound rule decision model.

Examples of choreography currently learned by the Keeper include:

```text
npc.query -> rules.social_adjudicate -> rules.roll -> optional rules.push

rules.psychology_observe(settle)
  -> rules.psychology_observe(realize)

rules.first_aid
  -> rules.dying_check(round|hour)
  -> rules.medicine
  -> rules.weekly_recovery
```

The model-visible working-set budget already limits simultaneous tools, so raw
operation count is not the sole problem. The confirmed gap is that rule
applicability, locked inputs, continuation legality, capability mapping, and
source authority remain caller knowledge instead of module implementation.

---

## 3. Binding design decisions

This specification chooses the following architecture:

1. **RuleGraph is a source-semantic and decision-requirement graph.** It records
   applicability, dependencies, required semantic inputs, source evidence,
   effects, continuations, exceptions, data-table references, and execution
   capability references.
2. **RuleGraph is not the execution engine.** Accepted decisions compile into
   the existing ruleset resolver or canonical subsystem command.
3. **RulesRuntime is the deep module.** Its external interface is exactly
   `context` and `settle`.
4. **Normal context projects cards.** `scene.context`, combat/chase/sanity
   context, and recovery projections may supply relevant cards; the Keeper does
   not call `rules.context` every turn.
5. **Long-tail context is exact-discovery only.** `rules.context` is loaded only
   for one concrete rule question that current context cannot answer.
6. **One settlement interface replaces choreography.** Follow-ups such as Push,
   Luck, Psychology realization, dying clocks, Medicine, and weekly recovery are
   later cards settled through the same interface.
7. **Existing stateful subsystem modules remain deep.** Combat, chase, and
   sanity keep their internal engines and may retain their context/execute/end
   interfaces until a separate accepted design proves a smaller interface.
8. **Migration is family-scoped and single-owner.** At any runtime revision, a
   rule family has exactly one Keeper-visible owner: legacy, shadow, graph, or
   retired. Shadow never executes twice.
9. **Storage is ordinary validated JSON.** No Neo4j, GraphRAG, vector database,
   RDF store, or network service is introduced without measured need.
10. **Source evidence is independent of existing derivatives.** Existing JSON,
    code, checklist, and tests are parity evidence, not the source from which the
    graph is reconstructed.

---

## 4. Authority planes

The following authority planes MUST remain distinct:

```text
accepted rulebook page Markdown
  -> RuleGraph                           [source semantics and decisions]

rules-json / package data resources      [numeric and catalog data]
resolver.py / subsystem engines          [deterministic execution]
state.* / transaction machinery          [canonical mutation]
source receipts / logs                    [settlement evidence]
turn.output_context / turn.finalize       [player output completeness]
Keeper semantic judgment                 [meaning and fiction]
```

### 4.1 RuleGraph authority

RuleGraph MAY authoritatively state:

- which structured conditions make a decision applicable;
- which inputs are Keeper-semantic versus host-locked;
- which rules, source spans, tables, resources, and capabilities govern it;
- which effects or pending choices it may emit;
- which state transition makes a later decision applicable;
- which rule types or contexts forbid a continuation;
- which source-supported exception overrides a more general rule.

RuleGraph MUST NOT:

- roll dice or recompute resolver output;
- write campaign state;
- fabricate a missing state fact;
- promote a source claim into campaign canon;
- expose a secret as player knowledge;
- decide from player prose that a rule applies;
- choose a skill because it has the highest value;
- select a social motive/leverage judgment;
- render final narration;
- treat graph absence as permission or as proof that no rule exists.

### 4.2 Numeric and catalog authority

Large data tables such as skills, weapons, equipment, spells, monsters, cash,
and damage scales MAY remain in `rules-json` as package-owned materialized data
resources. RuleGraph references them by semantic table/record identity rather
than copying every row into graph properties.

A numeric value MUST have one runtime owner:

- if the value is in a rules-json table, the graph references the table cell or
  record and does not duplicate the number;
- if the value is a graph condition constant, it is not separately hand-authored
  in a tool map or Skill;
- if the value is computed, resolver code owns the formula and the graph names
  the capability plus its required inputs.

### 4.3 Execution authority

`resolver.py` remains the only kernel-facing ruleset execution seam. The
existing subsystem executor remains the owner of command validation, RNG
consumption, atomic execution, pending choices, persisted snapshots, replay,
and recovery.

### 4.4 Keeper authority

The Keeper retains semantic judgment over:

- whether uncertainty and stakes justify a roll;
- intended method, target, goal, precautions, and requested conclusion;
- professional versus general-perception skill selection;
- environment and difficulty judgments not fixed by source/state;
- NPC motive and leverage relevance/credibility;
- voluntary player decisions;
- fictional realization and final prose.

The graph can demand a semantic input and source-backed reason. It cannot
replace that input with a keyword classifier.

---

## 5. Domain model

| Term | Meaning | Authority |
| --- | --- | --- |
| Rule Source Bundle | External PDF capability output containing accepted page Markdown and page/hash evidence. | External PDF workflow plus repository bundle validation. |
| Rule EvidenceSpan | Exact source range identified by semantic ID; machine binds page, line, bytes, hashes, and anchors. | Deterministic evidence builder. |
| RuleGraph Candidate | Model-produced nodes, relations, conditions, and decisions for a bounded source packet. | Untrusted semantic proposal. |
| Accepted RuleShard | Candidate that passes deterministic validation plus independent semantic review. | Accepted source compilation for its declared scope. |
| RuleGraph | Deterministic merge of accepted RuleShards for one ruleset/version. | Rebuildable source-semantic graph. |
| RuleFamily | Cohesive ownership unit such as core-check, push/luck, social, psychology, healing, combat, chase, sanity, magic, or development. | RuleGraph BuildManifest. |
| RuleDecision | One semantic adjudication that may currently be selected. | RuleGraph plus live applicability overlay. |
| RuleDecisionCard | Model-safe projection of one RuleDecision with required semantic inputs and locked execution facts. | RulesRuntime read projection. |
| RuleDecisionPlan | Fully bound, host-validated compilation of one selected card. | RulesRuntime; model never authors the plan directly. |
| Capability | Existing resolver function or subsystem command target. | Active ruleset `public_api_index()` plus subsystem registry. |
| Settlement | Existing resolver result, subsystem result, state effect, and source receipt set. | Existing deterministic owners. |
| FamilyRuntimeOwner | Exact runtime owner of one RuleFamily: legacy, shadow, or graph. | Versioned migration manifest. |
| LegacyKeeperSurface | Lifecycle of the old model-visible operations for one family: visible, hidden, or removed. | Versioned migration manifest plus generated policy. |

---

## 6. Source compilation contract

The repository still contains no PDF parser. RuleGraph compilation starts only
from a validated external source bundle or an already accepted page-level
Markdown corpus. It MUST reuse the existing page/evidence binding machinery
rather than introducing another PDF/OCR dependency.

### 6.1 Deep RuleGraph Compiler module

The compiler interface is:

```text
prepare(SourceSelection) -> RuleExtractionPacket
accept(RuleExtractionPacket, RuleGraphCandidate) -> AcceptedRuleShard | Findings
build(AcceptedRuleShard[]) -> RuleGraph + RuleGraphBuildManifest | Findings
```

It hides:

- page Markdown selection and EvidenceSpan binding;
- model-safe semantic IDs and source views;
- ontology and closed-schema validation;
- condition-language validation;
- source page/hash/anchor verification;
- relation and capability resolution;
- rules-json/table reference validation;
- cross-shard merge and conflict detection;
- coverage aggregation;
- family ownership eligibility;
- atomic generated artifact writes.

ModuleGraph and RuleGraph are two real consumers of source evidence binding.
The implementation SHOULD reuse or extract one internal source-evidence module
for packet/span/hash work. Their ontologies, authority, visibility, and runtime
consumers remain separate.

### 6.2 Model extraction responsibilities

The extractor receives one closed source packet and proposes:

- semantic rule, decision, condition, effect, exception, and capability refs;
- source-language labels and concise reasons;
- structured conditions over registered fields;
- which inputs remain Keeper-semantic;
- rule-family coverage status and known gaps.

The extractor MUST NOT:

- copy or generate source hashes, UUIDs, receipts, temp paths, or generation IDs;
- infer PDF/page offsets;
- write campaign state;
- infer an execution capability that the target ruleset does not advertise;
- translate source prose into campaign language and write it back;
- use existing JSON/checklist as a substitute for source evidence;
- claim complete coverage outside the packet's declared aspects.

### 6.3 Independent evidence and parity

Promotion requires three distinct evidence classes:

1. **Source binding:** graph claims resolve to accepted source spans.
2. **Derivative parity:** relevant rules-json, rule-index, checklist, Skill, and
   operation metadata either agree or produce an explicit finding.
3. **Execution parity:** the graph decision compiles to the current resolver or
   subsystem behavior with matching result/state/receipt semantics.

Derivative disagreement never automatically changes the graph to match the
derivative. Semantic review returns to the source.

The bounded prototype demonstrated why this matters: an existing checklist
predicate used floor-half for an odd maximum-HP major-wound threshold, while the
source example, current combat implementation, and regression use ceiling-half.
This specification records the discrepancy as evidence; it does not authorize a
production checklist edit. (This remains an open recorded finding in §20.)

### 6.4 Ruleset package artifacts

An accepted graph-backed ruleset package adds exactly:

```text
plugins/coc-keeper/rulesets/<id>/rule-graph.json
plugins/coc-keeper/rulesets/<id>/rule-graph-manifest.json
```

and extends `manifest.json.entry_points` with semantic paths for those two
artifacts. Candidate packets, rejected candidates, semantic reviews, and
intermediate RuleShards remain in the bounded external/build evidence root;
they are not runtime readers and are not copied wholesale into the package.

`rule-graph-manifest.json` contains at least:

- contract ID and schema version;
- ruleset ID and exact ruleset version;
- accepted source-bundle identity and machine digest;
- graph content digest;
- accepted RuleShard identities and digests;
- per-family source coverage;
- per-family runtime promotion eligibility;
- exact data-table and resolver capability dependencies;
- compiler/reviewer identity and review status.

Digests are machine-owned integrity fields. Model-visible projections expose
semantic graph/rule/decision/source refs but never require the model to relay
manifest or content hashes.

Graph and manifest are exact-version package artifacts. A ruleset/graph contract
change is atomic across the package manifest, generated graph, relevant
rules-json projections, resolver, Skills, conformance tests, and operation
projections. No graph migration or dual reader is added.

### 6.5 Source and presentation language

- Every source packet, RuleShard, RuleGraph, and build manifest declares
  `source_language`.
- Source-derived names, labels, reasons, and summaries remain in source language.
- Machine IDs, field paths, enums, and capability names remain ASCII semantic
  data.
- RulesRuntime MAY project an existing ruleset-localized label for the active
  `play_language`, but the localization is a presentation field and never
  rewrites RuleGraph or source aliases.
- Exact source quotations are Keeper/audit evidence and are not copied into
  ordinary player-facing cards.
- A language mismatch never changes applicability, arithmetic, visibility, or
  runtime authority.

---

## 7. RuleGraph v1 machine contract

The exact enums and field schemas MUST live in one machine-readable contract,
proposed as:

```text
plugins/coc-keeper/references/rule-graph-contract-v1.json
```

The prose below defines semantic law, not a second enum list.

### 7.1 Node kinds

V1 requires at least:

- `ruleset`
- `source-document`
- `source-section`
- `rule-family`
- `rule`
- `decision`
- `condition`
- `input-slot`
- `capability`
- `data-table`
- `data-record`
- `resource`
- `effect`
- `pending-choice`
- `continuation`
- `exception`
- `subsystem`
- `visibility-policy`

Use a Node when the item needs independent identity, provenance, relations,
coverage, visibility, or lifecycle. Small display attributes remain properties.

### 7.2 Relation kinds

V1 requires at least:

- `part-of`
- `sourced-from`
- `available-when`
- `requires-fact`
- `requires-input`
- `locks-input`
- `invokes`
- `implemented-by`
- `reads-table`
- `emits`
- `mutates-resource`
- `continues-as`
- `offers-choice`
- `forbids`
- `overrides`
- `supersedes`
- `applies-to`

Every relation has one direction and one meaning. Array order is never a rule
dependency. `continues-as` describes a possible next decision after a state
change; it does not make a fixed turn pipeline.

### 7.3 Semantic IDs

Every model-visible identifier is semantic and namespaced:

```text
rule:coc7:healing:first-aid-stabilization
decision:coc7:healing:administer-first-aid
condition:coc7:healing:dying-unstabilized
capability:coc7:first-aid
effect:coc7:healing:temporary-stabilization
```

The runtime may store hashes internally, but the model never relays them.
RuleGraph generation, state revision, and card-grant integrity are attached by
the host after the model's semantic payload.

### 7.4 Condition language

Conditions use a closed structural language over registered paths. V1 operators
are bounded to the smallest set required by accepted families, for example:

```text
all / any / not
eq / neq
lt / lte / gt / gte
contains / not-contains
exists
```

Conditions MAY read only registered facts owned by:

- current campaign/ruleset binding;
- actor sheet/resource projection;
- current subsystem snapshot;
- canonical scene/NPC/evidence refs;
- selected semantic intent/result supplied by the Keeper;
- canonical receipts and pending choices;
- game time and registered clocks.

Conditions MUST NOT read arbitrary player prose, narration text, local paths,
unregistered JSON properties, or hidden source fields not projected for the
decision.

Computed thresholds either reference a rules-json value or invoke a named pure
resolver capability. They are not free-form expressions evaluated by the graph.

### 7.5 Decision input ownership

Each decision input slot is exactly one of:

- `keeper-semantic`: selected by the Keeper with a reason;
- `player-source`: copied from the current player message or a typed player
  choice by the host;
- `host-locked`: injected from canonical state, ruleset, card grant, or receipt;
- `resolver-owned`: computed only during execution;
- `optional-semantic`: Keeper-provided only when applicable.

The model cannot override host-locked or resolver-owned fields. A generic
`arguments` bag is forbidden.

### 7.6 Authority and visibility

Each Rule, Decision, Condition, and Effect declares:

- `authority`: `deterministic | keeper-semantic | mixed`;
- `audience`: `keeper | host-internal | audit`;
- `visibility`: `public | keeper-only | concealed-result` when relevant;
- `hard_gate`: true only for deterministic source/state invariants;
- source refs and implementation refs.

An advisory semantic condition cannot silently become a hard execution gate.

### 7.7 Coverage and build state

Each RuleFamily has coverage:

```text
accepted | partial | unresolved | absent
```

and runtime ownership:

```text
legacy | shadow | graph
```

The old model-visible surface has a separate lifecycle:

```text
visible | hidden | removed
```

Rules:

- `accepted` means source semantics for the declared family scope passed review;
- `partial` means useful nodes exist but runtime promotion is forbidden;
- `unresolved` means the source packet did not settle the family;
- `absent` means the reviewed source scope proves the family is absent;
- `shadow` requires accepted source coverage and may compare plans but never
  double-executes;
- `graph` requires all promotion gates in section 14;
- `hidden` means an old operation may remain as a host-internal execution
  Adapter but is absent from Keeper discovery and working sets;
- `removed` means the obsolete descriptor/adapter has been deleted;
- one family cannot have runtime owner `graph` while its legacy Keeper surface
  remains `visible`.

---

## 8. Deep RulesRuntime module and seam

### 8.1 External interface

RulesRuntime exposes exactly one interface with two methods:

```text
context(RuleQuestion?) -> RuleContextResult
settle(SelectedRuleDecision, decision_id) -> SettlementResult
```

The Pi typed operations are:

```text
rules.context
rules.settle
```

This is an in-process deep module. It does not require a port: production and
tests use the same compiler/runtime with injected resolver and state
dependencies. Ruleset resolver packages are the existing real Adapters.

### 8.2 Deletion test

Deleting RulesRuntime must force callers to reimplement:

- graph load/generation verification;
- family ownership and coverage selection;
- live-state overlay and condition evaluation;
- semantic versus locked input ownership;
- decision-card construction and sanitization;
- rule/table/source/capability resolution;
- stale-card and idempotency binding;
- resolver/subsystem command compilation;
- continuation-card projection;
- shadow comparison and retirement evidence.

Because this complexity would reappear across Pi working-set code, 19 operation
adapters, Skills, tests, and future rulesets, the module is sufficiently deep.

### 8.3 `rules.context`

Normal play SHOULD receive cards through `scene.context`, subsystem context, or
recovery projections. Direct `rules.context` is exact-discovery only.

> **Exact-discovery is a hard enforcement requirement, not advisory prose.**
> `rules.context` MUST be absent from the ordinary play/acting working set and
> loadable only by exact semantic name (the operation id), through generated
> operation policy and working-set projection. This mirrors the existing
> exact-operation loader contract (`coc_discover` with a single dotted
> operation id, executed at loading and re-projected through `setActiveTools`;
> execute-time ACL remains authoritative). The rule-graph runtime MUST generate
> and test this policy/projection before `rules.context` is usable in normal
> play; it MUST NOT rely on Skill prose to teach exact-only discovery.
>
> **Named R2 prerequisite gap:** the current repository does not yet bind
> `rules.context` into a generated working-set policy. Until the exact-discovery
> projection for `rules.context` is built and tested, `rules.context` is NOT
> safe to expose in ordinary play. This gap is an R2 prerequisite; it must be
> closed before the `rules.context` typed operation is promoted onto any
> ordinary play/acting working set.

Illustrative request:

```json
{
  "campaign": "campaign-id",
  "question": {
    "kind": "procedure",
    "actor_ref": "pc:harvey",
    "goal": "stabilize the dying investigator",
    "selected_affordance_ids": ["aid-harvey"],
    "semantic_reason": "the player applies First Aid before the round clock"
  }
}
```

Rules:

- `question` is structured semantic output, never raw player prose;
- campaign, ruleset, live state, graph generation, and current receipts are
  host-resolved;
- `selected_affordance_ids` must resolve against current context;
- omitted question returns family/status information only when explicitly
  requested outside ordinary play;
- result cards are bounded to 1–8;
- a miss means `no_candidate_in_compiled_scope`, not “no rule exists”;
- candidates never force the Keeper to roll or select an action.

Example of an existing exact-operation enforcement pattern this mirrors —
`plugins/coc-keeper/skills/coc-keeper-play/SKILL.md` and
`docs/specs/pi-coc-tool-affordance-and-bounded-recovery.md` — uses a
single-operation loader plus `setActiveTools`, with execute-time ACL as the
final authority. The rule-graph runtime follows the same pattern for
`rules.context`.

### 8.4 `RuleDecisionCard`

Illustrative model-safe card:

```json
{
  "schema_version": 1,
  "decision_ref": "decision:coc7:healing:administer-first-aid",
  "family": "healing",
  "label": "Administer the current First Aid attempt",
  "applicability": "applicable",
  "required_inputs": [
    {
      "name": "rescuer_ref",
      "owner": "keeper-semantic",
      "type": "actor-ref"
    }
  ],
  "locked_inputs": [
    "patient_ref",
    "skill_value",
    "pushed_status",
    "wound_ref"
  ],
  "rule_refs": [
    "rule:coc7:healing:first-aid-stabilization"
  ],
  "source_refs": [
    "source:coc7:keeper-rulebook:page-120:first-aid"
  ],
  "capability_ref": "capability:coc7:first-aid",
  "effect_refs": [
    "effect:coc7:healing:temporary-stabilization"
  ],
  "possible_continuations": [
    "decision:coc7:healing:administer-medicine",
    "decision:coc7:healing:resolve-hour-clock"
  ],
  "authority": {
    "selection": "keeper-semantic",
    "execution": "current-ruleset-adapter",
    "hard_gate": false
  }
}
```

The card does not contain state hashes, receipt hashes, random IDs, file paths,
secret prose, or model-authored numeric state.

### 8.5 Turn-scoped settlement schema

> **V1 defers the dynamic per-turn compiled settle schema.** The sole authority
> in V1 is a **static, typed `rules.settle` schema** plus execute-time ACL and
> RulesRuntime state recheck. Dynamic per-turn schema compilation is **deferred**
> until measured tool/schema budget pressure exists and is not a V1 deliverable.

The deferred design (kept for when budget pressure is measured) is:

The Pi host compiles the active card set into a turn/epoch-scoped
`rules.settle` schema:

- `decision_ref` is an enum of the exact active semantic decision refs;
- `semantic_inputs` is a discriminated `oneOf` for those cards;
- host-locked fields are absent from the model schema;
- the schema grant is bound internally to role, phase, stage, player-turn epoch,
  canonical progress revision, ruleset version, and graph generation;
- stale grants fail before resolver invocation;
- the working-set budget remains authoritative.

Until that dynamic form ships, V1 uses one fixed, typed `rules.settle` schema.
This static schema MAY still be a typed projection (a closed enum of semantic
decision refs and a `semantic_inputs` object with allowed fields), but the V1
runtime does not compile a fresh per-turn schema. Execute-time ACL and the
RulesRuntime state recheck remain authoritative in both forms. A dynamic schema
is never a new authorization engine.

### 8.6 `rules.settle`

Illustrative request:

```json
{
  "campaign": "campaign-id",
  "decision_ref": "decision:coc7:healing:administer-first-aid",
  "semantic_inputs": {
    "rescuer_ref": "npc:doctor-one",
    "changed_method": "replace the packing and maintain the airway",
    "failure_consequence": "the next dying CON clock resolves immediately"
  },
  "decision_id": "healing:harvey:first-aid:attempt-2"
}
```

RulesRuntime then:

1. reloads current family ownership, graph, state, receipts, and card grant;
2. rejects stale or no-longer-applicable decisions;
3. resolves every host-locked input;
4. validates Keeper-semantic inputs and source refs;
5. compiles one immutable RuleDecisionPlan;
6. invokes exactly one existing resolver/subsystem settlement path;
7. reuses existing idempotency, transaction, state, receipt, and log machinery;
8. returns the existing settlement plus bounded next decision cards.

It never asks the model to echo a plan digest or receipt identity.

### 8.7 Settlement result

RulesRuntime wraps, but does not replace, the existing result:

```json
{
  "decision_ref": "decision:coc7:healing:administer-first-aid",
  "family": "healing",
  "status": "settled",
  "rule_refs": ["rule:coc7:healing:first-aid-stabilization"],
  "settlement": {
    "existing_result_envelope": true
  },
  "next_decisions": [],
  "authority": "canonical-resolver-state-receipts"
}
```

Public dice and state changes continue to render only through
`turn.output_context` and `turn.finalize`.

---

## 9. Execution compilation and existing Adapters

### 9.1 Resolver Adapter

RulesRuntime resolves the campaign's active package through
`get_resolver(campaign)`. A Capability node must resolve through
`public_api_index()` before promotion or settlement.

The graph may bind:

- `check`
- `resource_delta`
- package-specific pure computations;
- package-specific command builders;
- subsystem session entry/command capabilities.

Missing capabilities return `unsupported_ruleset_operation`; the kernel never
substitutes CoC7 behavior.

### 9.2 Subsystem command Adapter

Stateful decisions compile into the current strict command shape:

```text
{command_id, kind, phase, payload}
```

Command identity is runtime-owned. RuleGraph supplies semantic decision and
capability identity; the host derives command IDs and roll IDs.

`coc_subsystem_executor` continues to validate complete command batches before
RNG or mutation and continues to own persisted result snapshots and pending
choices.

### 9.3 No universal graph interpreter

RuleGraph conditions only select and bind decisions. Resolver/subsystem code
continues to implement:

- percentile and dice-expression arithmetic;
- opposed/combat tie rules;
- damage chains, armor, ammo, wounds, and death;
- push/Luck settlement;
- SAN, bout, indefinite/permanent insanity;
- chase position/action economy;
- healing and recovery state;
- magic, hazards, development, and package-specific effects.

---

## 10. ModuleGraph, campaign state, and RuleGraph composition

ModuleGraph and RuleGraph remain separate graphs with typed cross-references:

```text
ModuleGraph rule/procedure declaration
  -> uses-rule -> RuleGraph Rule/Decision semantic ref

RuleDecisionCard
  -> requires-fact -> authored/live fact ref

RulesRuntime
  -> overlays current state and receipts
  -> invokes resolver/subsystem
```

Rules:

- ModuleGraph owns authored scenario declarations and module-specific
  exceptions;
- RuleGraph owns ruleset semantics and decision requirements;
- campaign state owns current facts and effects;
- source graph disagreement with campaign canon does not rewrite either graph;
- a module exception must cite a source-supported `overrides` relation and an
  existing general rule;
- ModuleGraph cannot directly authorize a state write or resolver result;
- RuleGraph cannot reveal ModuleGraph secrets;
- no combined mega-graph becomes a new Keeper or state authority.

---

## 11. Current operation mapping and retirement target

The current 19 `rules.*` operations map as follows:

| Current operation | Target owner | Final Keeper surface |
| --- | --- | --- |
| `rules.build_scale` | RuleGraph lookup + current data/resolver | `rules.context` card/query |
| `rules.cash_assets` | RuleGraph lookup + current data/resolver | setup/context card; not ordinary hot path |
| `rules.catalog_search` | RuleGraph table candidate lookup | `rules.context`; semantic selection remains KP-owned |
| `rules.check` | Cross-ruleset low-level resolver Adapter | host-internal; never normal Keeper baseline |
| `rules.damage` | Effect decision + current resolver/state path | `rules.settle` |
| `rules.dying_check` | Healing continuation decision | `rules.settle` |
| `rules.first_aid` | Healing decision | `rules.settle` |
| `rules.luck_spend` | Eligible failed-roll continuation | `rules.settle` |
| `rules.medicine` | Healing decision | `rules.settle` |
| `rules.opposed` | Noncombat opposed decision | `rules.settle` |
| `rules.psychology_observe` | Concealed settle card then semantic realization card | `rules.settle` twice, same frozen settlement |
| `rules.push` | Ordinary-failure continuation card | `rules.settle` |
| `rules.resource_delta` | Cross-ruleset low-level state effect Adapter | host-internal; graph effects invoke it |
| `rules.roll` | Contextual check decision | `rules.settle` |
| `rules.roll_dice` | Retained host-internal adapter (setup/randomization only) | host-internal; **never a `rules.settle` decision** |
| `rules.sanity_check` | Sanity decision compiled to current SanitySession | `rules.settle`; session engine retained |
| `rules.skill_describe` | RuleGraph/table lookup | `rules.context` |
| `rules.social_adjudicate` | Social decision compilation | combined into one `rules.settle` settlement with optional roll |
| `rules.weekly_recovery` | Healing continuation decision | `rules.settle` |

Combat, chase, and sanity subsystem operations are not counted in the 19 and are
not automatically retired by this specification.

### 11.1 Low-level primitives

`rules.check` and `rules.resource_delta` MAY remain canonical internal
primitives for multi-ruleset execution. They MUST leave the ordinary Keeper
working set after graph promotion and must not require the Keeper to construct
package-native requests.

### 11.2 Social atomicity

The social card carries Keeper-selected approach, goal, motive direction,
evidence refs, and leverage judgments. One settlement validates provenance,
computes feasibility/difficulty, and—only when feasibility is `roll`—settles the
bound check without a second model-authored transfer of skill, difficulty,
bonus/penalty, NPC, or goal identity.

Automatic/conditional results return without rolling. An ordinary failed roll
may project a separate Push card when legal.

### 11.3 Psychology secrecy

Psychology remains two semantic decisions over one concealed settlement,
expressed as **two distinct `decision_ref`s AND two distinct `decision_id`s**:

1. concealed observation settlement (
   `decision_ref` = `decision:coc7:psychology:observe-concealed`;
   `decision_id` = `psychology:<investigator>:<scene>:observe-concealed`);
2. player-safe realization (
   `decision_ref` = `decision:coc7:psychology:realize-player-safe`;
   `decision_id` = `psychology:<investigator>:<scene>:realize-player-safe`).

Both use `rules.settle`. The realization `decision_id` fingerprint binds the
frozen observe-settlement identity: the host re-attaches the observe settlement
digest/identity after the model's semantic payload, and the model never echoes a
hash or digest. The realization decision performs **no RNG and no re-execution**
and receives only the inference ceiling plus external-behavior inputs. Concealed
dice/outcome never enter player-visible fields.

---

## 12. Pi working-set integration

The normal play/acting baseline target is:

```text
scene.context
actions.list
rules.settle
npc.query
state.journal
```

`rules.check` and `rules.roll` leave the baseline after accepted promotion of
the ordinary-check family.

> **V1 note:** in V1 the `rules.settle` schema is static and typed (see §8.5);
> dynamic per-turn schema compilation is deferred. The working set still
> advertises `rules.settle` and bounds the visible card set against the existing
> tool/schema budget, but it does not compile a fresh per-turn schema.

Rules:

- active decisions come from stage baseline, structured scene/subsystem
  affordances, current pending choices, exact `rules.context` grants, and
  recovery routes;
- candidate cards count against the existing tool/schema budget;
- only the selected cards appear in the settle schema;
- card grants expire on role/phase/stage/player-turn-epoch changes;
- canonical progress revision invalidates stale schema grants;
- execute-time ACL and RulesRuntime state recheck remain authoritative;
- namespace-wide discovery remains forbidden during ordinary play;
- graph load failure never causes the host to advertise an untyped generic
  `rules.settle` input bag.

---

## 13. State, idempotency, receipts, and finalization

RuleGraph introduces no campaign-state schema and no new receipt store.
The RuleGraph build-evidence root (§6.4) is compile-time acceptance evidence
owned by the compiler; it is not a settlement receipt store, and RuleGraph
introduces no new runtime receipt store. Canonical roll/source/state receipts
remain the only settlement evidence.

### 13.1 Idempotency

`decision_id` remains the identity of one immutable settlement request. The
fingerprint binds:

- semantic `decision_ref`;
- normalized Keeper-semantic inputs;
- host-attached ruleset/graph family ownership;
- existing authoritative actor/target/source refs;
- resolver/subsystem request after locked-input resolution.

Exact replay returns the existing settlement. Same ID with different semantic
inputs or a different compiled request returns `idempotency_conflict` before RNG
or mutation.

### 13.2 State writes

RulesRuntime never edits save files directly. It invokes existing transactional
state/resolver/subsystem paths. Current-value fields are host-read and absent
from model input.

### 13.3 Receipts and logs

Existing roll/source/state receipts and append-only logs remain canonical.
RuleGraph semantic refs MAY be added to their existing rule-ref projection only
through the owning receipt contract. A graph result is not itself a settlement
receipt.

### 13.4 Finalization

`turn.output_context` discovers the same canonical settlements and
`turn.finalize` enforces the same public/concealed placement, causal coverage,
exceptional-effect, player-agency, and exact-once rules. Neither operation reads
RuleGraph as a substitute for receipts.

---

## 14. Shadow, promotion, cutover, and retirement

### 14.1 Shadow is comparison, not double execution

For a `shadow` family:

1. the existing legacy path remains the sole execution owner;
2. RuleGraph compiles a candidate RuleDecisionPlan before RNG/mutation;
3. the legacy Adapter produces its normalized request/command without executing;
4. a comparator records exact semantic differences;
5. only the legacy request executes once;
6. mismatch is acceptance evidence, never permission to invoke both.

Shadow comparisons ignore only runtime-owned identities that are deterministically
reattached. Capability, phase, semantic inputs, locked inputs, rule refs,
resource effects, visibility, and pending-choice semantics must match.

### 14.2 Family promotion gates

A family may change from `shadow` to `graph` only when all are true:

1. source coverage is `accepted` with no unresolved applicable rules;
2. graph contract and evidence binding pass;
3. all referenced data tables and capabilities resolve;
4. deterministic graph-to-existing request/command parity passes;
5. settlement result, state, roll, receipt, replay, and recovery parity pass;
6. negative cases prove forbidden decisions are absent or fail closed;
7. graph unavailability/staleness tests pass;
8. Pi working-set schema and ACL tests pass;
9. at least one fresh Pi-Coc RPC run with Grok as Keeper reaches the family
   naturally through normal typed operations;
10. exact Keeper text, player reply, calls, state, rolls, and evidence are
    preserved;
11. no opposite-track or unauthorized shared edit is included;
12. baseline failures are either fixed in scope or reproduced unchanged and
    proven not to intersect the promoted seam.

### 14.3 Cutover

At `graph` ownership:

- `rules.context/settle` are the sole Keeper-visible owners for that family;
- legacy handlers may remain internal execution Adapters temporarily;
- old Keeper-facing discovery/prompt guidance is removed for the family;
- generated operation policy no longer advertises the old operations to the KP;
- graph invalidity fails closed for the promoted family; it does not silently
  fall back to legacy orchestration.

### 14.4 Retirement

After runtime ownership is `graph`, legacy Keeper surfaces progress from
`hidden` to `removed` where the internal Adapter no longer earns its keep:

- duplicate OperationSpec descriptors are deleted or made strictly internal;
- duplicate capability/resource maps are generated from the accepted contract
  or removed;
- old Skill choreography is replaced by semantic rules and card guidance;
- tests move to the RulesRuntime interface and retained subsystem interfaces;
- tests of deleted shallow adapters are removed rather than layered forever;
- direct source re-interpretation for the family is forbidden.

No full ruleset may be called migrated while any accepted family remains in
`shadow` or graph-backed families retain duplicate Keeper-visible ownership.

---

## 15. Failure semantics

| Failure | Required behavior |
| --- | --- |
| No RuleGraph for a legacy family | Use the explicitly declared legacy owner; do not pretend graph support. |
| No RuleGraph for a graph-owned family | `rules_graph_unavailable`; fail before RNG/mutation; no fallback. |
| Invalid graph/manifest/evidence | Fail closed for graph-owned families; retain exact finding. |
| Partial/unresolved family | Not promotable; context reports scope gap. |
| No candidate | `no_candidate_in_compiled_scope`; KP may decide no roll or ask a narrower semantic question. |
| Stale card grant | `rule_decision_stale`; return refreshed bounded cards when safe. |
| Decision no longer applicable | `rule_decision_not_applicable`; no execution. |
| Missing Keeper-semantic input | `missing_semantic_input`; return exact field and reason. |
| Model supplies host-locked field | `locked_input_override`; fail closed. |
| Missing resolver capability | `unsupported_ruleset_operation`; never substitute another ruleset. |
| Graph/legacy shadow mismatch | Log acceptance finding; execute legacy once; family remains shadow. |
| Reused decision ID with drift | `idempotency_conflict`; no RNG/mutation. |
| Concealed decision projected publicly | hard secrecy failure; no player delivery. |
| Context contains too many cards/schema bytes | bounded overflow finding; require a narrower semantic question, never expose generic arguments. |
| Graph cycle with no state-changing guard | build failure. |
| Source/checklist/JSON disagreement | semantic review against source; no automatic majority vote. |

---

## 16. Performance and storage

- RuleGraph is validated JSON loaded in process and cached by ruleset/version.
- Graph integrity digests are machine-internal.
- Runtime queries traverse prebuilt indexes over decision family, condition
  fields, capability, source, and table refs.
- Live context evaluates only the active family's candidate decisions.
- Direct context returns at most eight cards.
- No graph database, embedding index, or remote call is allowed in V1.
- A future storage Adapter requires measured JSON load/query cost and must not
  change the RulesRuntime interface or authority semantics.
- Graph compilation may be offline/model-backed; live context and settlement
  must not invoke another LLM.

---

## 17. Security, secrecy, and model-visible projection

- RuleGraph source artifacts are Keeper/audit material, never a player tool.
- Player-safe fields are allowlisted; they are not created by serializing a
  secret-rich graph and deleting keys afterward.
- Model-visible cards omit source prose that is not necessary for adjudication.
- Concealed Psychology and secret module rules retain current visibility rules.
- Local source paths, bundle hashes, graph digests, receipt hashes, RNG seeds,
  and temp names remain host-internal.
- Semantic IDs follow the Model-Facing Identifier Law.
- Graph conditions cannot read arbitrary filesystem or environment data.
- Runtime capability binding is allowlisted through the active ruleset and
  subsystem registries.
- RuleGraph never widens the current tool ACL, role, phase, or stage.

---

## 18. Implementation slices and exact scope

### R0 — Spec and bounded prototype

Status: **artifacts recovered in the external worktree; not committed to this
repository.**

The prototype artifacts were recovered uncommitted in the sibling worktree
`/Users/haoli/leehow/code/chatrpgv4-wt-rule-graph-prototype-20260829/plugins/coc-keeper/pi/prototypes/rule-graph/`
(`rule_graph_prototype.py`, `candidate-rule-graph.json`,
`built-rule-graph.json`, `test_rule_graph_prototype.py`, `README.md`,
`VERDICT.md`), based on `0.7.1a@43552e2c`.

`VERDICT.md` claims, independently readable on 2026-08-29:

- 30 nodes / 38 edges / 7 rulebook evidence spans;
- 6 prototype checks + 42 current healing-engine checks + 2 current subsystem
  rescue checks green at prototype time;
- J1 floor-vs-ceiling checklist drift recorded (the prototype graph records the
  source-consistent ceiling rule; production files were not changed).

R1 conformance tests still rebuild the key claims as committed in-repo
executable evidence because the worktree is not a durable home. The prototype is
**not imported**: its own README states it is throwaway code, not production
code, not a second rules engine, and not a full rulebook extraction. Final
disposition of the uncommitted worktree is the user's call at closeout.

Future implementation branches use the **`pi-coc/`** prefix, not `codex/`.

### R1 — RuleGraph contract and compiler

Status: **authorized** (the R1 slice only).

The R1 slice is scoped minimal, delivering exactly:

- `plugins/coc-keeper/references/rule-graph-contract-v1.json` — full v1
  node/relation enums (data is cheap; avoids contract churn);
- `plugins/coc-keeper/scripts/coc_rule_graph.py` — implementing exactly
  `prepare(SourceSelection) -> RuleExtractionPacket`,
  `accept(RuleExtractionPacket, RuleGraphCandidate) -> AcceptedRuleShard | Findings`,
  `build(AcceptedRuleShard[]) -> RuleGraph + RuleGraphBuildManifest | Findings`
  with deterministic validation and evidence binding;
- focused conformance tests over a **bounded healing-family fixture packet**;
- ruleset manifest contract update for the two graph artifacts
  (`rule-graph.json`, `rule-graph-manifest.json`).

Explicitly **NO runtime operation changes in R1**. **NO full-rulebook
extraction.** No Keeper-visible surface changes. R2–R7 remain unauthorized
pending their own gates.

### R2 — RulesRuntime shadow for healing

Proposed paths:

- `plugins/coc-keeper/scripts/coc_rules_runtime.py`
- internal current-resolver and subsystem Adapters
- healing family ownership manifest entry
- shadow comparator and focused tests
- the `rules.context` exact-discovery working-set policy/projection (see §8.3)

Execution remains legacy exactly once.

### R3 — Healing graph promotion

- project healing cards into current scene/recovery context;
- add model-visible `rules.settle` for the promoted family;
- remove `rules.first_aid`, `rules.dying_check`, `rules.medicine`, and
  `rules.weekly_recovery` from the Keeper surface for that family;
- retain their current resolver/subsystem implementation as internal Adapters;
- run fresh Pi-Coc RPC acceptance.

### R4 — Social and Psychology

- combine social adjudication and its bound roll into one settlement;
- preserve concealed Psychology settlement and separate realization cards;
- verify no reroll, no inner-state leak, and exact outcome ceilings.

### R5 — Ordinary check, Push, Luck, and generic resources

- replace ordinary `rules.roll` baseline with applicable check cards;
- remove low-level `rules.check` from Keeper visibility;
- make Push/Luck follow-up cards receipt-bound;
- keep generic resource mutation host-internal.

### R6 — Lookups and remaining rules families

- move skill description, catalog, build, cash, and other bounded lookups behind
  `rules.context`;
- migrate damage/SAN and other non-session decisions;
- retain combat/chase/sanity session engines;
- add accepted coverage for magic/development only when source and execution
  evidence exist.

### R7 — Full cutover and retirement

- complete family ownership ledger;
- remove duplicate Keeper-visible operations and manual choreography;
- generate or retire duplicate maps/index projections;
- update `docs/ruleset-contract.md` atomically;
- run full conformance, real Pi-Coc acceptance, and report evidence.

### 18.1 Authorized and off-limits scope

This spec alone authorizes only this Markdown file **plus the R1 slice described
in §18 R1** (the R1 contract JSON, the R1 compiler, the R1 focused conformance
tests, and the ruleset manifest contract update).

Future implementation of R2–R7 requires explicit approval for the exact shared
paths named above and any necessary updates to:

- `docs/ruleset-contract.md`;
- `plugins/coc-keeper/scripts/coc_operation_rules_core.py`;
- social/psychology/sanity/combat/chase operation adapters;
- `coc_operation_kernel.py` rule-specific extraction;
- operation registry/policy/archive generation;
- Pi typed tools and working-set projection;
- canonical ruleset Skills and tests.

Off-limits without a separate explicit expansion:

- Codex-host track files;
- campaign state schema or migration;
- ModuleGraph ontology beyond a shared internal evidence-binding seam;
- a new PDF/OCR parser;
- a new plugin/facade/turn engine;
- battle-report ownership;
- push/deploy;
- historical campaign or playtest evidence deletion.

---

## 19. Validation matrix

### 19.1 Compiler and graph contract

- exact schema and semantic-ID validation;
- evidence line/page/hash binding;
- no model-authored integrity bytes;
- node/relation/reference closure;
- condition path/operator allowlist;
- rule-family coverage aggregation;
- exception/precedence validation;
- guarded-cycle validation;
- capability and table resolution;
- secret/player projection tests;
- deterministic rebuild and conflict-aware merge.

### 19.2 RulesRuntime interface

- context returns only applicable bounded cards;
- no candidate does not mean no rule/no action;
- card schemas contain only semantic inputs;
- locked inputs cannot be supplied or changed;
- stale cards fail before resolver invocation;
- one selected card compiles to one immutable plan;
- exact replay returns the original settlement;
- drifted replay fails before RNG/mutation;
- unavailable capability fails without substitution;
- next cards reflect post-settlement canonical state.

### 19.3 Existing-engine parity

For every migrated family:

- normalized resolver request parity;
- subsystem command kind/phase/payload parity;
- deterministic seed result parity in tests;
- state before/delta/after parity;
- public/concealed roll parity;
- receipt and log parity;
- replay and crash-recovery parity;
- finalization obligation and rendering parity;
- negative/forbidden transition parity.

### 19.4 Pi integration

- generated MCP archive and Pi policy remain one deterministic projection;
- ordinary acting working set includes `rules.settle`, not `rules.check` plus
  `rules.roll`, after ordinary-check promotion;
- exact context discovery loads only the requested operation (via the generated
  working-set policy, see §8.3);
- in V1 the `rules.settle` schema is static and typed, and stays within the
  tool/schema budget (dynamic per-turn schema compilation is deferred; see
  §8.5);
- role/phase/stage/epoch invalidation works;
- source-worker/private operations remain unavailable to the main Keeper;
- current dependency, output gate, and recovery tests remain green.

### 19.5 Real Pi-Coc acceptance

Use the repository's required method:

1. fresh exact-current campaign/workspace;
2. `pi-coc --mode rpc`;
3. Grok as the sole Keeper;
4. main session or one player-safe agent as the only player;
5. one natural reply at a time;
6. the migrated rule family must arise naturally, not through a scripted tool
   sequence;
7. preserve exact transcript, calls, state, rolls, receipts, stderr, and graph
   ownership evidence;
8. verify that the Keeper used the card/settle path and did not rediscover or
   call the retired operation;
9. validate dice completeness and player-visible causal realization;
10. for whole-product/release claims, continue to a natural ending and use the
    canonical battle-report exporter.

A focused natural rule-family run proves feature integration only. It is not a
whole-product acceptance claim unless the full Plugin-Native Acceptance
Contract is satisfied.

---

## 20. Baseline evidence and known blockers

The bounded prototype evidence is recovered uncommitted in the sibling worktree
(see §18 R0); it is not committed to this repository. The R1 slice still
rebuilds the key claims as committed in-repo executable evidence over a bounded
healing-family fixture packet because the worktree is not a durable home.

The following repository baseline was re-verified on 2026-08-29:

- 143 canonical operations in the live `coc_toolbox.py` registry;
- the current odd-HP major-wound ceiling-half regression (and the recorded
  floor-half/ceiling-half checklist discrepancy) remains;
- `test_plugin_metadata.py` baseline.

> **Baseline failures FIXED on 2026-08-29:** the two previously reported
> `tests/test_ruleset_vertical.py` failures were fixed in the
> `fix-vertical-baseline` slice. Root causes were:
> (a) the generic `resource_delta` state proof was restricted to CoC7
> HP/SAN/Luck/MP keys, so a second ruleset's `energy`/`Energy` field failed
> closed as `unproven_state_delta`; the proof now uses the effect `resource_key`
> plus the receipt resource when `state_bound` is true; and
> (b) the frozen-receipt test patched a re-export (`coc_toolbox._ensure_roll_receipt_row`)
> instead of the kernel global; the patch target is now
> `coc_toolbox.coc_operation_kernel._ensure_roll_receipt_row`. **52 tests pass**
> across `test_ruleset_vertical.py` + `test_turn_finalization_state_proof.py` +
> `test_plugin_metadata.py`.

Open recorded finding (no checklist edit authorized): the floor-half/ceiling-half
major-wound threshold discrepancy remains recorded as an evidence finding — the
design does not authorize changing the checklist, and the discrepancy is not
resolved by the R1 slice.

---

## 21. External precedent

- [OMG Decision Model and Notation](https://www.omg.org/spec/DMN/1.3/PDF)
  separates a decision-requirements graph from executable decision logic and
  exposes reusable decision services. This supports RuleGraph as dependency and
  authority structure while existing resolver/subsystem code executes.
- [Open Policy Agent integration](https://www.openpolicyagent.org/docs/integration)
  separates policy evaluation from application enforcement and returns
  structured decisions through a small interface. This supports separating
  RulesRuntime decisions from state mutation.
- [W3C SHACL Core](https://www.w3.org/TR/shacl12-core/) validates graph shapes
  and constraints but is not a transactional gameplay engine. This supports
  graph validation while retaining explicit resolver/state machinery.

These sources validate the separation of responsibilities, not a storage or
dependency choice. Pi-Coc V1 remains local JSON plus current Python/TypeScript
runtime code.

### 21.1 Further notes and future candidates

On 2026-08-29 an external technology-comparison review (RDF/OWL versus
Datalog, Prolog, ASP, production rules, DMN, state machines, and property
graphs) was discussed. Its main recommendation — a custom Rule Graph IR with
backends deferred — matches this specification's existing architecture. V1
stays validated JSON with no graph database, per §16.

These notes record two future candidates and four rejected alternatives so
they are not relitigated. They are **not authorized** by any current slice
and do not change the V1 contract, compiler, runtime, or storage.

#### Future candidate A — five-kind extraction scaffold

When extraction scope widens beyond healing (R4+), the extractor (§6.2)
SHOULD classify each extracted rule into exactly one of five templates and
fill that template's structure:

- **Classification** — is-a, catalog;
- **Derivation** — if-and-then inference;
- **Decision** — input→outcome table;
- **Formula** — computation;
- **Transition** — state change on event.

This is an extraction-packet guidance and `accept()`-lint concern, **not** a
parallel type system in the graph ontology (§7.1). The rationale is a lower
model extraction error rate versus free-form node authoring. It is not
authorized by any current slice; it requires its own authorization.

#### Future candidate B — applicability trace projection and graph-generated oracle tests

Cards already carry `rule_refs` / `source_refs`. Two further projections are
recorded as future candidates:

- a compact "why applicable" condition-evaluation trace for Keeper/audit
  surfaces;
- generating per-rule oracle tests from the graph as a §19 matrix extension.

Neither is authorized by any current slice.

#### Rejected alternatives

Recorded so they are not relitigated:

- **(a) Formula ASTs inside the graph.** Rejected by §4.2: arithmetic
  authority stays in resolver code; the graph names the capability plus its
  required inputs. A formula-bearing graph is a second execution engine and
  is hollow delivery under §1.
- **(b) ASP-style default negation for exceptions.** Rejected in favor of
  explicit source-bound `overrides` / `supersedes` / `forbids` relations
  (§7.2), for auditability and the semantic-matcher constitution.
- **(c) Rete-style runtime activation.** Current prebuilt indexes plus
  per-family bounded evaluation suffice at V1 scale (§16).
- **(d) Graph database / TypeDB / RDF store backends.** Deferred per §16
  until measured need. A future storage Adapter must not change the
  RulesRuntime interface or authority semantics.

---

## 22. Acceptance verdict for this specification

This design is acceptable only if implementation preserves the following
invariant:

> The Keeper selects one semantic rule decision. RuleGraph explains and binds
> why it is applicable. RulesRuntime compiles it. The current resolver,
> subsystem, state, receipt, and finalization owners execute and prove it.

If implementation instead creates another rules engine, another state path, an
untyped universal tool, permanent dual authority, or automatic semantic
adjudication, it is `invalid-for-spec` even when focused tests pass.

---

## Revision log

Changes to the 2026-08-29 original, and why:

1. **Header — Status.** "Proposed; bounded prototype validated" → "Review-annotated; reviewed against repository reality on 2026-08-29; R1 slice authorized; R2–R7 unauthorized pending their own gates." Reason: the repository review found the prototype evidence is absent, so the original status overclaimed a validated prototype.
2. **Header — Prototype evidence line.** Replaced the claimed `plugins/coc-keeper/pi/prototypes/rule-graph/` path with an honest statement that no prototype artifacts are present; branch `codex/pi-coc-rule-graph-prototype-20260829` tip `43552e2c` is ModuleGraph starter work. Reason: recon confirmed the path does not exist on disk or in the tree.
3. **Header — Last updated.** Kept date but labeled it "revised against repository reality; see Revision log." Reason: reflects that this is an annotated revision of the original.
4. **Header — Branch-naming note.** Added that future implementation branches use the `pi-coc/` prefix. Reason: shared context directive 7; the prototype branch used `codex/` which is the wrong prefix.
5. **§1 — Hollow delivery list.** Added "claiming prototype or acceptance evidence that is not present in the repository." Reason: shared context directive 2 — the R0 claims are absent artifacts.
6. **§2 — Counts.** Kept 143 / 19 / 32 / 46 and added the 89-rule rule-index figure, cited the 2026-08-29 verification, and noted the 141→143 reconciliation. Reason: recon-coc7-rules verified the live registry reports 143, not the remembered 141 (directive 3).
7. **§6.3 / §20.** Ceiling-half/floor-half discrepancy now recorded as an explicit open recorded finding with no checklist edit authorized (was implied). Reason: shared context directives 2 and 8.
8. **§8.3 — `rules.context` exact-discovery.** Rewrote to require enforcement by generated policy / working-set projection (absent from ordinary working sets, loadable only by exact name), not advisory prose, mirroring the existing exact-operation loader. Added a named R2 prerequisite gap. Reason: directive 5 — recon confirms the general exact-operation loader machinery exists but the `rules.context`-specific generated policy is not yet built.
9. **§8.5 — Turn-scoped settlement schema.** Recharacterized the dynamic per-turn compiled schema as deferred; the static typed `rules.settle` schema + execute-time ACL/state recheck is the sole V1 authority. Reason: shared context directive 3 / task directive 4.
10. **§11 — `rules.roll_dice`.** Changed its final Keeper surface to "host-internal; never a `rules.settle` decision" and target to "retained host-internal adapter (setup/randomization only)." Reason: task directive 6.
11. **§11.3 — Psychology secrecy.** Added two distinct `decision_ref`s AND two distinct `decision_id`s; the realization `decision_id` fingerprint binds the frozen observe-settlement identity (host re-attaches; model never echoes hashes); realization performs no RNG and no re-execution. Reason: task directive 6.
12. **§12 — Pi working-set integration.** Added a "V1 note" that the `rules.settle` schema is static in V1; dynamic per-turn compilation is deferred. Reason: task directive 4.
13. **§18 R0.** Recharacterized as "design evidence only; prototype artifacts are not present in the repository"; the key claims (healing command parity, ceiling-half discrepancy) are rebuilt as executable R1 conformance evidence. Reason: task directive 2.
14. **§18 R1.** Scoped minimal to contract JSON, compiler, focused bounded-healing conformance tests, and ruleset manifest contract update; explicitly NO runtime operation changes and NO full-rulebook extraction; marked authorized. Reason: task directive 7 and shared context directive 2.
15. **§18.1.** Updated to authorize only this Markdown plus the R1 slice (not all future paths). Reason: task directive 7 / shared context directive 2.
16. **§19.4 — Pi integration.** Removed the dynamic-schema expectation and replaced it with the static typed `rules.settle` schema note; referenced the generated working-set policy for exact discovery. Reason: task directive 4 / 5.
17. **§20 — Baseline evidence.** Recorded that the two `test_ruleset_vertical.py` failures were FIXED on 2026-08-29 with root causes, and that 52 tests pass; kept the ceiling-half/floor-half checklist discrepancy as an open recorded finding. Reason: task directive 8.
18. **In-scope/out-of-scope and authority text** left materially unchanged where the original remained true. Reason: preserve all content that remains correct.
19. **Follow-up patch (2026-08-29):** header Prototype evidence, §18 R0, and §20 opening recharacterized from “artifacts absent” to “artifacts recovered uncommitted in sibling worktree `chatrpgv4-wt-rule-graph-prototype-20260829` at `plugins/coc-keeper/pi/prototypes/rule-graph/`, based on `0.7.1a@43552e2c`; external evidence, not committed.” `VERDICT.md` claims (30/38/7; 6+42+2 green at prototype time; J1 floor-vs-ceiling drift) recorded as independently readable. Prototype is not imported (throwaway by its own README); R1 still rebuilds key claims as committed in-repo evidence; final worktree disposition is the user's call at closeout. §20 baseline-failure FIX note unchanged. Reason: Boss-verified recovery of uncommitted prototype artifacts after the first revision.
20. **Follow-up patch — §13 receipt-store wording.** Clarified that the RuleGraph build-evidence root (§6.4) is compile-time acceptance evidence owned by the compiler, not a settlement receipt store; RuleGraph still introduces no new runtime receipt store, and canonical roll/source/state receipts remain the only settlement evidence. Reason: final review found a wording collision between §13 “no new receipt store” and the persisted compile-time acceptance store.
21. **Follow-up patch — §21.1 further notes and future candidates.** Recorded the 2026-08-29 external technology-comparison review: verdict matches this spec’s custom Rule Graph IR with backends deferred (V1 validated JSON, no graph database, §16); future candidate A (five-kind extraction scaffold at R4+ as extraction-packet/`accept()`-lint guidance, not a parallel ontology); future candidate B (applicability-trace projection and graph-generated oracle tests as a §19 matrix extension); rejected alternatives (formula ASTs, ASP default negation, Rete activation, graph-database backends). A and B are not authorized by any current slice. Reason: user-approved addition after the technology-comparison review.

Reconstruction judgment calls: (a) the exact original prose for the R1/R0 sub-headings and the §8.3 exact-discovery addendum was not preserved verbatim in the brief, so I re-wrote them as clean specification prose preserving the MUST/MUST NOT/SHOULD/MAY semantics; (b) the §8.5 deferred design paragraph was kept intact (verbatim from the original) and only its framing/status paragraph was changed, so the binding semantics the original described are preserved as the deferred design; (c) I anchored §8.3's exact-discovery requirement to the existing `coc_discover`/`setActiveTools`/`pi-coc-tool-affordance-and-bounded-recovery.md` pattern because that is the actual exact-operation enforcement machinery recon located.
