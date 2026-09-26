Status: ready (filed 2026-09-26 from long gate #13; batch 13)
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
