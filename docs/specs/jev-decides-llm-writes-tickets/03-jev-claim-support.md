Status: ready-for-agent
Spec: docs/specs/jev-decides-llm-writes.md D-B B4 · Contract §150.3, §150.3.1
Load the `typesafe-jev` skill first.

# 03 — Jev claim-support check before the vision reviewer

Scope:
1. Family `source-claim-support` v1 (eligibility by structure only; supported/contradicted Nouls per claim, one fanned-out request per candidate; gates as data).
2. Modes `shadow` (shipped default) / `on` / `off`, env over data; `on` removes cleared paths from vision units and writes `reviewer:"jev"` rows; Jev never refuses; outage = off.
3. Kernel publication gate accepts `reviewer:"jev"` rows only under §150.3's conditions.
4. Offline calibration tool over retained verdicts (claim, cited page native text, vision verdict) with a grid over (S, C); run it live on the Mac against this checkout's retained corpus; write the numbers and the bar outcome into this ticket; flip the data default to `on` only if §150.3.1's bar is met.
5. Inventory entry.

Tests: eligibility excludes coverage, image/map paths and pages without native text; shadow changes no review outcome; on skips vision for cleared paths only and a unit left empty is not run; an uncleared or contradicted claim still goes to vision; the gate refuses a jev row on an ineligible path, a mismatched page-text digest, or a path a vision row refused.

## Comments
