# Quick Settlement

## 1.0.0

- New optional package (contract §247, owner 2026-10-21). The Keeper triages a chained input: acts that matter are settled as before; routine acts get no per-act item, cash or event receipt and share one time charge; things the player looks at are checked for module relevance and otherwise stay ambient description.
- Requires `turn.routine-summary.v1`: the native packet's `routine` element carries the routine acts and ambient targets to the sole author, with this package's `Routine summary for the author` reference section as its instruction.
