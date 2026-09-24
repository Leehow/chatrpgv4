Status: ready-for-agent
Stage: SL-25 (P1; extends SL-13)
Spec: docs/specs/pi-native-single-loop.md (Ruling: "A place the kernel offers must be recognisable from what the player says")

# SL-25 — Destination rows the player can recognise, guarded exits the Keeper can see

## Evidence (long live gate, campaign longgate-haunting-1010)
- Destination rows carry `display_name` placeholders from the starter: "scene previous tenants", "scene upper floor bedroom", "scene basement rites" (content/starters/the-haunting scene nodes). The player said 罗克斯伯里疗养院 (turn 6/7 → `none` 0.99/0.74), 上二楼…主卧 (turn 11 → `none` 0.54), 下地下室 (turn 16 → basement-rites 0.96 cleared but `decided_none`).
- Turn 9 (去科比特宅) and turn 16: the destination cleared but no move candidate was offered (guarded exits, `unlock_when` unmet), so the compile decided none and the Keeper either moved itself (turn 9, lane 4 s) or narrated "no stairs" for four turns (15–18) without knowing what the book says unlocks the basement.
- Compile rows: `lane: route, purpose: compile` for each turn; the candidate builder's guard handling in runtime/jev/candidates.ts (~line 278).

## Scope
1. Contract first (§135.30 amendment, §135.2 rows): a destination row = the scene's authored label in the play language when present, else its name; its summary/where-words; the people and things the kernel knows there. A cleared destination whose move is guarded is reported on the compile row (`guarded: {to, guard}`) and in the clerk projection to the Keeper with the guard's own words (the clue/condition the book names), never the handle alone.
2. Content: author labels (en and zh-Hans) for the haunting starter's scenes whose display_name is a placeholder (module-graph / starter files; check the campaign compile snapshot rule: a new campaign is needed to see them).
3. Implement; tests, mutation-killable; replays with live Jev on fixtures built from the long gate's turns 6, 11 and 16 states (read-only campaign): the destination clears to the right row; the guarded case reports the guard.

## Comments
