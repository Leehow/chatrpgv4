Status: ready-for-human
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

### 2026-09-24: implemented on `claude/sl19-20260924`

Branched from the single-loop integration branch at `b8dd818bd`. Not merged; no push, no package, no live table.

**Commits:** `9377a7ac6` (contract §11.5.3 amendment + §135.30.2, kernel, runtime, extension, tests), `4360b100b` (gate #6
fixture, world-state variants, replay instrument fix, pre-registration), and the results commit that carries this comment.

**What Knott's card carries.** `content/starters/the-haunting` prints no `combat` (no tactic, disposition or action) and no
`mechanics.profile` for him. At gate #6 before turn 3 his card reads `mechanics: null`, `combat_tactic: {defense: null,
basis: "rule-default"}`, `combat_disposition: {disposition: null, basis: null, options, material}`; after the Keeper's
archetype pin, `combat_tactic: {dodge, rule-default}`. Neither is the card's word (a rule-default tactic is Fighting
against Dodge, not a statement about him), so **his default stays absent** and the Keeper is still asked for his
disposition with this starter.

**Where each piece lives.**
- An authored `combat.disposition` never reaches the bind: the kernel reads it as source 1 and issues the standing (SL-08),
  so the only card word that can default the bind is a **stated tactic** (book `combat.defense` or a Keeper `apply npc
  defense`) mapped by the disposition table's new closed `tactic_dispositions` (`content/rulesets/coc7/rules-json/
  npc-combat-disposition.json`; validated in `dispositionTable`, `kernel-ts/combat/standing.ts`).
- The kernel issues it on the card as `combat_disposition.default {disposition, rule: "card_disposition", from}`
  (`cardDefault`, `kernel-ts/combat/standing.ts`).
- The builder turns it into the bind's `ruleDefault` with its own composed `why` and `read: ["combat_tactic"]`
  (`dispositionInference`, `runtime/jev/candidates.ts`); `clerkBind` takes it when Jev does not clear
  (`runtime/jev/step-policy.ts`); the extension's `_inferred` marker names the read (`extensions/kernel/index.ts`); the
  Keeper's note says which rule gave it (`runtime/jev/hybrid-engine.ts`).
- First blow: nothing was issued outside a session before (the combat decisions by name only; the builder offered the
  ordinary check alone). The kernel now issues `table.resolve.options.context.first_blow` (`kernel-ts/runtime/
  resolve-operation.ts`: one investigator, the people present with a stat block and not incapacitated, the investigator's
  weapons); the builder makes it `resolve:combat:first-blow` (new clerk authority `first_blow`); `compileRows` gives the
  `target` family the addressee rows when the row exists; the compile-only `first_blow` predicate fires on act `combat` +
  a cleared target the row issues (`runtime/jev/route-compile.ts`). The weapon is a closed Jev bind with no default.

**Owner decisions to confirm.** (1) The shipped `tactic_dispositions` rows (`fight_back` → `fights_then_flees`, `dodge` →
`avoids_fighting`, `none` unmapped) are SL-19's reading, data only. (2) A rule-default tactic gives no default (so Knott
stays with the Keeper); counting it would clear every archetype-pinned NPC's disposition from Fighting vs Dodge. (3) The
first blow is compile-only (like obligation steps, §135.30.1). (4) The gate #6 sentence reads act `combat` 0.44–0.50 against
`social` (see the replays): whether a cleared target at a fightable person should fire the first blow when the act is not
cleared on another act is a predicate change not made here.

**Replays** (pre-registered in `experiments/single-loop-routing/RESULTS-20260923.md` before the runs; 3 runs each, live Jev,
`--llm replay --admission lane --seed 1`):

| fixture | disposition bound without a Keeper step | first blow selected by the compile | LLM steps |
| --- | --- | --- | --- |
| fight-round (control) | 0/3 (Jev 0.26–0.33 → Keeper) | n/a (in a fight) | 2 ×3 |
| fight-round-card (Keeper tactic `dodge`) | **3/3** (rules default `avoids_fighting`, Jev 0.28–0.35) | n/a | 2 ×3 |
| gate6-t3 (control) | 0/3 (card says nothing) | office 0/3 (no row); **1/3 after the Keeper's archetype pin** (act 0.85, target 0.99, weapon `unarmed` 0.96) | 5 / 5 / 4 |
| gate6-t3-card (pin + Keeper tactic) | **3/3** (rules default; run 1 offline on the Jev budget) | **0/3** -- target Knott cleared 0.98–0.99, act `combat` 0.46 / `social` 0.50 / 0.44 never cleared | 5 ×3 |

**Mutations** (each applied alone, the named tests run, then restored): 14/14 killed -- rule-default tactic defaults;
builder ignores the card default; the default's `why` dropped; `_inferred.read` ignores the default; no target rows
outside a session; target rows without a first-blow row; `first_blow` fires on any act; fires on an unissued target; not
compile-only; the row names people without a stat block; malformed tactic map accepted; the in-session `attack` predicate
reads the first blow; the default taken over a clearing Jev answer; the row issued inside a fight.

**Suites (leehow-pc):** ext 2861/2861 pass; loop 117/117; py 1716 passed, 2 skipped (on `4360b100b`).

