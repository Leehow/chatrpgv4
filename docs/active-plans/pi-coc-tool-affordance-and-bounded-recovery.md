# Pi-Coc tool affordance and bounded recovery

Work ID: `pi-coc-tool-affordance-bounded-recovery`
Status: `In Progress`
Last updated: `2026-08-25`

## Goal

Implement the approved Pi-Coc specification so live Keeper turns use a bounded, state-aware tool working set and every failed/hidden recovery either makes canonical progress or terminates within a fixed budget without replaying player input or settled mechanics.

## Decisions

- `ACTIVE_IMPLEMENTATION_TRACK=pi-coc`; Codex-host implementation remains off-limits.
- The approved design source is `docs/specs/pi-coc-tool-affordance-and-bounded-recovery.md`.
- Reuse the canonical registry, operation policy, typed tools, `setActiveTools`, failure envelope, and finalization chain; no second registry, Keeper runtime, or receipt engine.
- Initial implementation is Pi-owned. Shared registry/contract/kernel/skill files remain off-limits until separately authorized.
- Concurrent dirty primary-checkout work must be preserved. Implementation uses task-owned isolated worktrees and scoped commits; target integration into the dirty primary checkout is not authorized by this plan.

## Items

| Item | Status | Note |
|---|---|---|
| Baseline and ownership audit | Done | Current branch/worktrees, dirty overlaps, 130-operation archive, 97 live-turn tools, 29 pending-finalization tools, and 24-failure evidence verified. |
| P0 progress-aware bounded recovery | Accepted | Commit series `6865ce716df280e6061e4b1bb436ed5db74ae1ad`, `2da627e58efdfc7fc283eb1332473b27ff3e38d7`, `9c1d0aaf1304af0567eee30d475196ac46ed1abb`; final independent review found no remaining P1/P2; 15 focused tests passed. |
| Dynamic tool working set | Accepted | Commit series `8d3d22ffc144db641e04d23c72ae71a17f36a1a2`, `cece1f5f111125ee72c83932f2e3990359eb1df3`, `6905aa1cc4415bb6df45e45728c015c26927dba1`; final review found no P1/P2; 27 focused tests passed. |
| Pi argument and failure projection | Accepted | Commit series `dd5dcf9cc7930c52bead257eaf7f35f317d67bcf`, `66a01605d9e3955ef458f40f3bc4a09659397711`, `02e3180de2b8d52d8f804caaa943e6329b8ff827`; final review found no P1/P2; 30+4+31 regressions and canonical combat probes passed. |
| Serial integration and adversarial review | Final Review | Shared wire commit `d8c611dde466330e9d89e72a97782dde42a4e05e` accepted with no P1/P2 and already sits atop integration head `411fc381`; final real wire-to-extension-to-handler review running. |
| Focused deterministic/interface validation | Final Verification | Latest integrated suites were 55/55 and 44/44 plus focused wire/canonical regressions; independent verifier is rerunning the complete deterministic matrix and comparing known baseline failures. |
| Fresh Pi-Coc RPC real-play acceptance | Deferred | Run after deterministic integration is green; requires preserved fresh campaign evidence and natural ending/blocker. |
| Primary-checkout integration | Deferred | Existing overlapping dirty work must first gain a safe integration point; no overwrite/stash/reset. |
| Task-owned worktree closeout | Not Done | Audit and close/retain every lifecycle entry after accepted integration. |

## Acceptance criteria

- Ordinary `play/live_turn` advertises at most 20 tools and `pending_finalization` at most 10 without bypassing role/phase ACL.
- A legal long-tail typed operation becomes callable after at most one provider-neutral discover/load roundtrip.
- Pre-inference steer and empty terminal remain once per player epoch; settled-output hidden follow-up cannot exceed two no-progress attempts.
- Failure fingerprints are player-epoch and canonical-progress aware and ignore host-owned opaque identity churn.
- Budget exhaustion emits the existing typed turn-processing fault, preserves the pending turn, and schedules no further hidden model turn.
- Model-facing schemas remove approved host-owned identity/context fields while the gateway binds and verifies their canonical values.
- Existing exact `turn.finalize.rendered_text` and delivery-ack behavior remains unchanged.
- No Codex-track or unauthorized shared-file changes.

## Execution lanes

| Task ID | Runner / profile | Scope | Status | Handoff |
|---|---|---|---|---|
| `tool-recovery-p0` | Codex / implementer / oneshot | Pi output-gate and nonretry modules + focused tests | Accepted for integration | Through `9c1d0aaf1304af0567eee30d475196ac46ed1abb`; final review `.tmp/team-lead/rereview-tool-recovery-p0.md` |
| `tool-working-set` | Codex / implementer / oneshot | Pi working-set/domain-tool modules + focused tests | Accepted for integration | Through `6905aa1cc4415bb6df45e45728c015c26927dba1`; final review `.tmp/team-lead/rereview-tool-working-set.md` |
| `tool-argument-errors` | Codex / implementer / oneshot | Pi typed argument/failure projection + focused tests | Accepted for integration | Through `02e3180de2b8d52d8f804caaa943e6329b8ff827`; final review `.tmp/team-lead/rereview-tool-argument-errors.md` |

## Validation evidence

- Baseline: `node --experimental-strip-types --test tests/pi/typed-tool-surface.mjs tests/pi/mechanical-output-gate.mjs` -> 16 passed.
- Baseline: `node --experimental-strip-types --test tests/pi/nonretry-circuit.mjs` -> 1 passed.
- Evidence: `.coc/playtests/e2e-0.7.0a-20260825/evidence/retrospective-20260825.json`.
- P0 worker: `PI_TEST_REPO_ROOT=/Users/haoli/leehow/code/chatrpgv4 node --experimental-strip-types --test tests/pi/mechanical-output-gate.mjs tests/pi/nonretry-circuit.mjs tests/pi/bounded-turn-recovery.mjs` -> 3 passed.
- Working-set worker: `node --experimental-strip-types --test tests/pi/tool-working-set.mjs tests/pi/typed-tool-surface.mjs tests/pi/domain-tools-acl.mjs` -> 24 passed.
- Argument/error worker: new projection tests 8/8; existing typed surface 15/15; MCP error surface passed; operation contract loader 4/4; plugin metadata 31/31.
- Independent reviews and integrated validation: pending.

## Blockers

- `plugins/coc-keeper/pi/extensions/index.ts` and `web/server-node/pi-coc-rpc.mjs` contain pre-existing overlapping dirty work. Workers must not absorb it; clean feature-branch integration can proceed, but primary-checkout integration remains deferred.
- Shared archive/kernel changes are not authorized. Any lane that proves they are required must stop and name the exact file and reason.
- Shared-file authorization granted and scoped implementation complete in `d8c611dde466330e9d89e72a97782dde42a4e05e`: only `plugins/coc-keeper/scripts/coc_mcp_wire.py` and `tests/test_plugin_mcp.py` changed. Review/integration still pending.

## Next action

Finish the real wire-to-extension-to-handler review and independent deterministic verification on `d8c611dde466330e9d89e72a97782dde42a4e05e`; then decide primary-checkout integration, run/plan fresh RPC acceptance, and close out task-owned worktrees against the accepted integration ref.
