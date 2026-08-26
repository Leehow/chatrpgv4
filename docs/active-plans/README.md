# Active Plans Ledger

This directory holds durable ledgers for multi-turn initiatives. The ledger is
memory and accountability only: it does not authorize code edits, replace
worker handoffs, or weaken validation. The Codex lead owns updates by default.

## Status Terms

`Done`, `In Progress`, `Not Done`, `Partial`, `Blocked`, and `Deferred`.

## Active Plans

| Work ID | Plan | Status | Last Updated | Next Action |
|---|---|---|---:|---|
| pi-coc-tool-affordance-bounded-recovery | [Pi-Coc tool affordance and bounded recovery](pi-coc-tool-affordance-and-bounded-recovery.md) | `In Progress` | 2026-08-25 | Review the three Pi-only implementation lanes, then serially integrate accepted scoped commits and run V0/V1/V2 validation. |
| pi-coc-system-regressions-20260822 | [Pi-Coc system regressions and repository health](pi-coc-system-regressions-and-repository-health.md) | `In Progress` | 2026-08-22 | Authorize the two exact shared language-source files for R3/A9, then finish weapon integration, logical-unit deepening, and real acceptance. |
| pi-coc-adjudication-narration-report-contracts | [Pi-Coc adjudication, narration, and evidence contracts](pi-coc-adjudication-narration-report-contracts.md) | `Implemented` | 2026-08-22 | Complete target-branch integration and the post-merge ZAI GLM acceptance pair. |
| coc-gate-recoverability | [Gate recoverability (开场闸门可恢复性)](coc-gate-recoverability.md) | `In Progress` | 2026-08-06 | 第 0 步全局排查完成([清单](coc-gate-recoverability-step0-scan.md)):canonical 侧 67 处 blocked 无卡、`failed_fields` 零实现、~55 种手工拒绝形状;pi 侧重复契约判断 28、观察黑洞 18、执行前拦截 12。下一步是第 1 步:把不变量写成测试,优先 startup 投影簇(`index.ts:7020-7378`)与 canonical 开场 8 gate。 |
| coc-investigator-sheet-schema-discovery | [Investigator sheet schema discovery](coc-investigator-sheet-schema-discovery.md) | `Partial` | 2026-07-23 | Discoverability vertical is integrated and focused-validated. Executable validator/materializer migration and reusable-investigator ruleset identity remain Deferred until separately approved. |
| ruleset-vertical-green | [Ruleset vertical integration and green baseline](ruleset-vertical-green.md) | `Done` | 2026-07-21 | Public non-CoC vertical, frozen external plugin runtime, canonical evidence, and full-suite zero-red validation complete. |
| coc-tiered-background-orchestration | [Tiered background orchestration and first-contact readiness](coc-tiered-background-orchestration.md) | `In Progress` | 2026-07-21 | Run the window-equivalent three-minute opening and multi-NPC path in a fresh Luna fast-iteration window, then one fresh Terra/Sol quality-confirmation window. Codex coordinator is proven and experimental; Cursor remains fail-closed. |
| coc-bounded-working-set-runtime | [Bounded working-set runtime](coc-bounded-working-set-runtime.md) | `In Progress` | 2026-07-19 | Compact the largest hot-path responses (`combat.*`, item grants, ending settlement), then add NPC presence deltas and authoritative-card projections. |
| coc-on-demand-module-skeleton | [On-demand module skeleton + durable asset store](coc-on-demand-module-skeleton.md) | `Done` (vertical) | 2026-07-18 | Slices 1–8 landed. Host deep-extract for new rooms remains host-side; no daemon worker (inline process-queue). |
| coc-clean-slate-host-evidence | [COC clean-slate persistence and Codex-host evidence](coc-clean-slate-host-evidence.md) | `In Progress` | 2026-07-16 | Finish and review the Codex-host battle-report bridge, then implement the P0 clean-slate boundary. |

## Related design notes (not separate work IDs)

| Plan | Notes |
|---|---|
| [coc-causal-turn-finalization.md](coc-causal-turn-finalization.md) | Prior plan document in this directory |

## Archived

| Work ID | Plan | Closed | Outcome |
|---|---|---:|---|
