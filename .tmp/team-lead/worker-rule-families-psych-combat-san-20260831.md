# Psychology, Combat, and Sanity family source acceptance handoff

- Work id: `pi-coc-all-rule-families-20260831`
- Task: `rule-families-psych-combat-san`
- Active track: `pi-coc`
- Opposite Codex-host track and primary checkout: untouched / off-limits
- Worker dimensions: `codex` / `implementer` / `inherit` / `oneshot`
- Branch: `codex/pi-coc-rule-families-psych-combat-san-20260831`

## Outcome

Three family-scoped candidates were independently reviewed against the exact
40th Anniversary Keeper Rulebook PDF and accepted through canonical
`coc_rule_graph.accept()`. Shared production `rule-graph.json`, graph manifest,
ruleset manifest, operation archive/policy, and other families were untouched.

| Family | Applicable rules | Coverage | Accepted shard digest | Commit |
| --- | ---: | --- | --- | --- |
| psychology | 8 | accepted | `6499014cfac0a26f1eaaa308fb80c38521e4df0355398d40e0731b241d28f527` | `07f3aa48` |
| combat | 22 | accepted | `ba380a1cf826825ac859b07de605718ff123a749baa086f30ddbbd5b7802696d` | `84840a6a` |
| sanity | 20 | accepted | `bfa283ef774a31892f81c0a5da131b8ae0bb3193367c29151cac09c0e83a41ba` | `3b355e8c` |

Every committed candidate has zero unresolved applicable rules and zero
exception nodes. Each family has a unique reviewer identity, source-review
record, candidate, canonical accepted-evidence envelope, and deterministic
regeneration test.

## Source evidence

- Original PDF SHA-256:
  `a860499cf34b40cac385f51b6e667ab37ec0796c7329494def08c8b161fd71eb`
- Psychology: PDF indices 83, 84, 215; bundle
  `psychology-full-v1`, digest
  `df4cceb1c29cdc530a43ef8b51122d85c20be2fb43a7fcfd0bbb6191ae1f1ae0`.
- Combat: PDF indices 113-130 and 412-417; bundle `combat-full-v2`,
  digest `5e1a929b0b37f9782fcfb67a24c94846d6e12612f84b3523f9d01cd97413c8eb`.
- Sanity: PDF indices 165-180; bundle `sanity-full-v1`, digest
  `ce3c510abac55d751b3d8f35e418d5a17e378baaa3317b2fe75604f3ab2c6754`.

All 43 distinct selected pages were rendered from the original PDF and
visually inspected. The validated external bundles are retained under
`/Users/haoli/Documents/TRPG/coc英文/coc7-rulegraph-source-bundles/` as reusable
source caches.

## Source-correct runtime follow-up

Source review found one exact discrepancy: legacy Sanity scheduled indefinite
Psychoanalysis after 7 days, while PDF indices 175 and 178 specify monthly
treatment/psychotherapy progress. The follow-up changes only that cadence to
one 30-day elapsed-time treatment month. Existing authoritative time trigger,
`auto_apply_if_safe` policy, handler, and idempotency path remain unchanged.
The Sanity review record now has no remaining blocker in this scope.

## Validation

- Full-family acceptance/regeneration: `6 passed` with external bundles.
- Source-stage non-regression: `8 passed, 1 skipped` (the unrelated optional
  regeneration test skips without its older bundle env).
- Sanity time + session: `70 passed`.
- Plugin metadata: `33 passed`.
- `git diff --check`: passed.

## Plan ledger

- P1 PDF identity, page-scope expansion, and visual review: completed.
- P2 Psychology full-family candidate + canonical accept + rolling commit:
  completed (`07f3aa48`).
- P3 Combat full-family candidate + canonical accept + rolling commit:
  completed (`84840a6a`).
- P4 Sanity full-family candidate + canonical accept + rolling commit:
  completed (`3b355e8c`).
- P5 Source-correct monthly treatment cadence and focused regression:
  completed in the final branch commit.
- Shared production graph cutover: explicitly not performed.
