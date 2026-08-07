# Active Plans Ledger

This directory holds durable ledgers for multi-turn initiatives. The ledger is
memory and accountability only: it does not authorize code edits, replace
worker handoffs, or weaken validation. The Codex lead owns updates by default.

## Status Terms

`Done`, `In Progress`, `Not Done`, `Partial`, `Blocked`, and `Deferred`.

## Active Plans

| Work ID | Plan | Status | Last Updated | Next Action |
|---|---|---|---:|---|
| coc-gate-recoverability | [Gate recoverability (开场闸门可恢复性)](coc-gate-recoverability.md) | `In Progress` | 2026-08-06 | 6 个卡点已修 5 个并在 `vfy2` 实测跑通开场+掷骰;第 6 个(era 在读模组前被定死)未修。下一步是第 0 步全局排查:扫出所有 `blocked + next_operation: null` 与不带字段名的拒绝点,先量化还剩几堵墙。 |
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
