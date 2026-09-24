Status: ready-for-agent
Stage: SL-26 (P2; extends SL-13)
Spec: docs/specs/pi-native-single-loop.md (Ruling: "The declared ordinary check is the clerk's")

# SL-26 — The compile selects the declared ordinary check

## Evidence (long live gate, campaign longgate-haunting-1010, turns 11–13)
- "先站在楼梯口听一会儿" → Keeper Listen 72; "搜床底、床垫和衣柜" → Keeper Spot Hidden 96 (fumble); "把窗户和地板敲一遍，找暗格" → Keeper Spot Hidden 99, 83, then Dodge 71 / SAN / CON on the flying bed. Six rolls by the Keeper at 3–6 s of review each; the compile answered `decided_none` / `fell_through` because no predicate reads `resolve:core-check:ordinary-check`.
- The ordinary binder (`bind-ordinary`, runtime/jev/ordinary-resolve-domain.ts, step-policy settleOrdinaryBind) already settles skill/intent/modifiers from the declaration when asked.

## Scope
1. Contract first (§135.30 amendment): an `ordinary_check` predicate: when act clears to investigate (or social with an addressee present) and the ordinary binder settles the skill from the declaration, the compile selects the ordinary check; the binder's bind row carries the paths; admission by compile evidence applies (§32.12) when the binder's skill cleared.
2. Implement; tests, mutation-killable; replays with live Jev on fixtures from the long gate's turns 11 and 12 states: the check selected and executed by the clerk, Listen/Spot Hidden as the binder reads them.

## Comments
