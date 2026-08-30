# Pi-Coc Healing RuleGraph Promotion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the source-accepted CoC7 healing family usable through the single Keeper-visible `rules.settle` interface, retire its four legacy Keeper operations, and prove the normal path in a fresh Pi-Coc RPC play run.

**Architecture:** Keep `RulesRuntime.context/settle` as the external seam. Rebuild healing from a canonical three-page rulebook source bundle, compile First Aid timing and two-rescuer semantics into the existing CoC7 resolver/healing subsystem, then change the family ownership ledger atomically from `shadow/visible` to `graph/hidden`. Dice, state, idempotency, receipts, finalization, and replay remain in their current owners.

**Tech Stack:** CPython 3.14.6, uv 0.11.16, pytest, existing CoC7 resolver and subsystem executor, generated Pi operation policy, Pi RPC with Grok Keeper.

---

## File responsibilities

- `tests/fixtures/_gen_healing_rulegraph_promotion.py`: reproducibly prepares, accepts, builds, reviews, and packages the healing shard from the external source bundle; writes only the two production graph artifacts.
- `plugins/coc-keeper/scripts/coc_rule_graph.py`: deterministic graph packaging helper for the reviewed `healing -> graph/hidden` ownership transition.
- `plugins/coc-keeper/rulesets/coc7/resolver.py`: builds the existing `stabilize` command, including an optional second rescuer.
- `plugins/coc-keeper/scripts/coc_healing.py`: resolves one- or two-rescuer First Aid without creating a second state path.
- `plugins/coc-keeper/scripts/coc_subsystem_executor.py`: validates the optional assistant fields and emits both authoritative D100 roll events from one atomic command.
- `plugins/coc-keeper/rulesets/coc7/rule_graph_adapter.py`: resolves assistant skill data from canonical sheets and maps the compiled plan into the retained internal healing adapter.
- `plugins/coc-keeper/rulesets/coc7/{manifest.json,rule-graph.json,rule-graph-manifest.json}`: exact production ownership and generated source graph.
- `plugins/coc-keeper/pi/lib/operation-policy.generated.ts` and `plugins/coc-keeper/references/mcp-operation-contracts.json`: deterministic operation-surface projections.
- Focused Python/Node tests: the external seam, two-roll mechanics, replay, policy, working-set activation, finalization, and package conformance.

### Task 1: Canonical healing source bundle

**Files:**
- External create: `/Users/haoli/Documents/TRPG/coc英文/coc7-rulegraph-source-bundles/healing-promotion-v1/manifest.json`
- External create: `/Users/haoli/Documents/TRPG/coc英文/coc7-rulegraph-source-bundles/healing-promotion-v1/pages/0131.md`
- External create: `/Users/haoli/Documents/TRPG/coc英文/coc7-rulegraph-source-bundles/healing-promotion-v1/pages/0132.md`
- External create: `/Users/haoli/Documents/TRPG/coc英文/coc7-rulegraph-source-bundles/healing-promotion-v1/pages/0133.md`

- [ ] Render zero-based PDF pages 131–133 in one batch with Poppler and visually verify First Aid, Dying, Medicine, and Major Wound Recovery.
- [ ] Export exact page Markdown from the existing MinerU page-index artifact, retaining table blocks when present.
- [ ] Build the formal `codex-pdf-skill` manifest with exact original-PDF SHA-256, page hashes, realistic confidence, accepted review states, and checked verbatim anchors.
- [ ] Run:

```bash
PYTHONDONTWRITEBYTECODE=1 uv run --frozen python \
  plugins/coc-keeper/scripts/coc_pdf_bundle.py \
  '/Users/haoli/Documents/TRPG/coc英文/coc7-rulegraph-source-bundles/healing-promotion-v1' \
  --output '/Users/haoli/Documents/TRPG/coc英文/coc7-rulegraph-source-bundles/healing-promotion-v1/normalized-source.json'
```

Expected: exit 0 and one canonical `bundle_sha256` for exactly three pages.

### Task 2: RED — source rebuild and promotion contract

**Files:**
- Create: `tests/test_rule_graph_healing_promotion.py`
- Create: `tests/fixtures/_gen_healing_rulegraph_promotion.py`
- Modify: `plugins/coc-keeper/scripts/coc_rule_graph.py`

- [ ] Write a failing package test that requires:

```python
assert manifest["family_coverage"]["healing"] == "accepted"
assert manifest["family_promotion_eligibility"]["healing"] == {
    "promotion_eligible": True,
    "runtime_ownership": "graph",
}
assert graph["family_runtime_ownership"]["healing"] == "graph"
assert graph["legacy_surface_lifecycle"]["healing"] == "hidden"
assert "exception:coc7:healing:first-aid-window-uncompiled" not in node_ids
assert "exception:coc7:healing:first-aid-teamwork-uncompiled" not in node_ids
```

- [ ] Run the single test and verify RED because production remains `shadow/visible` with both exclusion nodes.
- [ ] Implement the in-memory source candidate generator: call `coc_rule_graph.prepare`, rebind the reviewed healing shape to real source spans, remove only the two closed gap markers, add the new structured condition/input nodes, call `accept`, then `build` in a temporary machine-owned evidence root.
- [ ] Add `apply_healing_graph_package(...)` to set `graph/hidden`, recompute graph digest, attach the formal source bundle identity, remove the two obsolete executor findings, and record the explicit reviewer identity.
- [ ] Regenerate the two package graph artifacts and run the test to GREEN.

### Task 3: RED — one-hour First Aid applicability

**Files:**
- Modify: `tests/test_rules_runtime.py`
- Generated modify: `plugins/coc-keeper/rulesets/coc7/rule-graph.json`

- [ ] Replace the old exception test with two interface tests:

```python
assert ordinary_card_at_minute_60["applicability"] == "applicable"
assert ordinary_card_at_minute_61 is None
assert settle_after_minute_61["error"]["code"] in {
    "rule_decision_not_applicable", "no_candidate_in_compiled_scope",
}
assert rolls_after_rejection == []
```

- [ ] Run each test and verify RED against the old soft, uncompiled window marker.
- [ ] Generate `condition:coc7:healing:first-aid-ordinary-eligible` as a hard `all(not dying, lte time.minutes_since_injury 60)` condition sourced from PDF index 131.
- [ ] Run the focused tests to GREEN and confirm an absent wound timestamp fails closed rather than inventing a treatment window.

### Task 4: RED — two-rescuer First Aid

**Files:**
- Modify: `tests/test_healing.py`
- Modify: `tests/test_subsystem_executor.py`
- Modify: `tests/test_rules_runtime.py`
- Modify: `plugins/coc-keeper/rulesets/coc7/resolver.py`
- Modify: `plugins/coc-keeper/scripts/coc_healing.py`
- Modify: `plugins/coc-keeper/scripts/coc_subsystem_executor.py`
- Modify: `plugins/coc-keeper/rulesets/coc7/rule_graph_adapter.py`
- Modify: `plugins/coc-keeper/scripts/coc_operation_rules_core.py`

- [ ] Write failing pure healing tests proving two rolls occur, either success heals/stabilizes once, both failures do not heal, and each roll retains its rescuer/target/outcome.
- [ ] Write a failing subsystem test proving one `stabilize` command accepts exactly one optional assistant pair and emits two public percentile evidence rows without duplicate HP mutation.
- [ ] Write a failing `rules.settle` integration test using only semantic `assistant_rescuer_ref`; canonical sheets must supply both skill values and the result must persist/replay without rerolling.
- [ ] Verify every new test fails for the missing assistant command fields, not a fixture error.
- [ ] Extend the existing resolver request with optional `assistant_skill_value` and `assistant_rescuer_id`; do not create a second command kind.
- [ ] Extend `HealingSession.first_aid` to resolve the two checks as one treatment and one state transition while preserving both roll records.
- [ ] Extend subsystem validation and roll-evidence projection for the assistant pair; keep batch preflight and snapshot replay authoritative.
- [ ] Extend the package adapter to resolve the assistant’s sheet and fail closed when the semantic assistant identity has no canonical First Aid value.
- [ ] Run the three focused test files to GREEN.

### Task 5: RED — Keeper surface cutover

**Files:**
- Modify: `tests/test_healing_keeper_surface.py`
- Modify: `tests/test_operation_policy.py`
- Modify: `tests/pi/tool-working-set.mjs`
- Modify: `tests/pi/domain-tools-acl.mjs`
- Modify: `plugins/coc-keeper/rulesets/coc7/manifest.json`
- Regenerate: `plugins/coc-keeper/pi/lib/operation-policy.generated.ts`
- Regenerate: `plugins/coc-keeper/references/mcp-operation-contracts.json`

- [ ] Change tests first to require legacy healing operations to be host-internal, `rules.settle` to be Keeper-visible, healing cards to activate `rules.settle`, and exact `rules.context` discovery to remain unchanged.
- [ ] Run Python and Node focused tests and verify RED against `shadow/visible`.
- [ ] Set the package healing row to `graph/hidden` and regenerate policy/archive using the repository generators.
- [ ] Run focused tests to GREEN; verify tool/schema budgets and execute-time ACL still pass.

### Task 6: Integration, replay, receipts, and finalization

**Files:**
- Modify: `tests/test_rules_runtime.py`
- Modify: `tests/test_turn_finalization.py` only if the existing generic settlement projection lacks the required receipt evidence.

- [ ] Add an interface-level test: `rules.context`/`scene.context` issues a card, `rules.settle` executes one existing subsystem command, and the four hidden legacy operation names never appear in the Keeper projection.
- [ ] Add exact replay and changed-request conflict tests; assert no second D100 row and no second HP mutation.
- [ ] Assert public roll completeness for one- and two-rescuer settlements and exact-once HP/condition projection through `turn.output_context` and `turn.finalize`.
- [ ] Run the full focused RuleGraph/runtime/policy/conformance matrix and fix only failures intersecting this seam.

### Task 7: Real Pi-Coc RPC acceptance

**Files:**
- Preserve under a fresh acceptance workspace: campaign state, RPC transcript, stderr, tool calls, rolls, receipts, graph ownership evidence.

- [ ] Read the canonical `coc-main` and `coc-keeper-play` procedures before starting play.
- [ ] Start a fresh campaign through:

```bash
plugins/coc-keeper/pi/bin/pi-coc --mode rpc --campaign rulegraph-healing-e2e-20260830
```

- [ ] Use Grok as the sole Keeper and the main Codex session as the sole player; answer one natural player line at a time.
- [ ] Continue naturally until injury plus First Aid/Medicine arises, then verify the Keeper received a healing decision card and called `rules.settle`, not any of the four retired Keeper operations.
- [ ] Verify authoritative D100/HP/condition/receipt/finalization evidence and retry the implementation loop if the live path exposes a systemic failure.
- [ ] Preserve the run; do not delete the campaign or source assets.

### Task 8: Final verification and integration

**Files:** all scoped files above.

- [ ] Run fresh source regeneration with `COC_HEALING_RULE_GRAPH_SOURCE_BUNDLE` set and require byte-identical production graph artifacts.
- [ ] Run required metadata and rulebook audit gates plus all focused Python and Node tests.
- [ ] Inspect the staged diff and commit only the scoped Pi-Coc/shared files.
- [ ] Integrate the exact worker commit into `0.8.0a`, rerun the critical source/runtime/metadata gates on main, and close the task-owned worktree with the canonical lifecycle tool.

