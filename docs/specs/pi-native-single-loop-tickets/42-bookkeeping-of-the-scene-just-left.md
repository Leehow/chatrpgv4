Status: ready (filed 2026-09-24 from SL-38's replay; batch 4, blocks the next long gate)
Stage: SL-42 (P1, admission/kernel; follows SL-38)
Spec: docs/kernel-rpc.md §135.30.5 (SL-38), §32.12.3, the `not_here` refusal (apply clue/handout/item locality), scene trail

# SL-42 — The Keeper's bookkeeping for the scene the party left this turn is accepted at that scene

## Evidence (SL-38 replay of long gate #3 t1, `experiments/single-loop-routing/results/sl38-longgate3-t1-after`)
- With SL-38 the compile selects the research-leads clue then the move to the Globe, both admitted at 0 ms, before the Keeper's first step. The recorded Keeper's first batch (the keys clue `knott-keys`, the $20, the key item, the commission handout) was then refused `not_here` in 3 of 3 runs: the party was already at the morgue and the kernel refuses a clue located in a scene the party has left. In the before arm the whole accept landed. The keys clue unlocks the house (t9): losing it breaks the table later.
- Not new with SL-38: any clerk-selected move runs before the Keeper's first step; this is the first turn where one sentence carried both the bookkeeping and the move.

## Ruling (owner, 2026-09-24)
Within one turn, an effect located in a scene the party left during that turn is accepted and recorded at that scene (the scene trail knows the departure); `not_here` keeps refusing effects located anywhere else. The clerk's move is not delayed for the Keeper.

## Scope
1. Contract first: the locality rule for `apply clue/handout/item/cash` (wherever `not_here` is specified) gains the same-turn departed-scene case; the receipt carries `at: <that scene>`; §135.30.5 cross-reference.
2. Kernel: the `not_here` check consults the turn's scene trail; nothing else about locality changes.
3. Tests, mutation-killable, on the emitted Haunting kernel: the gate #3 t1 sentence (SL-38's fixture) lands the leads clue, the move, then the keys clue, cash, key item and handout, all with receipts; a clue located in a scene the party did not visit this turn is still refused `not_here`; the replay of t1 shows the keys clue landed.

## Comments
