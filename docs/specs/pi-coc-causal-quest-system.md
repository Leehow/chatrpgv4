# Pi-Coc 因果任务系统

> **Status:** Approved — design agreed through Grill Me; the user has authorized implementation.
> The seam decisions in §5A (Registry and tool-surface contract) and §6A (Relationship to
> temporal memory) are frozen.
> **Track:** `ACTIVE_IMPLEMENTATION_TRACK=pi-coc`; Codex-host implementation is off-limits.
> **Scope of this document:** product and contract specification only. Future implementation
> touches shared `plugins/coc-keeper/` kernel surfaces and requires separate explicit
> authorization before any shared contract, state, registry, skill, test, or runtime file is
> edited.
> **Working name:** Causal Quest System / 因果任务系统.

## 1. User job

The user is trying to let a live Keeper run an authored PDF scenario without turning the
scenario into a rigid quest pipeline. Success looks like this:

- authored tasks, clues, events, world facts, prerequisites, partial achievements, effects,
  threats, and improvised canon form one queryable causal graph;
- the graph explains what is possible now and why, but never chooses the player's route or
  replaces Keeper judgment;
- a player may follow the authored A -> B -> C route, skip B through a causally valid method,
  fail B and re-plan, or create a new route through play;
- hard prerequisites limit an impossible result without forbidding the attempt; soft
  prerequisites can be bypassed with another method, risk, cost, reduced outcome, or higher
  difficulty;
- an exceptional result never purchases impossibility, but always creates a substantive,
  source-bound change in play;
- actual effects land in canonical campaign state before player output, survive in Git history,
  and remain available to later Keeper reasoning and the battle report;
- player-visible output contains only investigator-known goals and consequences, never the
  hidden graph, undiscovered routes, source gaps, or Keeper-only truth.

Hollow delivery would be any of the following:

- a `next_task` chain, mandatory A/B/C state machine, or automatic route planner;
- a graph visualizer or schema that is not consumed by normal Pi-Coc Keeper play;
- module-level tests without a real Pi-Coc RPC play path;
- a second history store, second Keeper, second rules/state shell, or host-specific plugin fork;
- keyword matching that pretends to understand player intent, task completion, or effect fit;
- a critical roll that is discarded because the Keeper discovered a causal ceiling late;
- a task status that grants rewards which were never applied through canonical state tools.

## 2. Existing system and confirmed gap

Quest v1 is an action-shaped objective contract. It deliberately excludes cognitive goals,
which belong to the clue graph. Its runtime state machine is:

```text
authored -> offered -> active -> completed | failed | abandoned
```

Its completion vocabulary can observe discovered clues, flags, clocks, and explicit Keeper
narrative closure. Its projection is advisory and does not block actions, scenes, or endings.
It does not currently express:

- named partial outcomes;
- fact prerequisites or produced effects;
- hard versus soft causal requirements;
- method- and outcome-scoped gates;
- alternate affordances;
- task-to-clue, task-to-event, or task-to-world causal links;
- ready, near-ready, blocked, stranded, impossible, bypassed, or obsolete projections;
- per-investigator knowledge scope;
- source gaps distinct from unmet prerequisites.

The campaign sidecar Git repository is already the sole campaign history store. The new system
must therefore derive current causality from authored declarations plus canonical campaign
state and Git-backed events. It must not make a mutable graph file authoritative.

Two current concepts are precedents to deepen rather than duplicate:

- social adjudication already separates feasibility from difficulty and carries an outcome
  ceiling;
- `state.exceptional_effect` already requires an exceptional roll to bind a substantive effect
  to its exact authoritative source roll.

## 3. Product laws

### 3.1 The Keeper remains the product

The Keeper understands player intent, chooses a method, judges causality, frames consequences,
selects effects, controls secrets, and writes final fiction. The causal system supplies facts,
constraints, affordances, risks, and evidence. It never allows, denies, forces, suppresses,
reorders, or automatically narrates a player action.

There is no mandatory per-turn task-tool pipeline. The Keeper may query the local causal
context when needed and may handle an obvious action directly.

### 3.2 Facts connect objectives

Direct task dependencies are forbidden:

```text
invalid: quest-C requires quest-B completed
valid:   quest-C outcome requires fact:access-basement
         quest-B may establish fact:access-basement
```

This is the central non-linearity invariant. If another method establishes the same fact, the
downstream outcome becomes possible without completing the authored intermediate quest.

### 3.3 Gates constrain outcomes, not agency

A hard gate means the desired outcome cannot be produced by the current method in current
canon. It does not mean the player is forbidden to try something. A soft gate means the default
or advantageous route is missing, while a causally valid bypass may still exist.

Difficulty is not gate hardness. A hard causal impossibility cannot be converted into an
Extreme difficulty roll. A soft gate may affect difficulty, cost, time, risk, quality, or the
outcome ceiling, as judged by the Keeper.

### 3.4 Source is read-only; played events are canon

Authored module truth remains read-only. Campaign events may change its current applicability:
a source-authored locked wall can later be demolished, creating a new route without rewriting
the source.

Keeper improvisation may establish campaign-local tasks, identities, motives, routes, facts,
effects, and contradictions. Conflicting assertions retain both claims and provenance and create
structured continuity contradiction / narrative debt in the temporal-memory contradiction
construct — the single home for contradiction and narrative debt (§6A); they are never silently
overwritten.

### 3.5 Missing does not mean false

The absence of a fact is unknown by default. Important negative claims require explicit
evidence. `none` requirements may use absence only for a contractually closed domain. Progressive
PDF source gaps, unqueried secrets, NPC state, and world facts are open domains and cannot be
negated by omission.

### 3.6 Semantic identifiers only

Every identifier the model must read, choose, copy, or emit is semantic. Runtime code owns Git
SHAs, hashes, digests, and exact integrity bindings. The model never relays an opaque identifier
between operations.

## 4. Domain model

| Term | Meaning | Authority |
| --- | --- | --- |
| Quest | An action-shaped objective that may be offered, accepted, and formally closed. | Authored source or campaign-improvised Quest definition plus Quest lifecycle state. |
| Outcome | A named, causally meaningful achievement within a Quest. | Quest definition; achievement derived from canonical facts or explicit Keeper closure. |
| Event | Something that actually happened in campaign time. | Canonical campaign event/state write, committed by turn finalization. |
| Fact | A typed assertion relevant to future causality. | Its owning domain state or the generic campaign assertion ledger. |
| Requirement | A condition for one named outcome under a stated outcome/method scope. | Authored declaration plus live Keeper applicability judgment. |
| Gate | The consequence of a missing requirement for one method/outcome: hard or soft. | Stable source constraint or campaign-canon assertion; applied semantically by the Keeper. |
| Affordance | A source-supported action or route the world can plausibly support. | Source entity, current world state, or campaign improvisation. |
| Effect | A concrete state change produced by a settled action or outcome. | Existing canonical domain operation or generic fact establish/end operation. |
| Effect affordance | A bounded domain in which the Keeper may choose an effect. | Source/Quest declaration; advisory, never an automatic reward. |
| Source gap | Required source truth is not yet parsed or verified. | Progressive module/source state. It is neither a hard nor soft gate. |
| Causal projection | A disposable, revision-bound view over definitions, facts, events, and current intent. | Derived only; never authoritative. |

Tasks, events, facts, and effects are not aliases:

```text
player action
  -> settled event
  -> canonical effect(s)
  -> active fact set changes
  -> causal projection changes
  -> zero or more Quest outcomes become achievable or endangered
```

## 5. Deep module and seam

### 5.1 Causal Projection module

The design introduces one deep **Causal Projection module**. Its external **interface** answers
one question:

> Given the current authoritative campaign revision, actor knowledge, scene, player intent,
> proposed method, and desired outcome, what facts, requirements, ceilings, affordances, risks,
> source gaps, and active objectives are relevant now?

The interface has two query faces, not two authorities — the module's tools `causal.context`
and `causal.map` (§5A):

1. `context` (`causal.context`) — bounded local causal neighborhood for a live Keeper decision;
2. `map` (`causal.map`) — full Keeper-only diagnostic projection on explicit request.

The module performs no writes and makes no semantic allow/deny decision. It hides:

- aggregation across Quest, clue, item, NPC, relationship, threat, time, location, and generic
  assertion domains;
- active/ended fact resolution;
- per-investigator knowledge filtering;
- finite requirement evaluation;
- source-gap propagation;
- hard/soft missing requirement classification;
- bypass and stranded-cluster discovery;
- Quest outcome and lifecycle projection;
- cache revision verification and rebuild.

This earns depth: without the module, every Keeper caller would need to understand every domain
state layout, source contract, visibility rule, and cache revision. Tests cross the same query
interface as live Keeper callers.

### 5.2 Adapters and ownership

Adapters normalize existing authoritative domains into the projection fact view. They do not
create new authority. Initial adapters are expected for:

- Quest outcomes and lifecycle;
- clue discoveries and conclusions;
- investigator/party knowledge;
- possessions and resources;
- NPC relationships and life state;
- locations, access, and scene state;
- Threat Clocks and game time;
- active conditions and exceptional effects;
- generic campaign assertions;
- progressive source/entity readiness.

Each fact has exactly one authoritative owner. If a fact fits an existing domain, the generic
ledger must not duplicate it.

### 5.3 Write seam

There is no generic arbitrary graph mutation interface. Effects write through:

- existing canonical rules/state operations for owned domains;
- a minimal state operation to establish a generic fact;
- a minimal state operation to end, supersede, or consume a generic fact;
- existing Quest lifecycle operations for offer, activate, settle, and improvise.

Arbitrary JSON Patch, direct save editing, `task.advance`, `task.unlock`, and automatic route
planning are forbidden.

All state writes take `decision_id` and are idempotent under the `state.*` law. An explicit
Keeper campaign decision compiles to a hard gate by establishing a constraint-kind fact through
`state.fact_establish` with provenance kind `keeper-decision`; this is how §7's "explicit
Keeper campaign decision" becomes a hard gate.

## 5A. Registry and tool-surface contract

The causal surface registers through the one existing toolbox registry; it introduces no second
registry, envelope, or Keeper runtime. Tool names are binding:

- `causal.context` — bounded local causal neighborhood for a live Keeper decision;
- `causal.map` — full keeper-only diagnostic projection, explicit request only;
- `state.fact_establish` — establish a causal fact in the temporal-memory assertion store;
- `state.fact_end` — end, supersede, or consume a causal fact (`mode: end | supersede |
  consume`).

All state writes take `decision_id` and are idempotent under the `state.*` law. Advisory output
rides the existing toolbox `warnings`/`hints` envelope. Causal tools never allow, deny, block,
force, or reorder anything, and their failure or absence never blocks play.

Model-facing surfaces carry semantic identifiers only; runtime code owns Git SHAs, hashes, and
revision digests end-to-end (§3.6).

Quest v1 → v2 retirement plan: Quest v2 replaces Quest v1 in place — schema, compiler
validation, and registry tools. There is no migration, no dual reader, and no old-ID remapping;
exact-current-schema campaigns only. Tool names stay stable where semantics survive, and every
rename is documented. The Quest v1 completion vocabulary (`clue_discovered`, `flag_set`,
`clock_reaches`, `always`) retires into outcome-based completion plus Keeper narrative closure.

New modules and tools register ownership in `docs/specs/pi-coc-module-ownership.json` at
implementation time. Quest operations are currently owned by `continuity-memory`; a causal
owner must be assigned before the causal tools land.

## 6. Authority and persistence

### 6.1 Authoritative inputs

The causal projection consumes:

1. read-only authored source declarations from distributed owning entities;
2. current canonical domain state;
3. canonical campaign assertion events and their active projection;
4. Git-backed finalized event history;
5. current scene, actor knowledge scope, and live Keeper intent/method/outcome input.

There is no authoritative `task-graph.json`.

### 6.2 Generic assertion ledger

Facts without an existing natural owner use the temporal-memory assertion store
(`memory/temporal/assertions.jsonl` under the campaign directory): the "minimal generic
assertion contract" is the temporal-memory assertion contract extended with causal fact kinds —
there is no separate causal ledger. Writes have event semantics; a current active-facts document
may exist as a rebuildable/verified projection for efficient reads.

Illustrative assertion, shown in the temporal assertion envelope:

```json
{
  "schema_version": 1,
  "fact_id": "access:corbitt-house:maintenance-tunnel",
  "fact_kind": "access",
  "subject_ref": {"kind": "party", "ref_id": "party"},
  "target_ref": {
    "kind": "location",
    "ref_id": "location-corbitt-maintenance-tunnel"
  },
  "polarity": "present",
  "visibility": {
    "kind": "party-known"
  },
  "lifecycle": {
    "kind": "persistent"
  },
  "provenance": {
    "kind": "campaign-event",
    "event_id": "event:opened-maintenance-tunnel"
  },
  "reason": "调查员从锅炉房移开砖墙后打开了通道。"
}
```

Initial normalized fact kinds may include `knowledge`, `possession`, `access`,
`relationship`, `life-state`, `world-state`, `condition`, `opportunity`, `deadline`,
`threat`, `belief`, and `contradiction`. The exact vocabulary has one registry source; no
caller invents free-text type names.

### 6.3 Fact lifecycle

Supported lifecycle forms are:

- `persistent`;
- `scene`;
- `until-event`;
- `until-time`;
- `one-shot`;
- `consumed-by`.

Facts are never historically deleted. A later event may end, supersede, contradict, or consume
them. The active projection selects currently applicable assertions while history retains the
full chain and provenance.

### 6.4 Knowledge and visibility

Visibility distinguishes at least:

- `keeper-only`;
- `public`;
- `party-known`;
- `investigator-known` with explicit investigator references;
- `npc-belief`, which is an actor belief and not necessarily objective truth.

One investigator's knowledge does not become party knowledge until fiction establishes a
transfer. A player's lucky guess does not establish investigator knowledge.

### 6.5 Git and cache binding

Every projection result is machine-bound to the current canonical state revision and sidecar
Git HEAD/finalization. The model receives a semantic revision alias when needed; the runtime
attaches and verifies hashes internally.

Cache entries are keyed by `(canonical state revision, actor knowledge scope, scene ref, query
face, machine-owned intent/method/outcome binding)`. The `context` face returns under a bounded
result budget; the `map` face is keeper-only and served only on explicit request.

A cached projection with a mismatched revision is discarded and rebuilt. Cache deletion must
not remove campaign truth. Cache failure returns a warning and falls back to direct bounded
source/state reads; it never returns an authoritative empty graph or interprets missing cache
rows as false world facts.

## 6A. Relationship to temporal memory (authority adjudication)

The causal system's facts reuse the existing temporal-memory assertion store
(`memory/temporal/assertions.jsonl` under the campaign directory) and its frozen contract:

- `docs/specs/temporal-memory-contract.md` already freezes the assertion schema, assertion
  kinds, supersession, contradictory state, provenance, privacy, and rebuildable projections;
- `docs/specs/git-temporal-memory-worldlines.md` already defines Git as authority, the
  episode/assertion graph, worldlines, narrative debt, and battle-report evidence.

Therefore the causal system adds no parallel generic ledger, no second narrative-debt or
contradiction construct, and no second projection store. Causal work is exactly:

1. causal fact kinds registered in the one existing assertion-kind vocabulary;
2. minimal establish/end/supersede/consume write operations on that store;
3. the derived read-only causal projection over it plus domain state.

If implementation finds the temporal store cannot carry a required causal property, that is a
stop-and-report — never a license to fork a store.

## 7. Distributed source declarations

The graph is assembled from local declarations owned by existing domains:

- Quest defines action objectives, named outcomes, their requirements, and effect affordances;
- clue conclusions establish knowledge facts;
- NPC agendas and relationships provide cooperation/refusal constraints and social
  affordances;
- locations and scenes provide stable access constraints and physical affordances;
- items provide possession/use affordances;
- Threat Clocks and game time provide deadline facts and consequences;
- campaign events establish what actually happened;
- generic assertions cover only facts with no natural domain owner.

No monolithic source graph duplicates these declarations.

Only an explicit source/world invariant, authoritative rule constraint, or explicit Keeper
campaign decision may compile as a hard gate. OCR uncertainty, model inference, recommended
scenario order, or evidence gaps may produce a soft candidate, hint, or `source_gap`, never a
hard gate.

## 8. Quest v2 contract

Quest v2 remains action-shaped. Cognitive conclusions remain owned by the clue graph, but their
facts may satisfy Quest outcome requirements. Quest v1 is not migrated or dual-read; exact-current
schema campaigns only. Quest v2 replaces Quest v1 in place — schema, compiler validation, and
registry tools — under the retirement plan in §5A (Registry and tool-surface contract).

Quest lifecycle remains small:

```text
authored -> offered -> active -> completed | failed | abandoned
```

It answers whether a goal is hidden, offered, accepted, or formally closed. Partial progress,
blocked routes, bypass, readiness, risk, obsolescence, and impossibility are derived projections,
not persisted lifecycle states.

Illustrative Quest v2 shape:

```json
{
  "schema_version": 2,
  "quest_id": "quest-investigate-corbitt-house",
  "title": "Corbitt 宅调查委托",
  "localized_title": {"zh-Hans": "科比特宅邸调查委托"},
  "player_safe_summary": "调查宅邸异常并向诺特先生交付报告。",
  "quest_kinds": ["commission"],
  "importance": "core",
  "giver": {"kind": "npc", "ref_id": "npc-mr-knott"},
  "brief": "keeper-only authored substance",
  "outcomes": [
    {
      "outcome_id": "outcome:corbitt-house:gain-basement-access",
      "keeper_label": "获得地下室通行能力",
      "role": "supporting",
      "requirements": {
        "all": [
          {
            "requirement_id": "requirement:corbitt-house:locate-basement",
            "fact_ref": "knowledge:corbitt-house:basement-location",
            "gate": "hard",
            "applies_to": {
              "outcome": "arrive:corbitt-house-basement",
              "method_domain": "direct-navigation"
            },
            "outcome_ceiling_when_missing": "discover-route",
            "bypass_affordances": [
              "affordance:corbitt-house:follow-occupant",
              "affordance:corbitt-house:search-hidden-access"
            ],
            "reason": "不知道地下室位置时，不能用直接导航抵达。",
            "source_refs": [{"pdf_index": 42}]
          }
        ],
        "any": [
          {
            "requirement_id": "requirement:corbitt-house:key-access",
            "fact_ref": "possession:party:basement-key",
            "gate": "soft",
            "applies_to": {
              "outcome": "enter:corbitt-house-basement",
              "method_domain": "main-door"
            },
            "bypass_affordances": [
              "affordance:corbitt-house:pick-main-door-lock",
              "affordance:corbitt-house:maintenance-tunnel"
            ],
            "reason": "钥匙是正门的默认安静进入方式，不是地下室的唯一入口。",
            "source_refs": [{"pdf_index": 43}]
          }
        ],
        "none": []
      },
      "effect_affordances": {
        "success": ["access", "knowledge"],
        "exceptional": ["time", "stealth", "new-opportunity"],
        "failure": ["threat", "deadline", "resource-cost"]
      }
    },
    {
      "outcome_id": "outcome:corbitt-house:deliver-report",
      "keeper_label": "向诺特交付调查报告",
      "role": "core",
      "requirements": {
        "all": [
          {
            "requirement_id": "requirement:corbitt-house:credible-findings",
            "fact_ref": "knowledge:corbitt-house:credible-findings",
            "gate": "soft",
            "applies_to": {
              "outcome": "outcome:corbitt-house:deliver-report",
              "method_domain": "formal-report"
            },
            "outcome_ceiling_when_missing":
              "outcome:corbitt-house:deliver-disputed-report",
            "bypass_affordances": [
              "affordance:corbitt-house:witness-testimony",
              "affordance:corbitt-house:physical-evidence"
            ],
            "reason": "可信调查材料是让诺特接受报告的默认依据，但证词或实物也可能支撑结论。",
            "source_refs": [{"pdf_index": 44}]
          }
        ],
        "any": [],
        "none": []
      },
      "effect_affordances": {
        "success": ["relationship", "resource"],
        "exceptional": ["relationship", "new-opportunity"],
        "failure": ["relationship", "threat"]
      }
    }
  ],
  "completion": {
    "required_outcomes": ["outcome:corbitt-house:deliver-report"],
    "narrative": "KP确认调查员已经以世界内有效方式了结委托。"
  },
  "failure": {
    "narrative": "目标已在当前正典中不可实现，且KP正式关闭委托。"
  },
  "secret": false,
  "provenance": "source"
}
```

This example fixes semantic intent, not final field spelling. Implementation must freeze the
exact schema once, validate it through the existing source compiler/module-assets authority,
and avoid adding duplicate free-text condition vocabularies.

## 9. Requirement semantics

Requirements use finite `all`, `any`, and `none` groups. Arbitrary nesting, embedded scripts,
JSONPath, regular expressions, and free-text evaluators are forbidden.

Each evaluated requirement is three-valued:

- `satisfied` — authoritative active facts support it for the current actor and scope;
- `unsatisfied` — the relevant domain is known and the required fact is absent or contradicted;
- `unknown` — source, visibility, or authoritative state is insufficient.

`unknown` propagates to `source_gap` or an explicit knowledge/state gap. It never becomes a hard
failure by default.

Requirements are scoped to a named outcome and, where relevant, a method domain. They do not
mean that every possible method requires the same fact.

Outcome achievement granularity: outcomes are party-scoped by default. A requirement whose
fact visibility is investigator-known evaluates per investigator. Knowledge becomes party
knowledge only through fiction-established transfer.

## 10. Runtime causal assessment

For a current actor, intent, method, and desired outcome, the local projection reports one of:

| Assessment | Meaning |
| --- | --- |
| `direct` | Current facts support the method and desired outcome. |
| `soft-bypass` | A default/advantage requirement is missing, but a causally valid bypass exists. |
| `hard-ceiling` | The desired outcome is impossible through this method; a lower reachable outcome may exist. |
| `source-gap` | Required source truth is not yet parsed or verified. |

It also reports:

- satisfied and missing requirements;
- the outcome/method scope of each gate;
- reachable outcome ceiling;
- relevant bypass affordances;
- active costs, effects, threats, and deadlines;
- actor knowledge limitations;
- active Quest outcomes affected;
- brief source-backed reasons and evidence references;
- warnings, including stale projection or contradiction debt.

Illustrative local response:

```json
{
  "assessment": "hard-ceiling",
  "desired_outcome": "arrive:ritual-chamber",
  "method_domain": "direct-navigation",
  "outcome_ceiling": "discover-route",
  "missing_hard": [
    {
      "fact_ref": "knowledge:ritual-chamber:location",
      "reason": "调查员尚不知道密室位置。"
    }
  ],
  "bypass_affordances": [
    "affordance:ritual-chamber:follow-cultist",
    "affordance:ritual-chamber:search-hidden-access"
  ],
  "exceptional_effect_domains": ["knowledge", "new-opportunity", "deadline"]
}
```

This is reasoned evidence for the Keeper, not an engine verdict that rejects the action.

## 11. Hard and soft gate play semantics

### 11.1 Soft gate

The Keeper may permit a bypass by changing method, difficulty, time, risk, resource cost,
quality, visibility, or outcome ceiling. A successful bypass may establish the same downstream
fact that an authored intermediate Quest would have produced.

An exceptional result may fully bypass the soft gate and add a source-bound benefit such as
speed, discretion, durability, quality, preserved resources, or a new opportunity.

### 11.2 Hard gate

A hard gate caps the desired result for the current method. It does not erase the attempt. The
Keeper identifies the strongest causally reachable nearby outcome before rolling when possible.

An exceptional result cannot grant the blocked result, reveal an unearned secret, enact a lucky
guess as investigator knowledge, revive a dead NPC, or silently complete later actions. It must
instead produce a substantive effect within the reachable envelope, such as:

- discovering the exact blocker;
- finding or creating an alternate route;
- gaining partial access;
- reducing a deadline or threat;
- preserving stealth or a resource;
- changing a relationship;
- creating a bounded opportunity that can satisfy a later prerequisite.

### 11.3 Late ceiling correction

If the Keeper rolls before noticing a hard gate:

1. keep the authoritative roll receipt;
2. do not tell the player the roll was void;
3. realize the strongest legal nearby outcome;
4. bind any required exceptional effect to the exact roll before finalization;
5. write an audit-side semantic `outcome-ceiling-correction` reason;
6. do not expose the audit label or hidden source truth in player prose.

The `outcome-ceiling-correction` reason is recorded on the turn's existing event/finalization
receipt — audit side only, never player prose. Any bound exceptional effect reuses the existing
`state.exceptional_effect` receipt.

## 12. Compound actions

A compound player declaration is an ordered plan, not permission to auto-resolve every atom.
The Keeper settles atoms in causal order and stops at the first new fictional or mechanical
block. Completed earlier atoms remain canon; later atoms remain unplayed intent.

A higher success tier improves the settled atom within its authorized goal. It does not silently
enlarge the goal to cover the rest of the declaration.

## 13. Quest progress and route changes

Quest progress is a set of named achieved outcomes, not a scalar percentage. The projection may
classify a Quest or outcome as:

- `ready`;
- `near-ready`;
- `blocked` — current method is blocked but another known method or satisfiable prerequisite
  exists;
- `stranded` — no currently known executable route exists, but future events or improvisation
  may change that;
- `impossible` — current canon makes the original goal unattainable;
- `bypassed` — a route was not used, without implying its independent objective was solved;
- `obsolete` — the objective no longer has current value.

These are Keeper-only derived labels. Only the persisted Quest lifecycle is authoritative.

Completing downstream outcome C does not automatically complete or abandon intermediate Quest
B. The projection re-evaluates B's own objective:

- if B only existed as a route, it may become obsolete and later be formally abandoned;
- if B has independent value, it remains available;
- if another method actually achieved B's goal, the Keeper may complete it;
- if skipping B created risk, it may become a threat or remediation objective.

Failure changes world facts and therefore the graph. It may close a route, raise cost, advance a
clock, change a relationship, create danger, or open a different objective. The system surfaces
source-supported alternatives but does not invent a guaranteed fail-forward route.

A mutually waiting group with no active external entry is a `stranded cluster`. It is reported
to the Keeper; the engine neither loops nor auto-satisfies a requirement.

## 14. Quest offer, closure, and effects

Readiness never auto-offers a Quest. A Quest becomes player-visible only when fiction gives the
investigator the goal, the player forms a durable commitment, or the world applies an explicit
pressure the investigator perceives.

Player-created goals become `campaign-improvised` Quests only when they are durable across
scenes and materially affect future causality. Ordinary actions do not create Quests.

Exact structured conditions may support machine settlement. Narrative meaning, completion
quality, alternative methods, and ambiguous simultaneous outcomes remain Keeper decisions. If
completion and failure conditions become true in the same settled event, the machine reports
both unless the source explicitly defines precedence; it does not silently choose completion or
failure. The Keeper may close the Quest while preserving severe failure effects.

Quest closure never grants an automatic reward bundle. Its receipt lists only effects already
applied through canonical state operations. Source `effect_affordances` constrain possible
effect domains but are not pre-issued rewards.

If no meaningful uncertainty or failure consequence exists, the Keeper applies the obvious
effect without rolling. Dice are not task-state buttons.

## 15. Turn settlement and evidence

For a played turn:

1. the Keeper interprets intent, method, and desired outcome;
2. the Keeper queries local causality when useful and determines any outcome ceiling before
   rolling where possible;
3. authoritative rules settle uncertainty;
4. the Keeper selects causally valid effects within the source and outcome envelope;
5. rules/state tools apply every numeric change, fact establish/end, relationship change,
   threat/deadline change, item/resource change, and exceptional effect (exceptional effects
   reuse the existing `state.exceptional_effect` receipt rather than a new binding);
6. Quest closure, when appropriate, records only already-applied effects;
7. existing turn finalization proves all settled checks and visible changes before releasing
   player prose;
8. existing Commit Coordinator synchronously commits the canonical turn state and evidence.

There is no separate task transaction, graph commit, or async progress backfill.

## 16. Progressive PDF and source compilation

The external PDF skill remains the only PDF parser. Repository code validates/reformats its
bundle and compiles source declarations; it never opens the PDF to parse text, layout, images,
metadata, or page count.

Opening readiness requires only the minimum playable source range. Quest outcomes, local
requirements, and affordances deepen incrementally as relevant entities are parsed. Unresolved
source dependencies remain explicit `source_gap` rows and may trigger the existing progressive
deepen path.

The compiler does not enumerate every player route. It extracts stable world constraints,
authored objectives, named outcomes, effect affordance domains, and source evidence. Live Keeper
semantics combine those declarations with current campaign facts.

## 17. Player-safe projection

The Keeper may see the full causal map. The player sees only:

- offered/accepted goals;
- investigator-known commitments and deadlines;
- discovered partial achievements;
- visible consequences and route changes;
- world-language journal updates in `play_language`.

The player never sees:

- hidden or unoffered Quests;
- hard/soft labels as system jargon;
- undiscovered prerequisites or routes;
- source gaps or parse status;
- NPC secret agendas;
- Keeper-only reasons and evidence;
- `ready`, `stranded`, `bypassed`, or `obsolete` graph labels.

Player language says, for example, “地下室正门已经无法使用，但锅炉房后方可能另有通道,”
not “任务B失败，已解锁节点D.”

## 18. Failure semantics

| Failure | Required behavior |
| --- | --- |
| Projection cache stale | Discard and rebuild against the current machine-bound revision. |
| Projection cache unavailable | Warn; use bounded direct source/state reads; never return authoritative empty facts. |
| Source not parsed | Return `source-gap`; do not classify as missing world fact. |
| Fact owner unavailable/corrupt | Report not proven; do not infer false or mutate another domain. |
| Contradictory assertions | Preserve both provenance chains in the temporal-memory contradiction construct and surface narrative debt to the Keeper. |
| Hard gate discovered after roll | Preserve roll and realize the strongest legal outcome with bound exceptional effect when required. |
| No route currently known | Report `stranded`; do not auto-fail or fabricate a route. |
| Objective impossible in canon | Report `impossible`; Keeper explicitly closes or reframes it. |
| Completion and failure both true | Report both unless source precedence is explicit; Keeper settles semantics. |
| Causal projection operation fails | Never block play solely because advisory causality is unavailable; preserve dice/state/secrecy/finalization hard rules. |

## 19. Implementation slices

Implementation is not authorized by this document. Once separately approved, use vertical
slices rather than a broad rewrite.

### Slice 1 — minimum causal loop

- freeze Quest v2 named outcomes and requirement schema;
- extend the temporal-memory assertion store with causal fact kinds plus the minimal
  establish/end operations;
- normalize a bounded initial set of existing domain facts;
- implement local/full read-only causal projection;
- bind projection cache to canonical state/Git revision;
- carry hard/soft/source-gap and outcome ceiling to Keeper guidance;
- apply one real effect through canonical state and preserve it through finalization/Git;
- prove one thin The Haunting A/B/C route and a valid B bypass.

### Slice 2 — source and improvisation

- progressively compile Quest outcomes, requirements, affordances, and evidence from the
  external PDF bundle;
- support campaign-improvised Quests, facts, routes, and effect affordances;
- preserve contradictions and narrative debt;
- prove source gaps are not treated as false facts.

### Slice 3 — re-planning and knowledge

- project blocked/stranded/impossible/bypassed/obsolete states;
- detect stranded clusters;
- enforce per-investigator/party knowledge views;
- handle failure effects, route loss, simultaneous completion/failure, compound declarations,
  and late ceiling correction.

### Slice 4 — product acceptance

- exact-current-schema fresh workspace;
- raw PDF external extraction and minimum opening parse;
- Pi-Coc RPC with Grok as Keeper and one context-isolated player;
- natural play through the acceptance cases below;
- final battle report from preserved real campaign evidence.

Each slice must be integrated through the normal Keeper interface. A source pack, schema, test
harness, or projection not consumed by normal play is `unintegrated`.

## 20. Deterministic validation

Automated tests are authoritative for:

- Quest v2 schema and cross-file references;
- semantic identifiers and secret isolation;
- fact establish/end/supersede/consume idempotency;
- finite `all`/`any`/`none` evaluation and three-valued unknown propagation;
- fact-owner uniqueness;
- per-investigator and player-safe projections;
- hard/soft/source-gap structured output;
- named outcome and Quest lifecycle separation;
- blocked/stranded/impossible/bypassed/obsolete projections;
- stranded-cluster detection without recursive loops;
- simultaneous completion/failure reporting;
- projection rebuild and machine-owned Git revision binding;
- stale/unavailable cache behavior;
- no hidden task, prerequisite, source-gap, or Keeper reason in player output;
- no automatic reward from Quest closure;
- exact exceptional-effect source-roll binding;
- finalization and Git evidence preservation;
- compiler-side `source_gap` row generation and progressive deepen idempotency;
- only explicit source/world invariants, authoritative rule constraints, or explicit keeper
  decisions compile as hard gates.

Tests must not use prose keywords to infer intent, causal fit, completion, or Keeper quality.

## 21. Real Pi-Coc acceptance

Whole-product acceptance uses the canonical Pi-Coc RPC workflow, Grok as Keeper, and one natural
player. It is not a fixed script. Across natural play it must exercise:

1. normal A -> B -> C progression;
2. soft-gate bypass from A to C;
3. an exceptional result against a hard ceiling;
4. a roll made before the Keeper notices the ceiling;
5. failure establishing negative facts and causing re-planning;
6. a compound multi-action declaration stopping at the first new block;
7. a player correctly guessing an undiscovered secret without gaining knowledge;
8. private investigator knowledge not automatically becoming party knowledge;
9. a progressive PDF source gap not being treated as nonexistence;
10. objective completion and severe failure consequences in the same event;
11. a bypassed intermediate Quest retaining independent value;
12. a deterministic no-uncertainty action succeeding without a task-progress roll.

Acceptance requires:

- effects visible in later Keeper causality;
- canonical state and finalization receipts matching narration;
- sidecar Git state integrity proof passing;
- no player-side secret leakage;
- preserved play evidence;
- the canonical battle-report exporter carrying relevant events, rolls, effects, and state
  proof.

Slow model inference is acceptable; canned play, scripted players, fake Keeper logic, and
module-only claims are invalid for acceptance.

## 22. External precedent and deliberate differences

The design is consistent with several mature patterns, while deliberately rejecting their parts
that would replace the Keeper:

- [PDDL2.1](https://strathprints.strath.ac.uk/1846/) models actions through preconditions and
  effects. This specification adopts explicit causal facts but does not create an autonomous
  planner.
- [F.E.A.R. GOAP](https://pages.cs.wisc.edu/~dyer/cs540/handouts/gdc2006_orkin_jeff_fear.pdf)
  demonstrates runtime dependency discovery and re-planning after changed conditions. This
  specification surfaces routes and blockers to the Keeper rather than selecting a best route.
- [Event Sourcing](https://www.martinfowler.com/eaaDev/EventSourcing.html) supports authoritative
  event history plus rebuildable projections. This specification reuses the existing campaign
  Git/event authority rather than making the graph another store.
- [Ink](https://github.com/inkle/ink/blob/master/Documentation/WritingWithInk.md) shows the value
  and maintenance burden of explicit branches and loose ends. This specification keeps a graph
  view but rejects authored `next_task` flow as the runtime authority.

## 22A. Cross-references to sibling specifications

| Sibling specification | Relationship to this specification |
| --- | --- |
| `temporal-memory-contract.md` | Assertion store and schema — the single home that this spec's causal facts extend (§6A). |
| `git-temporal-memory-worldlines.md` | Git as authority; the episode/assertion graph, worldlines, and narrative debt are reused, not redefined. |
| `campaign-git-history.md` | Campaign sidecar Git authority; the causal system adds no second history store. |
| `pi-coc-adjudication-narration-report-contracts.md` | Adjudication/turn evidence flows into the existing battle-report contract. Slice 1 does not extend the report schema; the outcome-ceiling-correction reason rides the existing event/finalization receipt audit side, and `coc-export-battle-report` remains the sole report owner. |
| `pi-coc-tool-affordance-and-bounded-recovery.md` | Disambiguation: "affordance" there names tool and bounded-recovery affordances — a different domain. This spec's bypass/effect affordances are causal-world affordances. |
| `pi-coc-concurrent-development-architecture.md` | Concurrent development and merge discipline for implementing this specification. |
| Setup/play role machinery | Retired 2026-09-03: `coc_session_role.py` and the setup half of `session-roles.json` are gone, onboarding is the separate `pi-coc-setup` process, and a play launch refuses an unfinished campaign. Progressive compilation still stays on the existing deepen path. |

## 23. Non-goals

- no automatic planner, shortest path, or recommended walkthrough;
- no player-visible full task tree;
- no new repository PDF parser or OCR fallback;
- no keyword/regex semantic matcher;
- no Quest for every player action;
- no task gate that blocks actions, scenes, transitions, or endings;
- no Git branch per Quest;
- no model chain-of-thought storage;
- no Quest v1 migration, dual reader, or old-ID remapping;
- no Codex-host implementation changes under the Pi-Coc track lock;
- no first-slice graph editor or visualization UI;
- no replacement of clue, NPC, relationship, item, threat, time, rules, state, finalization,
  or Git ownership;
- no automatic reward table that replaces Keeper semantic effect choice;
- no parallel assertion ledger and no second narrative-debt store;
- no battle-report schema extension in Slice 1;
- no new blocking narrative gate (Rule 4 stays the only output gate).

## 24. Completion contract

The causal task capability is complete only when normal Pi-Coc play exposes it through the
canonical Keeper interface and a real Keeper can correctly handle order, bypass, failure,
hard/soft gates, exceptional results, knowledge boundaries, and source gaps; all actual effects
must reach canonical state and Git evidence without exposing hidden graph truth to the player.

Schema, source packs, projections, tests, or diagrams without that vertical path are
`experimental` or `unintegrated`, never complete.
