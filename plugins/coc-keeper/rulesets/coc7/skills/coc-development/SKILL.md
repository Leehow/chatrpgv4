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
and implemented in `../../../../scripts/coc_runtime_ops.py`. Do not reproduce its
arithmetic in the host. A successful `state.end_session` synchronously composes
this operation for linked investigators; the first-class operation remains
available to replay a structured pending settlement.

## Workflow

1. Confirm the ending receipt, investigator identity, and the development
   status returned by `state.end_session`. Before settlement, the ending owns a
   versioned capsule under `save/development-settlements/endings/<ending-id>/`.
   It freezes a stable ending/event identity, exact `investigator_ids`
   (including an explicit empty list), scenario/conclusion and combat evidence,
   source digests, claimed skill-check inputs, and deterministic RNG identity.
   A retry never retargets or rescans an ending from changed party, scene,
   chapter, combat, or scenario state.
2. When that status is `PASS`, use its settlement receipt. When it is
   `PENDING`, retry `state.end_session` or call `development.settle` with the
   same decision/ending identity. The operation must synchronously consume all
   earned skill checks, roll improvements, recover Luck, apply any structured
   scenario SAN reward, update the reusable `character.json`, clear consumed
   campaign ticks, and return a settlement receipt. The same write-back also
   settles the campaign-local runtime inventory into the library sheet:
   gained weapons join `weapons[]`, sheet weapons recorded under
   `lost_weapon_ids` are removed, gear labels append to `equipment[]`, and
   each net change appends an idempotent `inventory_settled` event to the
   investigator's `inventory-history.jsonl`.
3. Present the completed settlement from the receipt's
   `player_facing_mechanics` block (hard constraint): every public improvement
   check, gain die, Luck recovery, and SAN reward appears there exactly once.
   Do not surface only the SAN reward. Also report skills checked, permanent
   increases, SAN gained, Luck before/after, and state/evidence references.
4. Retry only through the same idempotent settlement identity. Never settle a
   completed ending twice. A scenario conclusion reward has a separate durable
   per-investigator identity, so a later ending may run legitimate development
   and Luck recovery without paying the same conclusion SAN reward again.

## Persistence and evidence

Treat permanent character changes and campaign investigator state as critical
writes: complete them before reporting success. Settlement is planned in an
isolated mirror, then a durable journal records exact pre/post images and owned
append suffixes before canonical mutation. Shared reusable investigator files
are serialized in the fixed lock order campaign -> investigator. After planning,
an all-target compare-and-swap proves every file image and log prefix still
matches its preimage before the first canonical write. Symlinks, non-regular
targets, malformed images, or any divergence produce a zero-mutation typed
conflict. Every later canonical toolbox or
runtime operation performs recovery under the campaign lock before its own
read/write. Recovery rolls back only proven transaction-owned images; foreign
divergence returns typed `RECOVERY_CONFLICT` / `PENDING` evidence with exact
paths and is never overwritten or truncated. A conflict-free retry reuses the
original dice.

The authoritative commit receipt and recovery journal are keyed by
`(ending_id, investigator_id)`. A top-level per-investigator settlement file is
only a post-commit latest mirror; it is never used to recover or identify an
older pending ending.

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
