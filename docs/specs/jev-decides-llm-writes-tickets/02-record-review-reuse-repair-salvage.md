Status: ready-for-agent
Spec: docs/specs/jev-decides-llm-writes.md D-B B1–B3, B6 · Contract §150.2

# 02 — Review reuse per unit, targeted repair, salvage of an interrupted author

Measured waste (Blood05): 3/29 refused claims cost a 156 s re-author plus a full re-review; pages 15–16 were authored four times in one campaign after interruptions.

Scope:
1. Unit-level review cache identity (§150.2.1); `/coverage` stays whole-candidate.
2. Targeted repair round (§150.2.2) with the host's byte-identity check and full-round fallback.
3. Salvage on resume (§150.2.3).
4. Accounting fields on reading rows (§150.2.4).

Tests at the reading-service job runner (fake runtime) and reviewer (fake `run`) seams: an edit to one record re-runs only its unit(s) and `/coverage`; a refusal without `missing` produces a repair brief listing only refused paths and a re-review that reuses the unchanged units; a repair that alters an unrefused record is refused and falls back; a review with `missing` runs the full round; an interrupted attempt with a checker-passing draft and all required pages delivered skips the author; one missing delivered page does not. Each case must fail under a mutation of its fix.

## Comments
