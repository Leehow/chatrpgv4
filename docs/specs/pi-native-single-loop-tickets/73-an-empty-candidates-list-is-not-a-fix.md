Status: ready (filed 2026-09-26 from long gate #12's telemetry; batch 12)
Stage: SL-73 (P3, kernel `unknown_entity` on a person; the fix text points at an empty list)
Spec: docs/kernel-rpc.md §11.5.6/§11.5.7 (name resolution, candidates), `kernel-ts/read/module-graph.ts:374` (`no ${what} named … in the module graph`, `fix: "pick a name from details.candidates or look first"`), §8 (an error's `fix` is executed literally: memory `error-fix-text-is-executed-literally`)

# SL-73 — `unknown_entity` on a person with `candidates: []` tells the Keeper to pick from nothing; the investigator's own name is refused as "no npc"

## Evidence (long gate #12 `longgate12-haunting-2016`, campaign telemetry + run events)
- t14 `apply npc name:"turn 10-11 已交付"`, t17 ×2 `apply npc name:"地下室木板"` (the basement boards, an object), t19 `apply npc name:"托马斯·海斯"` (the investigator himself): all four answered `unknown_entity … fix: pick a name from details.candidates or look first, candidates: []`. The Keeper did what the fix said: retried (t17 twice, 6.6 s + 9 ms), then looked, then narrated. Nothing told it *what* the name was (an object, the PC, not a person at all), so the same class repeats on the next table.
- t10 `apply map regions:["corbitt-house-ground"]` refused `no map region` with the level list as candidates: correct and self-explanatory; not in scope.

## Ruling (filed for the owner; the shape follows §8 and §11.5.7)
1. When the ranked candidates are empty, the error does not say "pick from details.candidates". It names what the query *is* when the kernel can tell: an investigator at the table (`details.is_investigator: true`, `fix` says the investigator's sheet is written with the investigator subject, not an npc effect); an object/clue/scene the graph knows (`details.matched_kind`, `fix` names the effect that takes that kind); else `fix` says the person is not in the graph or the roster and the effect must establish them (`from_passage`, §11.5.7) or `look npc` first. A `candidates` list is present only when it has members.
2. No hard-coded name/kind lists: the kind comes from the graph's own node kinds and the party's sheets.

## Scope
- `kernel-ts/read/module-graph.ts` resolve/candidates error shaping (a helper the person path and the npc effect path share), `kernel-ts/apply/entities.ts` `personOfEffect` refusal; contract §11.5.7 addendum with the three shapes; tests in `tests/extension/ts-kernel-name-phrase.test.mjs` / `passage-person.test.mjs`: the investigator's name → `is_investigator` and the sheet fix; an object's name → `matched_kind`; an unknown name with no similar person → no `candidates` key and the establish/look fix; a name with similar people → candidates as today (mutation: revert the helper, the old empty-list fix comes back).

## Comments
