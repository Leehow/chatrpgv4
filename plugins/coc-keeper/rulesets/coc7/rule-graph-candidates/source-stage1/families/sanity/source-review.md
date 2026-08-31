# Sanity family source review

Verdict: **ACCEPTED** for the complete applicable Sanity family source
semantics, with no remaining runtime-integration blocker in this scope.

Reviewer: `codex-worker-sanity-applicability-review-20260831-v2` (independent of the
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

The executable graph now names nine exact phases over existing operations and
subsystem functions: context, SAN check, bout tick/end, reality check,
temporary recovery, monthly treatment, current-SAN gain, and advisory insane
insight. SAN check semantic inputs carry the source/loss expressions and the
Keeper's involuntary-action realization; canonical actor/SAN/trigger state is
host-locked. Bout decisions consume only the frozen pending-choice/command and
revision. Reality, recovery, treatment, and gain decisions similarly bind the
existing SanitySession/time receipts rather than copying their algorithms.

The check and bout decisions issue the existing Keeper bout choice and encode
check-to-bout, repeated tick, and tick-to-end continuations. Every accepted
Sanity rule invokes an exact existing capability; the generic `sanity_runtime`
placeholder and process-local continuity are absent.

Applicability re-review adds six registered, machine-projected Sanity facts.
Bout tick/end require `sanity.bout.pending`; reality check requires
`sanity.delusion.active`; monthly treatment and temporary recovery require
their respective due facts; insane insight requires `sanity.insane`; and
current-SAN gain requires a canonical `sanity.gain.pending` receipt. Every
condition is a hard `eq true` gate. Context and ordinary SAN check remain
normally available. Missing facts fail closed and no amount is inferred from
free text.

Accepted shard: `shard:coc7:sanity:section-sanity-complete-source`.

Accepted shard digest:
`7e5f37f22f87284b7ef20e637d767036474e747a25ca1b69007c663de9c78087`.
