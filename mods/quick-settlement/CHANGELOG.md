# Quick Settlement

## 1.2.0

- `Routine summary for the author` is an author section (contract §254, slot `routine`, sent on `routine`): the host's author-craft resolver sends it, replacing the routine-only route. Requires `instructions.sections.author.v1` instead of `instructions.sections.reference.v1`. Text unchanged.

## 1.1.0

- Adds the situational section `Services beyond routine` (triggered before a cash or item apply): the ordering rule for a non-routine service — supplier and terms first, item gain before consumption, time after delivery, a payment chosen after completion settles last. Enhanced Locations 2.0.0 no longer carries it (contract §250); routine food and drink stay under Spending Level as in 1.0.0.

## 1.0.0

- New optional package (contract §247, owner 2026-10-21). The Keeper triages a chained input: acts that matter are settled as before; routine acts get no per-act item, cash or event receipt and share one time charge; things the player looks at are checked for module relevance and otherwise stay ambient description.
- Requires `turn.routine-summary.v1`: the native packet's `routine` element carries the routine acts and ambient targets to the sole author, with this package's `Routine summary for the author` reference section as its instruction.
