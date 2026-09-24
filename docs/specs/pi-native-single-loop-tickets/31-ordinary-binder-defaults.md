Status: ready-for-agent
Stage: SL-31 (P2; extends SL-12/SL-26)
Spec: docs/specs/pi-native-single-loop.md (Ruling: "The ordinary check's difficulty and dice have rules defaults")

# SL-31 — The ordinary binder's rules defaults

## Evidence (long live gate #2, campaign longgate2-haunting-0830)
- Bind rows with `outcome: keeper`, cause `ordinary_unknown`, unresolved "An actor, difficulty or modifier is not bound.", empty bindings, on turns 7, 8, 10, 14, 18: compile-selected ordinary checks (Appearance for Gabriela, Knott; the kitchen search; STR to pry the cupboard twice) all rolled by the Keeper instead.
- The clerk did roll when the binder cleared everything: turns 9, 12, 15 (Spot Hidden 85, Spot Hidden 92, Craft (Carpentry) 55).

## Scope
1. Contract (§135.28 amendment): the ordinary binder's defaults (difficulty regular unless stated; no modifier; the single present investigator), stamped `basis: rule-default` with the rule per parameter; Jev's cleared answers override.
2. Implement in runtime/jev/ordinary-resolve-domain.ts / step-policy.ts settleOrdinaryBind; the bind row records each default; tests, mutation-killable; replays with live Jev on fixtures from long gate #2's turns 14 and 18 (STR to pry): the check executed by the clerk 3/3.

## Comments
