---
name: coc-development
description: Settle completed Call of Cthulhu sessions and scenarios. Use after a structured state.end_session receipt to resolve earned skill checks, permanent skill increases, scenario SAN rewards, Luck recovery, investigator-sheet write-back, and a source-traceable settlement receipt.
---

# COC Development

## Authority

Settle only from structured ending evidence. Require a persisted
`state.end_session` receipt and, for scenario rewards, a matching structured
scenario ending or conclusion identifier. Never infer an ending from narration,
player prose, or keyword matching.

Use the canonical `development.settle` operation exposed by the Keeper toolbox
and implemented in `../../scripts/coc_runtime_ops.py`. Do not reproduce its
arithmetic in the host. A successful `state.end_session` synchronously composes
this operation for linked investigators; the first-class operation remains
available to replay a structured pending settlement.

## Workflow

1. Confirm the ending receipt, investigator identity, and the development
   status returned by `state.end_session`. The ending receipt freezes its exact
   `investigator_ids`; a retry never retargets an ending from changed party
   state or incompatible arguments.
2. When that status is `PASS`, use its settlement receipt. When it is
   `PENDING`, retry `state.end_session` or call `development.settle` with the
   same decision/ending identity. The operation must synchronously consume all
   earned skill checks, roll improvements, recover Luck, apply any structured
   scenario SAN reward, update the reusable `character.json`, clear consumed
   campaign ticks, and return a settlement receipt.
3. Present the completed settlement: skills checked, permanent increases, SAN
   gained, Luck before/after, and state/evidence references.
4. Retry only through the same idempotent settlement identity. Never settle a
   completed ending twice. A scenario conclusion reward has a separate durable
   per-investigator identity, so a later ending may run legitimate development
   and Luck recovery without paying the same conclusion SAN reward again.

## Persistence and evidence

Treat permanent character changes and campaign investigator state as critical
writes: complete them before reporting success. Settlement is planned in an
isolated mirror, then a durable journal records exact pre/post images and owned
append suffixes before canonical mutation. Every later canonical toolbox or
runtime operation performs recovery under the campaign lock before its own
read/write. Recovery rolls back only proven transaction-owned images; foreign
divergence returns typed `RECOVERY_CONFLICT` / `PENDING` evidence with exact
paths and is never overwritten or truncated. A conflict-free retry reuses the
original dice.

SAN snapshots are canonical per investigator under
`save/sanity-state/<investigator-id>.json`. `save/sanity.json` remains only as
the legacy mirror for its original owner and must never be reused for another
party member.

Record every public development,
reward, and Luck die in the authoritative roll log with a stable `roll_id`,
public visibility, expression/target, component dice, and numerical result.

Only audit-log or mirror flushing may run in the background. Never defer skill,
SAN, Luck, character-sheet, or settlement-receipt writes.

Keep investigator creation, selection, and card rendering in `coc-character`.
Keep story-ending judgment in `coc-keeper-play`; this skill owns only the
post-ending settlement lifecycle.
