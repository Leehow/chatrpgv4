# ModuleGraph → KP Slice 1 status

> **Status:** QUERY-INTEGRATED / NATURAL-PLAY PARTIAL — deterministic/toolbox/MCP integration and a fresh Pi-Coc RPC exact-discovery → search → semantic-seed → expand probe pass. A separate natural-play attempt did not reach a valid graph-backed investigation because Grok emitted premature player text and journaled before the required scene move.
> **Date:** 2026-08-28
> **Track:** `ACTIVE_IMPLEMENTATION_TRACK=pi-coc`
> **Spec:** [module-graph-to-kp-integration.md](../specs/module-graph-to-kp-integration.md)

## Implemented

- `module.context` is one strict read-only Keeper operation with status, search,
  and expand modes.
- Campaign binding is host-owned. Progressive/source-bound campaigns use the
  canonical source root; complete starter campaigns may reuse their canonical
  source-backed `handout_asset_root_id`. The model cannot pass an asset root or
  filesystem path.
- Search returns lexical candidates only. The KP must choose exact semantic
  seed IDs before expand; no top-1 semantic promotion exists.
- Expand is depth- and size-bounded and strips machine hashes, grep anchors,
  generation names, manifest paths, and local paths from model-facing context.
- Every response distinguishes ModuleGraph source languages from campaign
  `play_language`; localization is Keeper-owned and has `persistence: none`.
- Unbound, not-compiled, corrupt, partial, search-miss, and unknown-seed cases
  are explicit. None is interpreted as authoritative world absence or a play
  gate.
- The operation is registered through the sole toolbox registry, ownership
  manifest, MCP archive, Pi operation-policy projection, and canonical
  `coc-keeper-play` Skill. It is exact-discovery only and remains outside the
  ordinary hotset.

## Deterministic evidence

- Combined graph/toolbox/architecture/policy/plugin-metadata suite: **148
  passed**.
- `tests/test_toolbox_module_graph_context.py` contributes 17 focused public
  interface tests, including complete-starter handout-root binding.
- Focused MCP archive/discovery/projection suite: **4 passed**.
- `coc_mcp_contract_archive.py check`: 143 operations on latest `0.7.1a`,
  current hash-bound
  archive and Pi policy projection.
- `coc-keeper-play` Skill validation: PASS.

The focused Pi model-projection probe passes when pointed at the primary
checkout's same-version embedded Pi dependency. It proves ordinary
scene/clue/NPC/affordance semantic IDs remain visible, ModuleGraph semantic
IDs remain visible, and machine fields remain only in canonical details.

This disposable worktree does not contain
`runtime/adapters/keeper/node_modules/@earendil-works/pi-coding-agent`.
Consequently both the new pytest wrapper and the pre-existing
`package-smoke` test fail here with the same `ERR_MODULE_NOT_FOUND`; the
focused Node probe passes through the test suite's supported
`PI_TEST_REPO_ROOT` dependency override. The real RPC launch below also loaded
the current TypeScript extension successfully.

An earlier full `tests/test_plugin_mcp.py` run had 64 passes and 5 failures.
One was the operation-count assertion and is now fixed at 143 on the latest
mainline. The remaining
four are unrelated real-launcher ordering/error-shape failures in progressive
setup cases; they reproduce independently and are not changed by this slice.

## Real source and RPC evidence

Preserved evidence root:

```text
/private/tmp/coc-module-context-acceptance-20260828.RlRvMh/
```

Source: the manually accepted English `The Haunting` player-handout page from
the Keeper Rulebook source bundle. A fresh v3 candidate went through model
extraction, deterministic validation, independent semantic review, acceptance,
asset-root build, and campaign binding. Rejected candidates/reviews remain in
the same directory. The accepted shard keeps English canonical prose and marks
actors/knowledge partial rather than claiming completeness.

Pi-Coc was launched through the real `--mode rpc` path with `xai/grok-4.5`, a
fresh exact-current campaign, a fresh project-isolated agent home, and the
current worktree package. The accepted source graph remains English while the
campaign uses `play_language: zh-Hans`.

`rpc2-events.jsonl` records the successful bounded acceptance probe:

1. `coc_discover({operation:"module.context"})` installed exactly the typed
   `coc_module_context` operation outside the hotset.
2. Grok searched with English query `Michael Thomas`; the tool returned lexical
   candidates only.
3. Grok semantically selected exact seed `npc-michael-thomas` and issued a
   second expand call with `depth: 1`.
4. Expand returned the accepted English source node, explicit partial coverage,
   `source_languages: ["en"]`, `play_language: "zh-Hans"`, and
   `persistence: "none"`.
5. Grok finalized a Chinese meta response confirming the separation without
   exposing the retrieved biography or advancing fiction.
6. ModuleGraph remained immutable; the operation has no state/history write
   domains, and the focused mutation test proves no translation is written to
   graph or Scenario IR.

`rpc3-events.jsonl` records the natural-play attempt and its boundary:

- On relaunch, `session.resume` was the first campaign operation and ordinary
  scene/clue/NPC/route semantic IDs were model-visible.
- In the commission scene, KP correctly preferred the existing NPC/route
  working set and did not issue a redundant graph query.
- After that route unlocked the Hall of Records, Grok twice emitted premature
  player-facing text (`<|eos|>` on one turn) before the owning `state.move_scene`
  write. The output gate recovered by forcing journal/finalization, but the
  authoritative active scene remained `commission-briefing` while prose
  claimed travel/arrival. No later research turn was therefore valid, and none
  is credited as natural Graph-to-KP acceptance.

All three RPC logs, stderr logs, rejected source candidates, the accepted
shard, graph generation, campaign state, and turn receipts remain preserved
under the evidence root. Nothing was deleted or reconstructed.

## Landing note

This feature worktree is based on `797490f6`. The primary `0.7.1a` checkout is
one later commit ahead at `e9585737`, a large concurrent rewrite of Pi semantic
identity projection, recovery guidance, and generated contracts. Therefore:

- the RPC evidence above is exact evidence for this feature branch, not a claim
  that the unmerged primary checkout already exposes `module.context`;
- the small branch-local ModuleGraph projector must not be blindly preferred
  over the primary central identity boundary;
- landing should port the operation-specific ModuleGraph data projector into
  primary `projectModelVisibleCanonicalResult`, retain semantic
  `module_id`/`node_id`/`source_id` fields, keep machine evidence in canonical
  details, regenerate the 143-operation archive/policy, and rerun the focused
  Pi probe plus fresh RPC acceptance;
- this dirty worktree was not merged, rebased, or rewritten during acceptance.

## Honest completion boundary

The canonical operation, Pi exact-discovery path, model-visible search,
KP-selected seed expansion, secrecy projection, and source/play-language
separation are integrated. The honest label is
`query-integrated / projection-migration-pending`.

Slice 1 is not yet fully product-accepted because one natural, earned
graph-backed investigation has not completed through valid scene/state
settlement. The observed early-output/early-journal defect is outside the
ModuleGraph read contract and is retained as a separate host/KP blocker.
Graph → Scenario IR projection also remains a later slice; this work does not
claim the source pipeline has fully cut over.
