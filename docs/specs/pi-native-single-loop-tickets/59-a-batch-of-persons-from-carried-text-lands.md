Status: ready (filed 2026-09-25 from the 血色公路 batch-8 table; batch 9)
Stage: SL-59 (P2, admission / entities; follows SL-51 and SL-56)
Spec: docs/kernel-rpc.md §11.5.4 (SL-51), §22.4.7.1 (SL-56), §32.12.3 (line-level admission)

# SL-59 — A batch `apply` placing several persons the carried text names lands, each one as SL-51 lands one

## Evidence (ticket 29 batch-8 entry)
- One `apply` placing three book-named NPCs at once, when the carried `scene_text` note named all three verbatim, was refused hard in 22 ms (`retryable: false`) with no landing; SL-51's `_passage` marking and provisional registration cover a single `npc`/`person` write, not a batch, and the batch's refusal is whole.

## Scope
1. Contract: §11.5.4 addendum: the passage check runs per effect in a batch; each person named in the carried text lands provisionally; a person named nowhere refuses only its own line (line-level, §32.12.3).
2. Host (`extensions/kernel/index.ts`, the `_passage` marking) and kernel (`kernel-ts/apply/entities.ts`): per-effect marking and per-line refusal.
3. Tests, mutation-killable: a batch of three named persons lands three provisional entries; a batch with one unnamed person lands two and refuses one line with `unknown_entity`; the replay of the b8 table's placement turn.

## Comments
