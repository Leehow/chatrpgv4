# Active Plans Ledger

This directory holds durable ledgers for multi-turn initiatives. The ledger is
memory and accountability only: it does not authorize code edits, replace
worker handoffs, or weaken validation. The Codex lead owns updates by default.

## Status Terms

`Done`, `In Progress`, `Not Done`, `Partial`, `Blocked`, and `Deferred`.

## Active Plans

| Work ID | Plan | Status | Last Updated | Next Action |
|---|---|---|---:|---|
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
