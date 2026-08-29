# Module Knowledge Graph — pre-KP handoff

> **Status:** PARTIAL — deterministic compiler and extraction Skill are implemented; real-source semantic acceptance is 8/8. Source-language storage still needs a fresh forward-test, so the capability remains experimental and unintegrated.
> **Date:** 2026-08-28
> **Track:** `ACTIVE_IMPLEMENTATION_TRACK=pi-coc`; Codex-host and KP/live-play implementation were not changed.
> **Spec:** [module-knowledge-graph-extraction.md](../specs/module-knowledge-graph-extraction.md)

## 1. Implemented interface

`plugins/coc-keeper/scripts/coc_module_graph.py` now exposes the spec's deep module seams:

```text
prepare request + source bundles
  -> evidence-packet.json + model-safe extraction-packet.json

candidate + exact source bytes
  -> deterministic check -> independent semantic review
  -> accepted-shard.json + review-receipt.json

build plan + accepted directories + source bundle bindings
  -> manifest-selected immutable asset-root generation

installed-search / installed-context
  -> audience-filtered diagnostic retrieval
```

The implementation includes:

- exact EvidenceSpan selection within accepted pages;
- model views without source path, source ID, hash, anchor, UUID, or digest;
- closed extraction/review/build contracts;
- aspect-scoped coverage with undeclared domains forced to `unresolved`;
- machine-owned root evidence union;
- semantic review as a required, non-mutating acceptance gate;
- candidate/evidence/review digest binding in the review receipt;
- cross-shard reference resolution and unused-ref rejection;
- source-byte, page-hash, and verbatim-anchor validation;
- immutable generation directories plus atomic root manifest switching;
- deterministic rebuild for identical accepted inputs;
- partial/complete build status from an explicit planned-shard set;
- Keeper/player lexical search and bounded visibility-safe traversal;
- the corpus-derived `worships` relation without a generic fallback edge.

No Neo4j, GraphRAG, embedding, vector store, campaign-state graph, or alternate PDF parser was added.

## 2. Real-source acceptance

Every PASS below used a real local source bundle and completed:

```text
prepare -> real model extraction -> source-bound deterministic validation
-> independent semantic review -> accept receipt -> asset-root build
-> installed search/context diagnostic
```

Raw module text, candidates, reviews, and installed acceptance assets remain under the task-local
`/private/tmp/coc-module-kg-reanalysis.ffpPPB/acceptance-v1/` workspace and are not committed.

| Case | Result | Accepted evidence |
| --- | --- | --- |
| Short public premise + Keeper antagonist | PASS | Cursed Be the City: public identity and a separate keeper-only ghost/host-seeking shard |
| Time loop | PASS | An Amaranthine Desire: loop reset, linked injury, aging, break requirements and outcomes |
| Location sandbox + environment mechanics | PASS | Blood Highway: sandbox structure/direction plus a separate heatwave/mechanics shard |
| Long sandbox campaign order | PASS | Masks of Nyarlathotep: 7 `print-precedes`, 0 `play-precedes`, 0 hard requirements |
| Optional sidetrack independence | PASS | Masks: core campaign and sidetrack playable units joined only by `independent-from` |
| Multi-era / virtual frame | PASS | Time After Time: 1954 and 2637 temporal frames with `occurs-during` neighborhoods |
| Fact / rumor / belief / lie | PASS | Blood folklore preserves fact+rumor; Simulacrum preserves actor belief; Dust to Dust preserves factual delivery plus actor-scoped `asserts/authored-lie` and contradiction against the false proposition |
| Supporting asset pack | PASS | A Time to Harvest Keeper Map Pack: source documents/assets related through `contains` and `supplements` |

Ten accepted graph generations were installed in the isolated acceptance workspace. They are
correctly `partial` because each is a bounded acceptance slice rather than a declared whole-book
build.

## 3. Diagnostic evidence

- Cursed player search finds the public playable unit and returns no ghost/secret nodes; Keeper search returns the antagonist neighborhood.
- Masks structure graph contains 7 publication-order relations, no play-order relations, and no hard requirements.
- Masks sidetrack graph retrieves the sidetrack node for Keeper and nothing for player.
- Blood sandbox search retrieves the heatwave hazard and its environment-pressure neighborhood.
- Blood folklore is revealable/keeper material and does not appear in the unrevealed player query.
- Time After Time expands the 1954 frame to its module, chapter, place, and 2637 frame neighborhood.
- A Time to Harvest asset lookup retrieves the Keeper map pack, player map reference, and parent campaign.

One retrieval-quality gap remains: the accepted Amaranthine shard translated source terms into English without retaining Chinese aliases, so Chinese `时光圈` did not match while English `loop` does. The Skill and semantic review protocol now require exact source-language aliases, but that accepted shard predates the correction and is not claimed as proof of the fix.

## 4. Rejected semantic candidates

The review gate rejected candidates for real semantic reasons rather than schema shape. The recurring findings drove systemic changes:

- broad page packets overreached their assigned section role → exact EvidenceSpan subset support;
- undeclared domains were overclaimed as absent → machine contract now requires `unresolved`;
- chapter transition conditions were flattened into `triggers` → requirement/handoff guidance;
- world procedures were mislabeled `uses-rule` → relation discipline;
- revealable folklore leaked Keeper correction → explicit split visibility guidance;
- speech delivery was confused with the truth of the spoken proposition → proposition-level truth-status guidance;
- unused `known_nodes` were copied into `node_refs` → deterministic `unused_node_ref` rejection;
- worship was forced into `supports` → explicit `worships` relation.

The authored-lie gap was closed by adding the explicit actor-to-proposition
`asserts` relation. A fresh independent extraction now preserves factual
delivery as `authored-fact`, the asserted search proposition as
`authored-lie`, and the detecting clue's contradiction against that proposition.

## 5. Deterministic validation

- `tests/test_module_graph.py` + `tests/test_plugin_metadata.py`: **58 passed**.
- Skill package validation: **Skill is valid**.
- Python compilation: PASS.
- Both graph contract JSON files parse successfully.
- `git diff --check`: PASS.

`tests/test_python_contract.py` has 7 passing tests and one pre-existing,
out-of-scope failure at `plugins/coc-keeper/pi/bin/coc-ocr-adapter.py:140`: an
old help string recommends a pip install command. That file is unchanged by
this work and was not repaired as adjacent cleanup.

Tests cover prepare, exact span selection, accept/reject semantic review, source binding, visibility, cross-shard refs, unused refs, ordering vocabulary, partial builds, batched source bundles, immutable generation reuse, installed retrieval, and source-safe model projection.

## 6. KP boundary

This implementation does not:

- generate or replace the seven Scenario IR files;
- query the graph during live Keeper turns;
- write Quest lifecycle, player knowledge, improvised canon, temporal memory, rules, state, or Git history;
- choose next scenes, objectives, routes, outcomes, reveals, or narration;
- claim Pi-Coc product acceptance.

`module-graph.json` remains a compiled-source diagnostic index. A later integration spec must
select one authority/promotion path and retire duplicate extraction before the KP consumes it.

## 7. Remaining pre-KP gates

1. Freeze `source_language` on the extraction packet and require source-language canonical storage rather than translation-plus-alias.
2. Re-run at least one Chinese-source shard and prove Chinese lexical retrieval from canonical names/summaries.
3. Re-run the complete focused deterministic suite after that change.
4. Only then change the parent spec status from partial to complete and draft the separate Graph-to-KP integration specification.

Until these gates pass, the honest status is: **compiler implemented, semantic acceptance partial, product unintegrated**.
