# Combat-end and SAN projection revision handoff

- Task: `combat-end-identity-card-fix`
- Active track: `pi-coc`
- Opposite Codex-host track: untouched / off-limits
- Worker dimensions: `codex` / `implementer` / `inherit` / `oneshot`
- Branch: `codex/pi-coc-combat-end-identity-card-fix-20260831`
- Commit: branch HEAD (scoped commit)

## Confirmed failure classes

1. An oversized authoritative `combat.end` result was reduced by the canonical
   wire to `{projection_sha256, replay_operation}`. Because combat.end had no
   operation-local integrity declaration, Pi converted the first successful
   result to `semantic_identity_unavailable`; Grok repeated the mutation.
2. R20 SAN results exposed additional closed-table omissions:
   - `sanity.execute` scheduled trigger and pending-choice machine identities;
   - `sanity.context` snapshot event/bout/trigger machine identities and
     semantic involuntary-action rule references;
   - `rules.sanity_check.phobia_roll_id`, which was neither registered nor
     projected through the existing roll domain.

## Changes

- Declared `combat.end.projection_sha256` operation-local integrity evidence.
  It is silently stripped from model content but retained in canonical details.
  `replay_operation` stays model-visible with its host-only contract ref removed.
- Declared SAN command/event/choice/bout/scheduled-trigger fields host-only on
  their exact operations. No global field or grammar was widened.
- Declared `sanity.context.rule_ref` semantic on that operation; opaque values
  still go through the existing closed semantic grammar.
- Added `phobia_roll_id` to the existing roll projector and the canonical SAN
  observer's structured roll-registration list.

No combat/SAN arithmetic, command semantics, canonical state, campaign
evidence, or Codex-host code changed.

## Regression evidence

- `tests/pi/combat-end-projection.mjs`: exact oversized identity-only envelope,
  digest absent, replay operation present, no diagnostics.
- `tests/pi/normal-model-id-boundary.mjs`: real Pi gateway sees one canonical
  combat.end transport and returns first-call `ok:true`; digest is absent from
  content and exact canonical details remain host-only. The same gateway test
  proves phobia roll registration and semantic projection.
- `tests/pi/sanity-result-projection.mjs`: exact R20-shaped
  `sanity.execute`/`sanity.context` nested paths project without diagnostics;
  semantic rule refs remain and machine ids are absent.

## Validation

- Combat projection: 1/1 passed.
- SAN result projection: 2/2 passed.
- Normal model ID boundary: all assertions passed.
- Tool affordance extension: 52/52 passed.
- Typed tool surface: 16/16 passed.
- Rule query projection: 5/5 passed.
- Semantic identity registry: all assertions passed.
- Plugin metadata + rulebook audit: 34 passed.
- `git diff --check`: passed.

The isolated worktree uses the integration worktree only as the existing
test resolver's embedded Pi dependency root. Edited product/test imports came
from this task worktree.
