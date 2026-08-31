# Director and time gateway fix handoff

- Task: `director-time-gateway-fix`
- Active track: `pi-coc`
- Opposite Codex-host track: untouched / off-limits
- Worker dimensions: `codex` / `implementer` / `inherit` / `oneshot`
- Branch: `codex/pi-coc-director-time-gateway-fix-20260831`
- Commit: branch HEAD (scoped commit)

## Confirmed defects

1. R21 `director.advise` canonical calls succeeded, but the result projector
   rejected nested semantic graph refs as undeclared. A second live envelope
   also carried a host-generated opaque candidate-plan `decision_id`.
2. The typed `state.advance_time` schema intentionally hides host-owned
   `decision_id`. The existing scene-clock binding injects it only when a valid
   scene card is armed; an ordinary unbound natural time call reached the
   canonical tool without it and failed `missing_param` every time.

## Changes

- Added a `director.advise` operation-local result identity declaration:
  scene/location/NPC/SAN-trigger/front/danger/clock refs remain semantic;
  candidate decision identity and display-only `monster_ref` remain host-only.
  Values still pass the existing closed grammar; no global field was opened.
- After raw model identity validation and any retained typed binding, an
  unbound typed `state.advance_time` now receives the existing host-generated
  `semanticDecisionId("state.advance_time")`. Repeated identical calls in the
  unchanged player epoch get the same idempotency identity.
- `state.purchase` was inspected but not changed: its discovery schema still
  exposes and requires a model-authored semantic `decision_id`, so it does not
  share the hidden-host-field defect.

No Director semantics, time arithmetic, canonical state, campaign evidence,
or Codex-host implementation changed.

## Validation

- Replayed every retained R21 `director.advise` canonical envelope through the
  current projector: 12 checked, 0 identity diagnostics, all `ok:true`.
- `tests/pi/director-advise-projection.mjs`: 2/2 passed, including opaque-id
  rejection.
- `tests/pi/tool-affordance-extension.mjs`: 53/53 passed. New test proves an
  unbound first natural time call succeeds, model schema/input has no decision
  id, canonical transport receives one, and same-epoch replay is stable.
- `tests/pi/normal-model-id-boundary.mjs`: all assertions passed.
- `tests/pi/typed-tool-surface.mjs`: 16/16 passed.
- `tests/pi/semantic-identity-registry.mjs`: all assertions passed.
- Plugin metadata + rulebook audit: 34 passed.
- `git diff --check`: passed.

The isolated worktree used the integration worktree only as the existing test
resolver's embedded Pi dependency root. Edited imports came from this worktree.
