# Rule projection gap fix handoff

- Task: `rule-projection-gap-fix`
- Active track: `pi-coc`
- Opposite Codex-host track: untouched / off-limits
- Worker dimensions: `codex` / `implementer` / `inherit` / `oneshot`
- Branch: `codex/pi-coc-rule-projection-gap-fix-20260831`
- Commit: branch HEAD (scoped commit)

## Confirmed failure class

The canonical rules engine settled `rules.roll_dice` and `rules.opposed`, but
the Pi gateway projected both as `semantic_identity_unavailable`. The canonical
observer did not register their roll ids, and the projection table did not
classify the two opposed-roll fields. Grok therefore retried an already settled
opposed check. The same live run also showed two declaration gaps:
`rules.build_scale.data.comparison.rule_ref` and
`rules.skill_describe.data.selection_policy.id`. Build-scale candidate factors
then repeated the first diagnostic inside `turn.output_context` because embedded
operation results were being classified as outer output-context fields.

## Changes

- Register `rules.roll_dice.data.roll_id` from structured reason/expression
  facts in the existing, sole semantic roll registry.
- Register both `rules.opposed` roll ids from the skill/opponent label and
  explicit roll-role facts.
- Project `investigator_roll_id` and `opponent_roll_id` through the roll domain.
- Classify build-scale's human citation-shaped `rule_ref` as host-only while
  retaining the exact canonical result in `details`.
- Classify the meaning-bearing skill selection-policy `id` as semantic; opaque
  values still fail the closed grammar.
- Project each `turn.output_context.candidate_factors[]` record through its
  embedded `tool` operation's declaration rather than the outer operation.

No rule arithmetic, rule semantics, campaign evidence, Codex-host code, or
global semantic-ID grammar was changed.

## Validation

- `node tests/pi/rule-query-projection.mjs .` — 5/5 passed.
- `PI_TEST_REPO_ROOT=/Users/haoli/leehow/code/chatrpgv4-wt-debug-experiment-20260831 node tests/pi/normal-model-id-boundary.mjs .` — all assertions passed. This includes exact live-shaped roll-dice/opposed envelopes, first-call `ok:true`, distinct semantic handles, one opposed canonical transport, host-only exact ids, and no opaque model content.
- `node tests/pi/semantic-identity-registry.mjs .` — all assertions passed.
- `node tests/pi/typed-tool-surface.mjs .` — 16/16 passed.
- `PI_TEST_REPO_ROOT=... node tests/pi/tool-affordance-extension.mjs .` — 52/52 passed.
- `uv run --frozen python -m pytest tests/test_plugin_metadata.py tests/test_rulebook_data_audit.py -q -p no:cacheprovider` — 34 passed.
- `git diff --check` — passed.

## Integration note

The isolated worktree does not contain embedded Pi dependencies. Tests which
load the real extension therefore used `PI_TEST_REPO_ROOT` only as the existing
test resolver's dependency root; product imports and edited sources came from
this worktree.
