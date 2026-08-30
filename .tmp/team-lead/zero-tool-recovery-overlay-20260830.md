# Zero-tool recovery overlay / canonical-details separation

## Scope

- Active track: `ACTIVE_IMPLEMENTATION_TRACK=pi-coc`
- Codex-host track remained off-limits.
- Branch: `codex/pi-coc-zero-tool-recovery-overlay-20260830`
- Exact base: `587ba535b0b7326f0a1d31c040f75617d24a25cd`
- Worktree: `/Users/haoli/leehow/code/chatrpgv4-wt-zero-tool-recovery-overlay-20260830`
- Lifecycle task: `pi-coc-zero-tool-recovery-overlay-20260830`
- `coc_mcp_wire.py`, RuleGraph, ruleset source/generated artifacts, campaign state, rewind, and finalization code were not changed.

## Failure and TDD evidence

The Pi extension correctly created a host-behavior/model overlay for a verified zero-tool accepted player input, but then passed that overlay to `gatewayResult()` as if it were the canonical receipt. The model-facing content was correct, while host-only `details.data.mode` had been rewritten from canonical `awaiting_player` to `open_turn_recovery`; the untouched canonical `wire.control.mode` still said `awaiting_player`.

RED 1 exercised the public root-extension tool-result seam and asserted both halves of the contract. Before the fix:

```text
details.data.mode actual:   open_turn_recovery
details.data.mode expected: awaiting_player
```

RED 2 applied the same exact-receipt invariant to ordinary row-backed `open_turn_recovery`. It proved that pre-existing guidance projection also replaced canonical `details.current_turn` with the semantic model view. The implementation was then narrowed so pending-finalization live-card hydration retains its existing exact-card host details; only open-turn recovery overlays use this separation.

## Repair

`gatewayResult()` now has an invocation-local `canonicalDetailsOverride`:

- canonical row-backed open-turn recovery snapshots the accepted `session.resume` envelope before adding player input/guidance;
- verified zero-tool rebound snapshots the accepted canonical `awaiting_player` envelope before changing host behavior to `open_turn_recovery`;
- progress observation, ACL, working-set projection, journal binding, semantic player-input projection, cache clear, and anchor roll-forward continue to consume the host overlay;
- normal result `details` and semantic-identity failure diagnostics retain the untouched accepted canonical receipt;
- pending-finalization hydration keeps its established exact live-card details path and was not generalized into this change.

Production-shaped assertions now prove:

- zero-tool model content is `open_turn_recovery` with the exact keeper-only player input;
- zero-tool host details remain `awaiting_player`, `current_turn=null`, and `wire.control.mode=awaiting_player`;
- ordinary row recovery host details keep the canonical row/detail card and contain no host guidance/player-input overlay;
- missing, tampered, cross-timeline, and journaled zero-tool neighbors remain unchanged canonical `awaiting_player` results;
- player-visible output remains free of the recovered player-input duplicate.

## Validation

- `tests/pi/recovery-kp-guidance.mjs`: PASS after both RED/GREEN cycles.
- `tests/pi/domain-tools-acl.mjs`: PASS.
- `tests/pi/role-acl.test.mjs`: 18/18 passed.
- `tests/pi/tool-working-set.mjs`: 19/19 passed.
- `tests/pi/operation-contract-loader.mjs`: 4/4 passed.
- `tests/pi/typed-tool-surface.mjs`: 16/16 passed.
- `tests/pi/turn-processing-fault-gate.mjs`: 21/21 passed.
- `tests/pi/open-turn-player-input.mjs`: 6/6 passed.
- `tests/pi/startup-resume-table-opening.mjs`: PASS.
- `tests/pi/normal-model-id-boundary.mjs`: PASS.
- Focused recovery/startup plus full plugin metadata pytest: 35 passed in 5.62s.
- Full `tests/test_continuation_resume.py`: 14 passed in 38.30s.
- `git diff --check`: PASS.

`tests/pi/startup-resume-typed-opening-phase.mjs` still fails at its fresh exact `campaign.create` assertion with the existing selected-campaign guard. The identical failure reproduces on untouched base worktree `587ba535`; it is retained as unrelated baseline evidence and was not expanded into this repair.

External precedent research was skipped because this is a narrow correction to an established repository-private canonical/model projection boundary with a direct production-shaped RED.
