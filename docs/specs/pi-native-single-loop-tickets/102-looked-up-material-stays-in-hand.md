Status: ready (filed 2026-09-27 from long gate #24; batch 19; P1 latency: each repeated lookup is a whole Keeper step, ~10 s)
Stage: SL-102 (the source/module material the Keeper looked up stays in its hands while it is still relevant, so the next turn does not look it up again)
Spec: docs/kernel-rpc.md §135.20 (the read hands the Keeper the bodies of what it issued), §22 (reading answers), the capsule assembly (`extensions/kernel/assemble.ts` or wherever the capsule is built), the prescreen (`runtime/jev/…prescreen…`); `lookup`/`look` tool paths in `extensions/kernel/index.ts`

# SL-102: the Keeper re-looks up last turn's material

## Evidence (long gate #24, `longgate24-haunting-2238`, dc37c6b7e, grok-4.5 low)
- 15 lookups; 5 repeat the previous turn's lookup of the same material:
  - `source/answer upper-floor-bedroom` t11 and t12;
  - `source/answer corbitt-diaries` t14 and t15, plus `module "Corbitt Diaries"` t15;
  - `source/answer basement-rites` t17, t18 and a t18 retry.
- Each lookup is a blocking call: the Keeper needs another model step (median 10.6 s) to use the answer.
- The turns over the 60 s target are exactly the multi-lookup turns (t14 61 s, t15 74.5 s).
- The Jev prescreen reported `prepared` on 32 of 32 rounds, yet the Keeper still asked.

## Investigate first
For each repeated lookup, establish from the turn records, capsules and events:
- Did the previous turn's answer reach the next turn's capsule or context? Where was it dropped, or was it never carried?
- Was it carried but in a form the Keeper does not recognise as the answer (a pointer instead of the body, §135.20)?
- Was the source answer still being read, so that `retry` and the answer arrived late?

## Ruling (to confirm from the investigation)
Material the Keeper looked up in this scene stays in its hands while the scene lasts:
- the host carries the landed answer bodies forward, within the capsule's budget, deduplicated;
- they are dropped when the scene changes or the budget says so.

No new tool, no prompt pleading. The host carries it, or the prescreen supplies it before the Keeper asks.

## Scope and tests
- Mutation-killable tests through the real read/lookup path: a lookup's answer in turn N is present in turn N+1's context in the same scene and gone after a scene change; the carry respects the budget.
- Contract addendum near §135.20 (stable ids).

## Acceptance
Long gate #25: repeated lookups of the previous turn's material ≈ 0; Keeper calls per turn and first visible prose reported.

## Comments
