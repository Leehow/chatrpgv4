# Pi-Coc adjudication, narration, and evidence contracts

Work ID: `pi-coc-adjudication-narration-report-contracts`
Status: `Done`
Last updated: `2026-08-22`

## Goal

Implement the approved Pi-Coc specification so settled actions cannot reroll
on narration retry, social and concealed-Psychology decisions are source-bound,
scene drift and player-control violations are auditable, and player/audit
reports agree on exact run evidence. Validate with two fresh independent
Pi-Coc RPC sessions pinned to the configured ZAI GLM route.

## Decisions

- `ACTIVE_IMPLEMENTATION_TRACK=pi-coc`; Codex-host implementation remains off-limits.
- The approved specification is
  `docs/specs/pi-coc-adjudication-narration-report-contracts.md`.
- Shared kernel/contract edits required by that specification are authorized;
  unrelated shared changes are not.
- Reuse and deepen `state.journal` → `turn.output_context` → `turn.finalize`;
  do not create a second turn engine or monolithic event store.
- Both real acceptance sessions use an explicitly verified ZAI GLM route, per
  the user's current-turn override of the prior Grok default.
- Preserve every prior and new playtest campaign, transcript, log, and report.

## Items

| Item | Status | Note |
|---|---|---|
| Baseline and dirty-ownership audit | Done | Implementation and integration used isolated worktrees; primary dirty work was not absorbed. |
| Characterization tests and run identity | Done | `MISSING` run identity now prevents a complete report classification. |
| Social and concealed-Psychology contracts | Done | Stable goal/window identity, provenance, ceilings, and no-reroll behavior are enforced. |
| Scene governance and improvised-fact evidence | Done | Runtime remains advisory; provenance and silent scope drift are auditable. |
| Narration revision and player-control ownership | Done | Accepted revisions reuse frozen settlement and Pi-play agency review is source-bound. |
| Player report and Keeper audit projection | Done | The canonical exporter emits separate player-safe and audit artifacts. |
| Deterministic/adversarial validation | Done | Focused Python, Pi Node, Web RPC, and plugin metadata suites executed after integration. |
| ZAI GLM fresh session A | Done | Preserved under the implementation worktree artifacts with explicit ZAI route evidence. |
| ZAI GLM fresh session B | Done | Preserved under the implementation worktree artifacts with an independent session id. |
| Lifecycle closeout | Done | Target branch `0.6.1a` points at `4cd379e9`; task-owned integration worktree closed with final `audit_ok`. |

## Validation evidence

- Specification SHA-256 at approval:
  `e36b262055c3c8cbd41b1014cb4cdd1d7c68ba9206aa229bf840522559ebae2f`.
- Integrated feature branch through a conflict-free three-way merge from
  `fa85db27` and repaired five feature regressions found by baseline differential testing.
- Pi typed-contract tests: 22 passed.
- Web server Node tests: 364 passed.
- The focused Python contract matrix passes after excluding failures reproduced
  unchanged on the pre-feature `fa85db27` baseline; those failures remain owned
  by the concurrent primary-worktree repair lane.

## Blockers

- None for this completed work item. The unrelated primary-checkout changes
  remain preserved on `codex/preserve-primary-dirty-20260822`.

## Next action

No implementation action remains. A later release candidate may run a complete
Pi-Coc RPC campaign to terminal evidence; the two preserved post-merge GLM
sessions are contract smoke evidence, not a completed-campaign acceptance.
