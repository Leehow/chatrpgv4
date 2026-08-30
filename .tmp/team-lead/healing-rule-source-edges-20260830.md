# Healing RuleGraph rule/source edge repair

- Active track: `ACTIVE_IMPLEMENTATION_TRACK=pi-coc`
- Base: `f490b69c60549e180ed5b1a2896a6ff308351b39`
- Branch: `codex/pi-coc-healing-rule-source-edges-20260830`
- Codex-host track: off-limits and unchanged
- `coc_mcp_wire.py` and its tests: off-limits and unchanged
- Runtime fallback/guessing: not added

## Failure reproduced

The packaged production healing graph had Decision -> Capability `invokes`
relations but no Rule -> Capability `invokes` relations. The existing
`RulesRuntime._rules_for()` intentionally resolves provenance by finding the
rules that invoke the selected decision's capability. Production
`first-aid-ordinary` therefore projected:

```text
rule_refs=[]
source_refs=[]
```

Two retained RED seams caught the exact defect:

1. the packaged graph relation test failed first on
   `decision:coc7:healing:dying-hour-clock` because its capability had no
   incoming Rule edge;
2. the production `RulesRuntime` card test found
   `first-aid-ordinary.rule_refs == []`.

## Repair

The source-reviewed healing generator now emits five explicit Rule ->
Capability `invokes` relations:

- `rule:coc7:healing:first-aid` -> `capability:coc7:first-aid`
- `rule:coc7:healing:medicine` -> `capability:coc7:medicine`
- `rule:coc7:healing:dying-clocks` -> `capability:coc7:dying-check`
- `rule:coc7:healing:dying-entry` -> `capability:coc7:dying-check`
- `rule:coc7:healing:weekly-recovery` ->
  `capability:coc7:weekly-recovery`

The generator binds each relation to the same reviewed healing evidence spans
as its rule and capability, then validates the candidate through the canonical
RuleGraph compiler. Production `rule-graph.json` and
`rule-graph-manifest.json` were regenerated from the formal source bundle at:

```text
/Users/haoli/Documents/TRPG/coc英文/coc7-rulegraph-source-bundles/healing-promotion-v1
```

Generated result:

- nodes: 45
- relations: 69 (previously 64)
- graph content digest:
  `7b0469dc97f500cf552d3e67ed2165260098f9530e84319e444d120aa5541ffa`
- shard digest:
  `8908a5e9874464082b73f90bb6386b8008d4c28a30ae14822817f349e4da827b`

No rules runtime code changed. There is no decision-name mapping, fallback
source lookup, or hard-coded card payload at runtime.

## Production result

Every packaged healing decision now projects nonempty semantic provenance:

- First Aid decisions: 1 rule ref / 2 source refs
- Medicine decisions: 1 rule ref / 2 source refs
- Dying clock decisions: 2 rule refs / 4 source refs
- Weekly major-wound recovery: 1 rule ref / 12 source refs

The real toolbox path `rules.damage -> scene.context -> rule_decision_cards`
now asserts the exact First Aid rule and its two reviewed source spans.

## Verification

- Production healing promotion + external source-bundle byte-exact rebuild:
  **3 passed in 0.08s**.
- Full `tests/test_rules_runtime.py`: **76 passed in 29.95s**.
- Focused real toolbox damage -> healing-card provenance: **1 passed in
  4.70s**.
- Rulebook audit + ruleset conformance + plugin metadata: **54 passed in
  3.96s**.
- RuleGraph package/healing/stage batch: **79 passed, 2 skipped**; four
  pre-existing stage1 tests still require production to be byte-identical to
  the obsolete pre-stage1 graph. Those same four failures reproduce on clean
  base `f490b69c` and were not changed.
- `git diff --check`: passed.

External web precedent was intentionally not used: the repository's closed
RuleGraph relation vocabulary and `RulesRuntime._rules_for()` are the binding
semantics; generic knowledge-graph conventions cannot validate this internal
contract.

## Integration note

This commit changes only the healing generator, generated production graph and
manifest, and provenance-focused tests. It is ready for serial review and
cherry-pick onto the exact Pi-Coc RuleGraph integration head.
