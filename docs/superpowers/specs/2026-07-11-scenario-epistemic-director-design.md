# Scenario Epistemic Compiler + Director Epistemic Layer v1

**Date:** 2026-07-11  
**Status:** Approved for implementation  
**Branch:** `feature/scenario-epistemic-director-v1`  
**Scope:** A backward-compatible vertical slice that connects compiled module structure to player-belief-aware directing. The heavier PDF source-manifest/page-map service is specified as the next follow-up and is not implemented in this branch.

## 1. Problem

The repository already has a strong deterministic Keeper chain:

```text
module PDF / authored material
  -> scenario compilation
  -> seven structured scenario files
  -> deterministic Story Director
  -> rules / backfill / apply
  -> narration
```

The current compiler describes **what is true in the module** and **where clues can be delivered**. The current Director describes **what dramatic action should happen next**. The missing link is **what the player currently believes and how a delivered clue should change that understanding**.

`coc_intent_router` already exposes `player_hypothesis`, but runtime directing does not persist it as a belief model. Clue selection is currently driven by scene availability, route priority, and structured affordance matches. This is correct for agency, but it cannot distinguish:

- confirming a useful low-level inference;
- expanding the same inference into a broader scope;
- complicating motive, cost, or causality;
- fairly reframing old facts without invalidating them;
- holding a reveal because setup is insufficient.

The goal is to add an **epistemic sidecar** and a **belief-state reducer** without rewriting the existing seven-file Scenario IR or the existing scene-action scoring engine.

## 2. Design Principle

> The module compiler states what facts and questions exist. The belief layer states what the player currently thinks. The Director chooses how this turn should update that understanding. The narrator renders the resolved update only after rules and clue commitment are known.

This preserves the repository's existing rule:

> The director decides the dramatic contract; the narrator renders it.

It adds a second, orthogonal contract:

> The epistemic policy decides the belief-update contract; apply commits it only when the supporting clue actually lands.

## 3. Non-goals

This branch does **not**:

- rewrite `coc_story_director.py`;
- replace the existing seven scenario JSON files;
- make the deterministic runtime infer meaning from free prose;
- add embeddings, vector search, or a second LLM classifier;
- make the Director read PDF pages during every turn;
- implement the full PDF `page-map.json` / parse-manifest / file-hash cache invalidation service;
- create epistemic data for every existing packaged scenario;
- mechanically trigger a reversal after a fixed number of confirmations.

The PDF source-evidence bridge remains the next project. This branch prepares for it by keeping `source_refs` and compile confidence as optional structured evidence on epistemic nodes.

## 4. Architecture

```text
scenario/
  module-meta.json
  story-graph.json
  clue-graph.json
  npc-agendas.json
  threat-fronts.json
  pacing-map.json
  improvisation-boundaries.json
  epistemic-graph.json          # optional v1 sidecar
  reveal-contracts.json         # optional v1 sidecar

save/
  belief-state.json             # current reducer snapshot

logs/
  belief-events.jsonl           # append-only audit trail

runtime:
  coc_intent_router
    -> player_intent_rich.player_hypothesis / belief_candidate
  coc_story_director.build_director_context
    -> loads epistemic graph, reveal contracts, belief state
  coc_epistemic_policy.plan_epistemic_contract
    -> returns a deterministic contract
  coc_story_director.generate_director_plan
    -> emits scene_action + epistemic_contract
  rules / backfill
  coc_director_apply
    -> commits belief events only for actually committed clues
```

The main scene action remains one of:

```text
REVEAL DEEPEN PRESSURE CHARACTER CHOICE CUT MONTAGE SUBSYSTEM RECOVER PAYOFF
```

The epistemic move is orthogonal:

```text
NONE CONFIRM EXPAND COMPLICATE REFRAME HOLD PAYOFF
```

Examples:

```text
REVEAL + CONFIRM
REVEAL + COMPLICATE
REVEAL + REFRAME
CHARACTER + EXPAND
PAYOFF + PAYOFF
```

## 5. Scenario Sidecars

### 5.1 `epistemic-graph.json`

Canonical shape:

```json
{
  "schema_version": 1,
  "questions": [
    {
      "question_id": "q-archivist-motive",
      "layer": "motive",
      "player_facing_question": "Why did the archivist alter the records?",
      "truth_ref": "truth-archivist-protects-survivor",
      "importance": "critical",
      "opens_questions": ["q-selection-program"],
      "source_refs": []
    }
  ],
  "evidence_links": [
    {
      "clue_id": "clue-single-name-preserved",
      "question_id": "q-archivist-motive",
      "effect": "complicate",
      "strength": 0.8
    }
  ]
}
```

Allowed question layers:

```text
fact identity method motive causal structure world personal
```

Allowed evidence effects:

```text
confirm expand complicate reframe payoff
```

The graph is optional. Missing files preserve legacy behavior.

### 5.2 `reveal-contracts.json`

Canonical shape:

```json
{
  "schema_version": 1,
  "contracts": [
    {
      "reveal_contract_id": "rc-archivist-motive",
      "mode": "reframe",
      "target_question_id": "q-archivist-motive",
      "trigger_clue_ids": ["clue-survivor-hidden"],
      "preserve_as_true": [
        "truth-archivist-lied",
        "truth-records-were-altered"
      ],
      "revise_hypothesis_kinds": ["archivist-is-cultist"],
      "setup_refs": [
        "clue-single-name-preserved",
        "clue-archivist-fears-basement"
      ],
      "opens_questions": ["q-selection-program"],
      "explanation_targets": ["why-preserve-one-name"],
      "must_not": [
        "do not invalidate previously confirmed facts",
        "do not invent a new faction"
      ]
    }
  ]
}
```

A `reframe` contract is valid only when:

- `preserve_as_true` is non-empty;
- `setup_refs` contains at least two structured references;
- every `setup_ref` resolves to a clue id in `clue-graph.json`;
- every `trigger_clue_id` resolves to a clue id;
- `target_question_id` resolves to an epistemic question;
- any `opens_questions` ids resolve to questions.

The runtime never synthesizes a reframe without a compiled contract.

## 6. Belief State

### 6.1 Runtime snapshot

`save/belief-state.json`:

```json
{
  "schema_version": 1,
  "hypotheses": [
    {
      "hypothesis_id": "hyp-000001",
      "owner": "party",
      "question_id": "q-archivist-motive",
      "hypothesis_kind": "archivist-is-cultist",
      "claim": "The archivist belongs to the cult.",
      "confidence": 0.78,
      "status": "active",
      "supporting_clue_ids": [],
      "challenging_clue_ids": [],
      "recent_treatments": [],
      "created_turn": 4,
      "updated_turn": 4
    }
  ],
  "active_question_ids": [],
  "answered_question_ids": []
}
```

`confidence` means **how strongly the player appears to believe the claim**, not how true the claim is.

### 6.2 Structured belief candidate

The runtime accepts either legacy `player_hypothesis: string` or a structured candidate:

```json
{
  "claim": "The archivist belongs to the cult.",
  "question_id": "q-archivist-motive",
  "hypothesis_kind": "archivist-is-cultist",
  "confidence": 0.78
}
```

A legacy string is persisted as an unbound hypothesis (`question_id: null`). The deterministic runtime does not map prose to question ids. A host semantic evaluator may provide the structured object.

### 6.3 Events

`logs/belief-events.jsonl` supports:

```text
hypothesis_asserted
hypothesis_repeated
belief_confirmed
belief_expanded
belief_complicated
belief_reframed
belief_payoff
question_opened
question_answered
```

The snapshot is updated atomically after the corresponding event records are derived.

## 7. Epistemic Policy

`coc_epistemic_policy.py` is a pure deterministic module.

Inputs:

- `epistemic_graph`;
- `reveal_contracts`;
- `belief_state`;
- `world_state.discovered_clue_ids`;
- `player_intent_rich`;
- selected `clue_policy`;
- current `scene_action`.

Output:

```json
{
  "schema_version": 1,
  "mode": "COMPLICATE",
  "target_question_id": "q-archivist-motive",
  "target_layer": "motive",
  "belief_refs": ["hyp-000001"],
  "deliver_clue_ids": ["clue-single-name-preserved"],
  "preserve_fact_refs": [],
  "revise_hypothesis_refs": [],
  "setup_refs": [],
  "open_question_ids": ["q-selection-program"],
  "explanation_targets": [],
  "must_not": []
}
```

Policy rules:

1. No graph or no selected clue -> `NONE`.
2. Find the selected clue's `evidence_link`.
3. Map the evidence effect to the uppercase mode.
4. Attach active hypotheses whose `question_id` matches.
5. `REFRAME` requires a matching reveal contract.
6. `REFRAME` is ready only when all setup clue ids are already discovered or are the clue committed this turn.
7. If setup is insufficient, emit `HOLD` with `hold_reason = insufficient_setup` and do not claim a reframe.
8. Never choose a different truth because recent confirmations are repetitive.
9. Unknown or malformed data degrades to `NONE`, not invented semantics.

## 8. Apply Semantics

Belief state updates occur only after `_resolve_committed_clues` has produced `committed_clues`.

- If no planned epistemic clue was committed, no belief treatment is applied.
- A failed obscured clue therefore does not update belief state.
- A successful or obvious committed clue applies the resolved mode.
- `HOLD` writes no belief treatment.
- A structured player hypothesis can still be asserted even if no clue lands; it records the player's model, not a truth update.
- Re-applying the same decision remains idempotent through the existing apply ledger.

The apply layer appends belief events to both:

```text
logs/belief-events.jsonl
logs/events.jsonl
```

Then writes `save/belief-state.json` atomically.

## 9. Narrator Contract

The narrator receives only the resolved structured contract. It must:

- state only information that actually landed;
- preserve `preserve_fact_refs` as true;
- avoid contradicting `must_not` constraints;
- not answer `open_question_ids` in the same beat unless mode is `PAYOFF`;
- not use `HOLD` as a fake reveal.

This branch adds the contract to DirectorPlan but does not add a new prose generator.

## 10. Compiler Validation

`coc_scenario_compile.validate_compiled_scenario` validates optional sidecars when present.

Errors:

- duplicate question ids;
- evidence link points to missing clue or question;
- invalid question layer;
- invalid evidence effect;
- reveal contract points to missing question or clue;
- reframe contract lacks two setup refs;
- reframe contract lacks preserved facts;
- setup refs do not resolve to clue ids.

Warnings:

- critical question has no evidence links;
- critical question lacks `source_refs`;
- evidence link has strength outside `0..1`;
- epistemic sidecar present but no reveal contracts for any `reframe` effect.

Legacy scenarios without sidecars remain valid.

## 11. Compatibility and Safety

- Sidecar files are optional.
- Existing scenarios, tests, and module registry entries continue to work.
- Runtime never scans free prose for semantic branching.
- Keeper secret prose does not enter belief state or narrator fields.
- `belief_candidate.question_id` and `hypothesis_kind` are semantic-router outputs, not deterministic keyword inference.
- All shared behavior remains under `plugins/coc-keeper/`.

## 12. Testing

Required tests:

1. `tests/test_epistemic_policy.py`
   - clue evidence produces CONFIRM/COMPLICATE;
   - reframe holds without setup;
   - reframe becomes ready with setup;
   - matching belief refs are attached;
   - missing sidecars return NONE.

2. `tests/test_belief_state.py`
   - structured and legacy hypotheses are persisted;
   - repeated assertion updates the same hypothesis;
   - committed epistemic treatment updates support/challenge/treatment history;
   - uncommitted clue does not update beliefs;
   - events are append-only and snapshot is atomic.

3. `tests/test_scenario_compile.py`
   - valid epistemic sidecars pass;
   - broken clue/question refs fail;
   - invalid reframe contracts fail;
   - legacy no-sidecar fixture still passes.

4. `tests/test_story_director.py`
   - context loads sidecars and belief state;
   - DirectorPlan includes `epistemic_contract`;
   - legacy scenario emits `mode=NONE`.

5. `tests/test_director_apply.py`
   - failed clue gate does not update belief state;
   - committed clue applies belief event and snapshot;
   - duplicate decision remains idempotent.

Minimum verification:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest \
  tests/test_epistemic_policy.py \
  tests/test_belief_state.py \
  tests/test_scenario_compile.py \
  tests/test_story_director.py \
  tests/test_director_apply.py \
  -q -p no:cacheprovider

PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/ -q -p no:cacheprovider
```

## 13. Follow-up: PDF Source Evidence Bridge v1

A separate branch should implement:

- `coc_pdf_source.py` as the sole scenario-source entry point;
- PDF file hash and parser version in cache metadata;
- `index/page-map.json` for printed-page/PDF-index mapping;
- `index/parse-manifest.json` with quality and review state;
- source criticality tiers;
- low-quality critical reveal HOLD behavior;
- external/manual parse replacement without downstream changes.

This split keeps the present branch independently testable: it proves that parsed module structure can drive a belief-aware Director before replacing the PDF source infrastructure.
