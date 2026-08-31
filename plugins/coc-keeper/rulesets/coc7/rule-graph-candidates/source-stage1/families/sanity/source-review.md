# Sanity family source review

Verdict: **ACCEPTED** for the complete applicable Sanity family source
semantics, with no remaining runtime-integration blocker in this scope.

Reviewer: `codex-worker-sanity-source-review-20260831` (independent of the
source-stage1 producer).

Source identity:

- PDF SHA-256: `a860499cf34b40cac385f51b6e667ab37ec0796c7329494def08c8b161fd71eb`
- Reviewed PDF indices: 165-180
- Normalized bundle SHA-256: `ce3c510abac55d751b3d8f35e418d5a17e378baaa3317b2fe75604f3ab2c6754`

All 16 selected pages were rendered and visually inspected. The accepted
scope covers SAN rolls and loss, failed-roll involuntary action, fumble loss,
maximum SAN, temporary/indefinite/permanent insanity, both bout modes,
underlying insanity, phobias/manias, reality checks, Mythos gains, treatment
and recovery, current-SAN gains, Getting Used to the Awfulness, and the three
optional rules on the final page.

The two derivative `uncompiled` exception nodes were removed. Their source
rules are represented directly, yielding 20 accepted applicability rows and
zero unresolved source rules.

The review found that the legacy Sanity runtime scheduled Psychoanalysis after
one week, while PDF indices 175 and 178 state that treatment/psychotherapy
progress is checked after each month. The source-review follow-up changed only
that cadence to one 30-day elapsed-time treatment month, preserving the
existing trigger handler, safety policy, and idempotent scheduling path.

Accepted shard: `shard:coc7:sanity:section-sanity-complete-source`.

Accepted shard digest:
`bfa283ef774a31892f81c0a5da131b8ae0bb3193367c29151cac09c0e83a41ba`.
