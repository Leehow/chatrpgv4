Status: ready (filed 2026-09-24 from long gate #3 and SL-29A; batch 4)
Stage: SL-40 (P3, fiction/rules)
Spec: docs/kernel-rpc.md §135.25 (destination rows), §135.28 (ordinary check defaults), §135.31 (carried views)

# SL-40 — A guard is a pacing condition and the place exists; an ordinary check defaults to a skill the investigator holds

## Evidence
- Long gate #3 t14–t18: the basement's guard (`clue_discovered: corbitt-diaries`) held because the diaries were never opened. The destination row reported the guard and its unlock (as SL-25 requires), and the Keeper rendered the guard as physical absence: "壁橱后头是实墙…没有台阶，也没有往下的口子" three turns running, while the book (the window's own answer at t15) says the basement is reached from the ground floor by a bolted door. The Keeper kept the diaries in view ("三本旧书…你没有翻开它们") but the fiction contradicted the house.
- SL-29A t5: the bridge check rolled Engineering, a skill not on the sheet (base value), when the sheet had usable skills.

## Scope
1. Destination rows (`kernel-ts/read/destination-rows.ts`) and the guarded-exit guidance: a guarded row states that the place and its entrance exist, what the book says about the entrance (from the scene's passages where present), and the unlock; the guidance says the Keeper narrates the entrance as the book has it and what is missing, never the place as absent.
2. Ordinary check defaults (§135.28, the ordinary binder): when the compile names no skill, the default is a skill the investigator holds that fits the act feature; a skill absent from the sheet is chosen only when the declaration names it.
3. Tests, mutation-killable: the guarded destination row's fields; the binder's default on a fixture sheet; no prose assertions.

## Comments
