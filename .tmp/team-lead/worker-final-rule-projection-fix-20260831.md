# Final rule projection fix handoff

- Task: `final-rule-projection-fix`
- Active track: `pi-coc`
- Opposite Codex-host track: untouched / off-limits
- Worker dimensions: `codex` / `implementer` / `inherit` / `oneshot`
- Branch: `codex/pi-coc-final-rule-projection-fix-20260831`
- Commit: branch HEAD

## Changes

- Declared `rules.roll.rule_ref` operation-local semantic output so
  `combined_roll.rule_ref` and
  `player_projection.combined_roll.rule_ref` retain `core.combined_roll`.
- Declared `sanity.execute.source_command_id` operation-local host-only
  executor evidence so a successful bout tick stays model-visible without
  exposing internal command identity.

No global identity grammar, rule semantics, arithmetic, or bindings changed.

## Validation

- Combined-roll projection: 2/2 passed, including opaque rule-ref rejection.
- SAN projection: 2/2 passed, including nested tick source-command removal.
- Normal model ID boundary: all assertions passed.
- Typed tool surface: 17/17 passed.
- Plugin metadata + rulebook audit: 34 passed.
- `git diff --check`: passed.
