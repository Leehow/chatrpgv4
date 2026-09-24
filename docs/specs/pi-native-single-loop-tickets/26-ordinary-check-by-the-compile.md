Status: in-progress
Stage: SL-26 (P2; extends SL-13)
Spec: docs/specs/pi-native-single-loop.md (Ruling: "The declared ordinary check is the clerk's")

# SL-26 — The compile selects the declared ordinary check

## Evidence (long live gate, campaign longgate-haunting-1010, turns 11–13)
- "先站在楼梯口听一会儿" → Keeper Listen 72; "搜床底、床垫和衣柜" → Keeper Spot Hidden 96 (fumble); "把窗户和地板敲一遍，找暗格" → Keeper Spot Hidden 99, 83, then Dodge 71 / SAN / CON on the flying bed. Six rolls by the Keeper at 3–6 s of review each; the compile answered `decided_none` / `fell_through` because no predicate reads `resolve:core-check:ordinary-check`.
- The ordinary binder (`bind-ordinary`, runtime/jev/ordinary-resolve-domain.ts, step-policy settleOrdinaryBind) already settles skill/intent/modifiers from the declaration when asked.

## Scope
1. Contract first (§135.30 amendment): an `ordinary_check` predicate: when act clears to investigate (or social with an addressee present) and the ordinary binder settles the skill from the declaration, the compile selects the ordinary check; the binder's bind row carries the paths; admission by compile evidence applies (§32.12) when the binder's skill cleared.
2. Implement; tests, mutation-killable; replays with live Jev on fixtures from the long gate's turns 11 and 12 states: the check selected and executed by the clerk, Listen/Spot Hidden as the binder reads them.

## Comments

### 2026-09-24 — contract, implementation and the replay pre-registration (before any scored run)

**Campaign id.** The long gate's campaign is `longgate-haunting-0624` in `chatrpgv4-wt-integ-sl/.coc/campaigns` (playtest
`longgate-haunting-0624-20260924T102454Z`); `longgate-haunting-1010` in this ticket and in SL-02's Comments is not a
directory there (the turn texts and receipts match 0624). Read only; the fixtures copy it.

**Contract** §135.30.3 (`3e2826490`, test notes amended in the implementation commit): the `ordinary_check` predicate, the
binder's bind records, admission's fifth condition (`cleared: false` refuses the exemption), the Keeper's roll taking the
check, and the cost (a run whose read offers only the check now owes a compile). §135.3's `declared_check` and §32.12's
family list point at it.

**Where the predicate lives.** `COMPILE_PREDICATES` in `runtime/jev/route-compile.ts`, after `first_blow`; row building
(`compile-rows.ts`) is untouched. It fires when `act` clears on `investigate`, or on `social` with `addressee` cleared on a
person; not when `destination` cleared on a place row (the check is the destination's), nor when `ask` cleared on an open
obligation's demand (that obligation's check is the declared one); it binds `intent` from the act (`Fired.from` names the
family a parameter was read from) and never decides the check, so the route's `need` question still reads it when it does
not fire. Not `sole`.

**Fixtures.** `longgate-t11` and `longgate-t12` (shared `longgate/workspace.tar.gz`), built with `gate-fixture.mjs --home
chatrpgv4-wt-integ-sl --campaign longgate-haunting-0624 --turns 11,12 --name longgate`. The recorded Keeper of turn 11:
three `lookup`s, `resolve` Listen (intent investigate, no decision), `apply` move to the bedroom + time + threat, `resolve`
the bed-attack rule step 0 (skill Spot Hidden). Turn 12: `resolve` the bed-attack rule step 0 (no skill), then a refused
`resolve` (flee, not replayed). The harness's `resolveKey` now counts the clerk's ordinary check and a Keeper's roll of the
same skill as one roll (`product-entry.ts`), so the replayed Keeper drops its recorded Listen/Spot Hidden when the clerk
already rolled that skill; the bed-attack rule step (another key) is still replayed.

**Instrument.** `node experiments/single-loop-routing/run.mjs --fixture <f> --runs 3 --llm replay --seed 1 --out
experiments/single-loop-routing/results/sl26-<f>` on this branch: the product driver, the recorded Keeper, **live Jev**,
prescreen on, lane admission replayed. One replay process at a time. Control: `longgate-t12` with the predicate removed
(mutation M1 below, applied for that arm only), 3 runs.

**Registered acceptance (the ticket's).** In `longgate-t12`, 3/3: the compile selects `resolve:core-check:ordinary-check`
(`fired` names `ordinary_check`), the binder binds **Spot Hidden**, the clerk executes it (a policy-origin `resolve` the
kernel took, a roll receipt), its intent is `investigate` (the compile's act), and its admission row is `path: "compile"`
with no lane request for it when the skill record says `cleared: true` (a `cleared: false` run is reviewed with
`compile_refused: parameter_not_cleared:skill`, which is the rule, reported). In `longgate-t11`, see the branches below.

**Registered predictions (mine).**
- `longgate-t12`: `act` investigate ≥ 0.9 (live 1.0) and `destination` `none` ≈ 0.96 → fires 3/3. Profile Spot Hidden,
  cleared in at least 2/3. No double roll: no Keeper Spot Hidden ordinary roll after the clerk's (the recorded rule step is
  a different call and may still run). Control arm: the compile `decided_none`/`fell_through` as at the table, the route's
  `need` for the check `later`, no clerk roll.
- `longgate-t11` ("我上二楼，先站在楼梯口听一会儿，再去主卧。"). The first compile is on the ground floor with the bedroom as a
  destination row. Live it read `act` move 0.61 (cleared) and `destination` none 0.54 / bedroom 0.37 (not cleared).
  Branches, each counted:
  (a) `act` move (or anything but investigate/social) at the first compile: no fire; the Keeper's recorded Listen runs,
      consumes the check (`consumedByResolve`), and no later compile or route adds a clerk roll: **one** Listen in the run;
  (b) `destination` cleared on the bedroom: the clerk's move, then the bedroom's compile (owed by its new exits) may fire
      the check with the binder's Listen; the replayed Keeper's Listen is then dropped: **one** Listen;
  (c) `act` investigate and no destination: the clerk rolls Listen before the move; **one** Listen.
  My expectation: (a) in most runs, as live. What falsifies the change rather than the model: two Listen rolls in one run,
  a clerk ordinary check whose intent is not the compile's act, or a compile-selected check admitted without its skill
  record cleared.
