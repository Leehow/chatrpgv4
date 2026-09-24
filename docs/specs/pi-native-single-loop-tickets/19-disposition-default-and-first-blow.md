Status: ready-for-agent
Stage: SL-19 (after SL-12/SL-13; independent of SL-18)
Spec: docs/specs/pi-native-single-loop.md (Rulings: "An NPC's disposition takes the card's word before the Keeper's", "The first blow is the clerk's to select", "Parameter binding never goes to the LLM")

# SL-19 — The disposition's rules default from the card, and attack target rows outside a session

## Evidence (live gates #3–#6)
- `apply:npc-disposition:steven-knott`: Jev `avoids_fighting` at 0.31 / 0.28 / 0.40 / 0.59 (gate #3–#6), never at the 0.6 gate; each time `clerk_unbound` → a Keeper step of 4–10 s. SL-15 already carries `combat_disposition`, `combat_tactic`, `combat_standing` on the person card.
- Gate #5 turn 3: the second compile at Knott's office read addressee Knott 1.0 and act combat 0.90 but had no target rows (no session yet), so the attack went to the Keeper (13.6 s, with a refused resolve + apply first).

## Scope
1. Disposition rules default (§11.5.3 amendment, contract first): when the person record carries an authored `combat_disposition` (or a `combat_tactic` the disposition table maps to a disposition word), the bind's `ruleDefault` is that word; SL-12's clerkBind applies it when Jev does not clear, stamped `basis: rule-default` with `rule: card_disposition`. The Keeper is asked only when the card says nothing. Verify what Knott's card actually carries in `content/starters/the-haunting`; if nothing, say so and the default stays absent for him (the test uses an NPC that has one, or a fixture that sets one).
2. Target rows outside a session (§135.30 amendment): when the act feature is `combat`, the compile's `target` family is asked with the people present as rows (same identities as the addressee family); the attack predicate fires on a cleared target; the candidate the kernel offers for a first blow (the combat start / attack candidate the builders issue outside a session — find which) is selected with the target bound. The kernel keeps opening the session and issuing the attack's parameters.
3. Tests, mutation-killable: default applied when Jev unknown; card without a disposition → Keeper; target rows present only when act = combat; predicate fires on the present person; replay `fight-round` and a fixture from gate6-haunting-0335 before turn 3 (campaign under chatrpgv4-wt-integ-sl/.coc/campaigns, read-only) with live Jev, 3 runs each: disposition bound without a Keeper step; the first blow selected by the compile.

## Comments
