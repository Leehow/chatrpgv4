Status: ready-for-agent
Stage: SL-14 (kernel; independent of SL-13/SL-15)
Spec: docs/specs/pi-native-single-loop.md (Ruling: "An ordinary check on an obligation's approach is the obligation's attempt"); docs/specs/scene-obligations-as-candidates.md

# SL-14 — An ordinary check that covers an open obligation is that obligation's attempt

## Evidence (live gate #3, campaign `gate3-haunting-2329`, turn 2)

- `turns/0002.json`: the Keeper's call `t2-c1` was `core-check:ordinary-check`, skill Persuade, 44 vs 40, failure, bonus 1, `effects: []`, no `obligation` on the action.
- The capsule at that turn listed `globe-clippings-access` `open`, who Arty Wilmot, cue "next: Persuade, Intimidate, Charm or Fast Talk (regular) against Arty Wilmot; resolve with action.obligation; guards globe-unpublished-story, macario-tragedy".
- After the turn the obligation is still `open` and nothing records an attempt; the editor refused only in prose.

## Scope

1. **Kernel fold** (`kernel-ts/resolve/`): when an ordinary check's actor is an investigator, its target (or, absent a target, the person the action's `goal`/`method` cannot name — do not guess: no target means no fold) is the open obligation's `next.target`, and its skill is among the obligation's approaches, the kernel resolves it as the obligation's attempt: the obligation's difficulty and minimum apply, the guards are checked, the attempt is recorded, the failure price applied, the obligation receipt is issued beside the roll's, and the returned outcome carries `obligation: {handle, step, counted: "folded"}`. The ordinary-check outcome shape is otherwise unchanged.
2. **Precedence.** An explicit `action.obligation` is unchanged. A check that matches two open obligations folds into none and says so in the outcome (`obligation_ambiguous`), never refuses.
3. **Contract.** §134.17 in docs/kernel-rpc.md, contract first. Update the obligations spec's tickets file (SO-06 pointer to this ticket).
4. **Reader.** The Keeper's note on such a resolve says what the check counted as (one line, from the receipt), so it does not roll again.

## Acceptance

- pytest kernel tests through the real `resolve` entry with the gate-3 turn-2 arguments against a campaign built from `content/starters/the-haunting`: folded receipt, price applied, obligation state advanced on success / attempt recorded on failure; explicit `action.obligation` unchanged; two-obligation ambiguity; no target → no fold. Mutations: fold disabled, price skipped, ambiguity folded anyway.
- `npm run build:runtime`, `test:ext`, pytest green on the branch and after merging 0.9.5a.

## Comments
