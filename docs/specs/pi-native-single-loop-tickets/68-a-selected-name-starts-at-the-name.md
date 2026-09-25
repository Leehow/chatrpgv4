Status: ready (filed 2026-09-25 from the 血色公路 batch-11 table; batch 11)
Stage: SL-68 (P3, character creation; follows SL-66)
Spec: docs/kernel-rpc.md §98 (selection ranges; SL-66's addendum 7)

# SL-68 — A selected name starts at the name: a leading verb or particle in the range is not part of it

## Evidence (ticket 29 batch-11 entry)
- SL-66 stopped the trailing comma, but the stored name became `叫雷·卡特`: the selected range began one grapheme early on the verb 叫 ("called"), which is not punctuation, so the word-boundary trim kept it. The range itself, chosen by the setup lane from the player's sentence, is the fault.

## Scope
1. Contract: §98 addendum: the name is the name the player gave; the setup lane's selection is checked by a per-row Jev question when the range's first or last token is not part of any candidate name form (structural: ask, never a list of verbs), and the card records the trimmed range.
2. `runtime/jev/setup-input-references.ts` / the setup lane: the range check; tests, mutation-killable, with the b11 setup fixture yielding `雷·卡特`; a range that starts on the name is unchanged.

## Comments
