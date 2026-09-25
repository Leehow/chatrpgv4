Status: ready (filed 2026-09-25 from the 血色公路 batch-10 table; batch 10)
Stage: SL-66 (P3, character creation)
Spec: docs/kernel-rpc.md §98 (the card as a patchable document; name selection ranges)

# SL-66 — A name selected from the player's sentence stops at the word, never at the punctuation after it

## Evidence (ticket 29 batch-10 entry: setup turn 4)
- `create-investigator`'s `profile.name` was selected as `input:4:3/u:30`–`u:34` against the player's sentence, and the range's last grapheme was the sentence's trailing comma: the investigator became `雷·卡特，`, echoed into the prose on turns 3, 9 and 10.

## Scope
1. Contract: §98 addendum: a selected name range excludes trailing (and leading) punctuation and whitespace; the kernel trims the selection to the word boundary when it stamps the card, and records the trimmed range.
2. Kernel (`kernel-ts` character creation, the selection → value step): trim by Unicode punctuation/space category (a category check, not a list of characters).
3. Tests, mutation-killable: a range ending on a comma or full stop yields the bare name; a range ending on a letter is unchanged; the b10 setup turn-4 fixture yields `雷·卡特`.

## Comments
