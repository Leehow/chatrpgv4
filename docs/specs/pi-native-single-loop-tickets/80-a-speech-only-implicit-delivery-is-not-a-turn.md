Status: ready-for-human (filed 2026-09-26 from long gate #13; batch 13; implemented 2026-09-26)
Stage: SL-80 (P2, host delivery; the implicit narrate's floor)
Spec: docs/kernel-rpc.md §135.11 (the implicit narrate is delivery evidence), §34.13/§34.14 (markers, rendered delivery), the turn floor (§ "floor" steers in `extensions/kernel/index.ts` ~4647/5399), §40 (speech markers)

# SL-80 — A delivery that is one `{{say}}` block and nothing else closed the turn: the floor must apply to the implicit narrate

## Evidence (long gate #13 `longgate13-haunting-0400`, campaign turns/0001.json)
- t1 (accept the commission, go to the Globe's morgue): the clerk settled the commission and the move; the Keeper's reply was 66 chars: `{{say:阿蒂·威尔莫特}}“钥匙拍在桌上也没用，先生。剪报室不对外……”{{/say}}`; `closed_how: implicit narrate`, rendered 41 chars. No scene, no arrival, no Knott, no morgue — one line of a gatekeeper the player has not yet met, delivered as the whole turn in 36.8 s.
- Gates #11/#12 t1 (same script, explicit narrate): 744 / 476 chars of prose. Over three tables this is the only delivery under 80 chars of prose, and it is the one that took the implicit path.

## Ruling (filed for the owner; follows the turn-floor ruling of 2026-09-11 and §135.11)
The floor that the explicit narrate and the floor/speech steers enforce applies to the implicit narrate too: a reply whose rendered text is speech markers only (no prose outside `{{say}}`) is not a delivery; it takes the same one-steer path as a thin explicit narrate (the steer names what the clerk did this turn, which the prose must carry), and only after the steer is spent does the held draft close the turn. Structural check (marker-stripped prose length / presence), no reading of the words.

## Scope
- `extensions/kernel/index.ts` implicit-narrate acceptance (~5480–5560) gated by the same floor predicate as the explicit path; contract §135.11 addendum.
- Tests (mutation-killable): a speech-only implicit reply is steered once and not delivered; the second leg with prose delivers; an explicit narrate is unchanged; a reply with prose beside the say block delivers on the first leg.

## Comments

**2026-09-26, implemented.** Contract addendum written before code: `docs/kernel-rpc.md` §135.11.4 (commit
`fa22d9e6`). Implementation and tests on `claude/sl80-20260926`, worktree `chatrpgv4-wt-sl80`:

- `fa22d9e6` spec(kernel-rpc): §135.11.4 -- a speech-only implicit reply is not a delivery (SL-80)
- `32cbf573` feat(kernel): SL-80 -- the floor also fires on a say-only implicit draft
- `50867971` test(kernel): SL-80 -- mutation-killable coverage for the say-only floor

**What landed.** `extensions/kernel/unwrapped-speech.ts` gains `isSpeechOnlyDraft(draft)`: runs the draft
through the same `speechPass` repair (§40.1) the delivery and the speech steer already use, removes every
repaired say span whole (open token, words, close token) and every mechanics marker, and reports whether
anything but blank survives. A draft with no say span at all answers `false` (that is the existing
bare-of-tokens speech steer's shape, not this one's). `extensions/kernel/index.ts`'s floor check
(`message_end`, the `floor_steer` drop) now fires on `state.toolCallsThisTurn === 0 || speechOnly`, not just
the first: same `floorDraft`/`deliveryFix`/`steeredThisTurn` machinery, same `FLOOR_STEER` text, same
telemetry lane (`lane: "floor"`, now carrying `reason: "speech_only"` when that is why it fired), so the
existing one-steer-per-turn budget, the opening's exemption and the dropped-draft fallback of §135.11's gate
#4 addendum all apply unchanged. This is not a second floor. Explicit `narrate` is untouched: the check lives
entirely inside the `rendered === undefined` branch that only runs when no explicit `narrate`/`ask` closed
the leg.

**Tests.** `tests/extension/unwrapped-speech.test.mjs`: `isSpeechOnlyDraft` against the long gate #13 t1
evidence line itself, a lone span, whitespace or a marker beside it (still speech-only), any other character
beside it (not speech-only), no span at all, and the unclosed-open / emptied-span repair paths (§40.1's own
repairs, read through the same function). `tests/extension/single-loop-turn-close.test.mjs`, four new cases
against the hybrid engine and the fake kernel: a turn whose clerk already settled a check (`toolCallsThisTurn`
> 0) and whose Keeper's whole reply is one say span is floor-steered once, not delivered, with
`lane: "floor", reason: "speech_only"` on the telemetry row; a second leg with prose then delivers; a second
leg that brings nothing delivers the held say-only draft (the dropped-draft rule); a reply with prose beside
the say span is not speech-only and delivers on its first leg; an explicit `narrate` of the identical
say-only text is unchanged (no floor steer, `reason: "delivery_accepted"`).

**Mutation evidence** (scratch copies, `cp` out and back in, never `git checkout --`): (1) forcing
`speechOnly` to `false` in `index.ts` failed exactly the two new tests that depend on the speech-only branch
firing (the settled-check-plus-say-only case and its brings-nothing-second-leg case) and left every other
test, including the other two new ones, green. (2) Dropping the mechanics-marker strip from
`isSpeechOnlyDraft` (keeping only the say-span strip) failed the unit test asserting a marker beside the span
is still speech-only, and only that test. (3) Dropping the `reason: "speech_only"` field from the floor's
telemetry row failed only the assertion that checks for it. All three mutations were restored from the
pre-mutation `cp` backup before the next one was applied.

**Verified before committing:** `node --test tests/extension/gates.test.mjs
tests/extension/single-loop-turn-close.test.mjs tests/extension/preparation-wait-never-strands.test.mjs
tests/extension/refusal-budget-fallback.test.mjs tests/extension/speech-attribution.test.mjs
tests/extension/speech-telemetry.test.mjs tests/extension/unwrapped-speech.test.mjs` -- 68/68 green, both
before my change (baseline, after one `npm run build:runtime` to produce the missing `build/` the harness
imports) and after. The full `test:ext`/pytest suites were not run per instructions (the requester runs them
after merge).

**Not done / left for the owner:** no live-gate replay of #13's shape was run (no live model calls per
instructions); the ruling's "the steer names what the clerk did this turn, which the prose must carry" is
read as the existing `FLOOR_STEER` text (unchanged, since it already speaks to "complete only the player's
already selected goal" regardless of whether a tool ran) rather than a new steer text -- flag if the owner
intended a distinct wording naming the settled check/move explicitly.
