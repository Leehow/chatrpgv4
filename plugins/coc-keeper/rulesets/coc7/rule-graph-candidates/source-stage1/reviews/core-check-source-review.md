# Core-check independent source review

- Reviewer: `codex-rule-families-core-social-source-review-20260831:core-check`
- Exact source: *Call of Cthulhu Keeper Rulebook 40th Anniversary*
- PDF SHA-256: `a860499cf34b40cac385f51b6e667ab37ec0796c7329494def08c8b161fd71eb`
- Reviewed PDF indexes: 93, 94, 97, 99, 100, 101, 102, 103, 104
- Verdict: **ACCEPT** for source coverage of the `core-check` family after correcting the two derivative/runtime mismatches below. This review does not grant production promotion.

The accepted family covers when to roll, goal selection, Regular/Hard/Extreme difficulty, percentile outcomes, critical/fumble thresholds, bonus/penalty dice, non-combat opposed rolls, one-investigator combined skill rolls, multi-investigator separate/situation-specific procedures, and physical human limits.

Two pre-review claims were rejected and corrected rather than accepted:

1. Printed p.92 does not grant generic helper bonus dice for combined skill rolls. The runtime `helper_count` surface and the derivative `combat.json.teamwork` claim were removed. Multi-investigator help remains on the source's separate-roll and situation-specific paths.
2. Printed p.92 requires the Keeper to choose whether **any** or **all** named skills must succeed. The runtime now requires and freezes `combined_mode: any|all` for combined checks and rejects it for ordinary checks.

Every node/relation in the accepted artifacts binds the rendered page evidence. No fixture-only or derivative-only semantics are source authority. Canonical `accept()` and `build()` receipts are stored beside the family graph.
