Status: ready (filed 2026-09-24 from long gates #3–#5; batch 6)
Stage: SL-50 (P2, delivery; the largest remaining wall on the starter)
Spec: docs/kernel-rpc.md §34.16, §135.11 (turn close), the `text_beside_tool_calls` drop

# SL-50 — Prose beside settled bookkeeping is the draft; it is dropped only beside a roll or a refused or pending call

## Evidence (`keeper-steps-gates3-5.txt`, `text-beside-drops.txt` in the session scratchpad; campaigns `longgate3-haunting-1058`, `longgate4-haunting-1308`, `longgate5-haunting-1447`)
- Model steps per turn: 53 / 65 / 60 over 20 turns; turns with ≥ 3 steps: 9 / 14 / 11. The most frequent reason for an extra step is the `text_beside_tool_calls` drop: 13 / 19 / 14 per table, several turns twice. Each dropped draft costs a re-compose of 10–18 s plus a lane review.
- Of 46 drops, 36 sat on steps with no look; on most of those the turn's admissions were all `authorized`/`entailed` (gate #5: t3, t5, t8, t12, t13, t19, t20; gate #4: t3, t8, t13, t19): prose beside settled bookkeeping, dropped anyway. The drop row records the dropped text but no step id, so exact pairing is the ticket's first step.

## Ruling (owner, 2026-09-24)
Prose beside tool calls is the turn's draft when every call in that step is an `apply` the host admitted (nothing the prose could pre-empt); it is dropped, with today's steer, only when the step carries a `resolve` (a roll the prose may have assumed) or a call that was refused or is pending. Structural: call kinds and verdicts, never wording.

## Scope
1. Measure first: pair each drop with its step (the `dropped` text against the step's messages) across the three campaigns and report how many were apply-only-admitted.
2. Contract: §34.16/§135.11 amendment (new subsection) with the rule; the drop row gains `step` and the step's call kinds/verdicts.
3. `extensions/kernel/index.ts` (the drop) and the hybrid engine's turn close: keep the draft in the apply-only-admitted case; deliver it as the turn's prose if no later step replaces it.
4. Tests, mutation-killable: prose beside an admitted apply is kept and delivered; beside a resolve it is dropped with the steer; beside a refused apply it is dropped; then the replay of gate #5's t3 (7 steps) reporting steps and wall.

## Comments
