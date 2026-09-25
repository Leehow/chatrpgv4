Status: ready-for-human (fixed 2026-09-25, branch claude/sl65-20260925)
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

### 2026-09-25 (worker, branch `claude/sl65-20260925`)

**Contract note.** The real rule this bug lives under is T14 ("setup user-input source selection"), which
previously stated ranges resolve "without trimming… byte-exact" for every field. That rule is correct and stays
for `pending_action` and for every whole-field `profile.name` copy — a player's exact wording, leading/trailing
whitespace included, is the point of that path, and an existing test
(`whole fields and grapheme endpoint selections preserve CRLF, emoji and combining marks exactly`) locks it in with
leading spaces and a trailing `\r\n`. This ticket's fix is a narrow, explicit exception to T14, carved out and
cross-referenced from both directions (T14 → §98 addendum 7, and vice versa), rather than a blanket "always trim"
change — that would have silently broken the byte-exact contract for whole-field copies and `pending_action`.

**Fix.** `runtime/jev/setup-input-references.ts`'s `selected()` gains `options.trimToWord`; when a `profile.name`
selection carries an explicit `range` (never a whole-field selection), leading and trailing grapheme units that are
wholly Unicode category P (punctuation) or Z (separator/space) — a category test,
`/^[\p{P}\p{Z}]$/u` per code point, never a character list — are dropped from each end before `issueSourceRef` is
called, so the *recorded* ref is already the trimmed range; nothing downstream re-trims. `materializeSetupInputs`
passes `trimToWord: key === 'profile.name'`. Full text: docs/kernel-rpc.md §98 addendum 7 (and the two amended
sentences in the T14 section it cross-references).

**Tests, mutation-killed.** `tests/extension/jev-setup-input-references.test.mjs`: the exact b10 fixture sentence
and its `u:30`-`u:34`-shaped range (found programmatically by content, not hardcoded indices) yields `雷·卡特`; a
range ending on a letter (`nameEnd`, no trailing punctuation) is unchanged and lands on the identical ref as the
trimmed one; leading punctuation/space is trimmed too (`'  ，雷·卡特，'` → `'雷·卡特'`); a range that is wholly
punctuation/space is left exactly as selected, not emptied or crashed; a whole-field `profile.name` selection and
every `pending_action` selection keep T14's byte-exact contract unamended. Two mutations applied by copy-revert
(never `git checkout --`), each re-run locally (`node --test`) and then restored (`diff` confirmed identical):
(1) disabling `trimToWord` entirely — killed (`'雷·卡特，' !== '雷·卡特'`); (2) disabling only the leading-trim loop —
killed (`'  ，雷·卡特' !== '雷·卡特'`).

**Suites (leehow-pc).** `on leehow-pc @ 4ec88b7269ddb6fd8442afc2d8d0820241cbe629`: `ext` — 3169 pass, 0 fail
(`wall=177s`), includes this file's new/changed cases. `py` — 1730 passed, 2 skipped (unrelated fix needed for
SL-67, see that ticket). `loop` — 196/196 clean on the clean re-run (one unrelated pre-existing flake on the first
run, `single-loop-turn-budget.test.mjs`, nothing this ticket touches).
