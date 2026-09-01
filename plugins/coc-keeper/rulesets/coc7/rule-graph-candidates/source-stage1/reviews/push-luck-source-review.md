# Push/Luck independent source review

- Reviewer: `codex-rule-families-core-social-source-review-20260831:push-luck`
- Executable decision re-review: `codex-execgraph-core-push-social-review-20260831:push-luck-v2`
- Exact source: *Call of Cthulhu Keeper Rulebook 40th Anniversary*
- PDF SHA-256: `a860499cf34b40cac385f51b6e667ab37ec0796c7329494def08c8b161fd71eb`
- Reviewed PDF indexes: 95, 96, 97, 100, 101, 110
- Verdict: **ACCEPT** for source coverage of the `push-luck` family; runtime ownership and production promotion are not granted by this review.

The review checked every accepted node and relation against the rendered pages and the independently normalized page text. The accepted family covers:

- one changed-method push after an ordinary failed skill or characteristic roll;
- achievable goal, elapsed time, normally stable skill/difficulty, and Keeper-foreshadowed failure consequence;
- non-pushable Luck, Sanity, combat, damage, and Sanity-loss amount rolls;
- immediate/final fumbles and one-push-only behavior;
- Luck rolls, lowest-member group Luck, one-for-one Luck spend, current-Luck limit, own-roll restriction, Push-or-Luck exclusivity, and the prohibited roll/result classes;
- no improvement tick after Luck adjustment;
- optional end-of-session Luck recovery, cap 99, and no reset to starting Luck.

No derivative-only rule is treated as source authority. The prior `fumble-push-uncompiled` marker is replaced by the source-backed final-fumble prohibition because the current resolver already rejects fumbled originals. The canonical `accept()` and `build()` receipts are stored beside the accepted family artifacts.

Executable re-review confirms that Push and Luck spend do not rely on a process-local settlement cache. Both decisions lock a canonical persisted roll receipt plus a machine-issued continuation grant bound to that receipt and actor. Hard receipt outcome/pushed-state conditions gate applicability; the graph names the existing `push_policy`, `check`, and `luck_spend` resolver paths rather than copying their algorithms.

Gap re-review `codex-execgraph-gap-review-20260831:push-luck-v3` confirms the standalone Luck-roll decision now has its required `invokes -> capability:coc7:check` edge, and the source Luck-roll rule carries the same capability evidence. Every Push/Luck decision therefore resolves to exactly one executable capability.
