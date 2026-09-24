Status: ready-for-agent
Stage: SL-27 (P2; extends SL-15)
Spec: docs/specs/pi-native-single-loop.md (Ruling: "The Keeper is shown what the run has read")

# SL-27 — Looks on a first visit: carry the scene's source passages; resolve clue labels

## Evidence (long live gate, campaign longgate-haunting-1010)
- 18 look/lookup/recall calls in 20 turns (turns 1, 6, 10, 11, 15, 16, 19, 20), each a model round; kinds: `source` (book passages, 6), `module` (scene/handle queries, 5), `rule` (1), `adaptation` (3), `look scene` (3), `look object "Corbitt Diaries"` (unknown_entity: the clue is `corbitt-diaries`).
- The prescreen already locates source passages for the scene (read rows: `located` cards) and SL-15 carries scene/person/session views but not source text.

## Scope
1. Measure: for each look on the table, was its answer already in the prescreen's materials or the carried section (byte overlap)? Pre-register.
2. Contract (§135.31 amendment): on a scene's first visit in a run the carried section includes the scene's located source passages (from the prescreen, under the carried ceilings); `look object/name` resolves clue and handout labels the kernel knows (by label in either language) before answering unknown_entity.
3. Implement; tests, mutation-killable; replay the long gate's turn 10 and 19 states with the recorded Keeper and report looks before/after.

## Comments
