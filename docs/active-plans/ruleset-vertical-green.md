# Ruleset vertical integration and green baseline

Work ID: `ruleset-vertical-green`
Status: `Done`
Last updated: `2026-07-21`

## Goal

Restore a zero-failure repository baseline and make a minimal non-CoC ruleset selectable and runnable through the public campaign, canonical toolbox/MCP, and headless runtime paths without hand-editing campaign state or adding a parallel engine.

## Decisions

- Preserve `coc7` behavior and the single plugin/toolbox track.
- Prove genericity with one deliberately small non-CoC fixture package and a public vertical path; do not build a speculative second full game system.
- Unknown or missing persisted ruleset bindings fail closed; campaign-less previews may still use the documented default.
- No commit, push, deploy, migration compatibility layer, or destructive git action in this task.

## Items

| Item | Status | Note |
|---|---|---|
| Refresh module/progressive fixtures and clear the 23 related failures | Done | `24 passed`; `.tmp/team-lead/worker-green-baseline-20260721.md` |
| Resolve time-projection expectation and Keeper skill budget | Done | Time projection lane green; `coc-keeper-play` now 309 lines and focused metadata/routing checks pass |
| Public campaign ruleset selection and strict binding validation | Done | Public `ruleset_id`, manifest/schema fail-closed binding, `actor.create`, and external Spark session vertical pass |
| Capability-aware resolver/toolbox vertical with ruleset-bound evidence | Done | `rules.check` and `rules.resource_delta` persist version-bound canonical roll/state evidence through output context and finalization |
| Dynamic ruleset skill/runtime path plus `plugin_root` public-session repair | Done | Generic prompt and public state, explicit runtime project root, frozen external plugin routing, and restore validation pass |
| Lead review, focused verification, and full-suite zero-red validation | Done | Mandatory gates pass; full suite `3303 passed, 0 failed` |

## Validation evidence

- Pre-change baseline: `.tmp/team-lead/worker-failures24-20260721.md` (`25 failed, 3257 passed`).
- Ruleset gap evidence: `.tmp/team-lead/worker-ruleset-path-20260721.md` and `.tmp/team-lead/worker-migration-audit-20260721.md`.
- Baseline fixture/time repair: `.tmp/team-lead/worker-green-baseline-20260721.md` (`24 passed`, metadata `23 passed`).
- Runtime/plugin-root and active skill loading: `.tmp/team-lead/worker-runtime-skills-20260721.md` (`106 passed` + `24 passed`).
- Integrated adversarial review: `.tmp/team-lead/worker-integrated-review-20260721.md` (P0 false resource state; P1 roll/runtime/plugin-root gaps).
- Core revision: `.tmp/team-lead/worker-ruleset-core-revision-20260721.md` (public actor/state/roll/finalization vertical, MCP archive refresh, and opening projection write-boundary repair).
- Runtime revision: `.tmp/team-lead/worker-runtime-skills-revision-20260721.md` (generic prompt/public state, strict active binding, and frozen external-plugin session vertical).
- Final mandatory gates: plugin metadata `23 passed`; offline rulebook audit `1 passed`.
- Final repository suite: `3303 passed, 23 warnings, 0 failed` in 193.88s; warnings are existing legacy runtime-brain deprecations.

## Blockers

- None.

## Next action

Optional human review and commit/publish workflow; this task intentionally did not stage, commit, push, or deploy.
