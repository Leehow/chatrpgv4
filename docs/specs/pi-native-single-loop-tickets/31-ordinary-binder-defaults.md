Status: in-progress (claude/sl31-20260924)
Stage: SL-31 (P2; extends SL-12/SL-26)
Spec: docs/specs/pi-native-single-loop.md (Ruling: "The ordinary check's difficulty and dice have rules defaults")

# SL-31 — The ordinary binder's rules defaults

## Evidence (long live gate #2, campaign longgate2-haunting-0830)
- Bind rows with `outcome: keeper`, cause `ordinary_unknown`, unresolved "An actor, difficulty or modifier is not bound.", empty bindings, on turns 7, 8, 10, 14, 18: compile-selected ordinary checks (Appearance for Gabriela, Knott; the kitchen search; STR to pry the cupboard twice) all rolled by the Keeper instead.
- The clerk did roll when the binder cleared everything: turns 9, 12, 15 (Spot Hidden 85, Spot Hidden 92, Craft (Carpentry) 55).

## Scope
1. Contract (§135.28 amendment): the ordinary binder's defaults (difficulty regular unless stated; no modifier; the single present investigator), stamped `basis: rule-default` with the rule per parameter; Jev's cleared answers override.
2. Implement in runtime/jev/ordinary-resolve-domain.ts / step-policy.ts settleOrdinaryBind; the bind row records each default; tests, mutation-killable; replays with live Jev on fixtures from long gate #2's turns 14 and 18 (STR to pry): the check executed by the clerk 3/3.

## Comments

### 2026-09-24 — what was unbound, the contract, the implementation, and the replay pre-registration (before any scored run)

**What was unbound, from the rows** (`chatrpgv4-wt-integ-sl/.coc/campaigns/longgate2-haunting-0830/telemetry.jsonl`, read
only). Each of the five `ordinary_unknown` bind rows has a `lane: "route"`, `purpose: "bind-ordinary"` row one step
earlier with the binder's `parameters`, and each run's compile fired `ordinary_check` on the check:

| turn | declaration | compile fired on | binder route / consent | actor | difficulty (choice, conf; unknown / regular) | bonus / penalty |
| --- | --- | --- | --- | --- | --- | --- |
| 7 | 我找到加布里埃拉·马卡里奥，轻声请她讲讲搬走那晚发生的事。 | act social, addressee Gabriela | no_roll 0.79 / authorized | actor_0 0.28 | **unknown** 0.66; 0.75 / 0.25 | none 0.90 / none 0.93 |
| 8 | 我回诺特办公室，把查到的告诉他，问他能不能托律师朋友调出 1908 年…卷宗。 | act social, addressee Knott (after the clerk's move) | no_roll 0.51 / authorized | **unknown** 0.38 | **unknown** 0.51; 0.64 / 0.34 | none 0.89 / none 0.92 |
| 10 | 我开门进屋，从一楼开始，一个房间一个房间地看，重点看厨房。 | act investigate | no_roll 0.73 / authorized | **unknown** 0.10 | **unknown** 0.48; 0.61 / 0.39 | none 0.94 / none 0.91 |
| 14 | 我下楼回厨房，撬开那个锁着的储物柜。 | act investigate, item (after the clerk's move) | ordinary 0.59 / authorized | **unknown** 0.28 | **unknown** 0.49; 0.62 / 0.37 | none 0.92 / none 0.88 |
| 18 | 我把柜子挪开，看后面的墙和地面。 | act investigate | no_roll 0.79 / authorized | actor_0 0.49 | **unknown** 0.50; 0.63 / 0.37 | none 0.96 / none 0.94 |

The check was compile-selected every time, so SL-26 already stated the single actor (Hayes) and took the compile's act as
the intent, and read the binder's `no_roll` as roll-or-not settled. **The difficulty alone left all five unbound**: Jev
answered it `unknown` (0.61–0.75 on `unknown`), and `interpretOrdinaryRoute` returned "An actor, difficulty or modifier
is not bound." for any one missing. The dice were never in doubt; the actor's `unknown` on turns 8, 10 and 14 was already
covered. The rolls that did go through the clerk (turns 9, 12, 15) had `regular` leading at 0.52–0.68. What the Keeper
then did: turns 14 and 18, STR `regular` itself; turn 7 the Mod's first impression (Appearance), no ordinary check;
turns 8 and 10 no roll. (The Evidence line above attributes Appearance to the ordinary checks of 7 and 8; the rows say
the Keeper rolled no ordinary check there.)

**Contract** `33f21d89f` (§135.28, a dated bullet after the dice; §135.28's path table and tests paragraph; §135.30.3's
two pointers). **Implementation and tests** `bacbb0ff0`.

**Where the defaults live.**
- `runtime/jev/ordinary-resolve-domain.ts`: `ORDINARY_RULE_DEFAULTS` (`difficulty` → `regular`, rule
  `regular_difficulty`; `bonus`/`penalty` → `none`, rule `no_modifier`); `interpretOrdinaryRoute(options, result,
  compiled?, defaults?: {gate})`: with `defaults`, each of the three is Jev's answer when it `clears` (confidence gate or
  margin rule) and is in the vocabulary, else the default, reported in `paths` with the answer's confidence and
  distribution; a single issued investigator is the actor for every clerk binding (not only a compile-selected one);
  what is still unbound is named ("The ordinary check's actor is not bound."). Without `defaults` (the legacy prescreen,
  the task domain) nothing changes.
- `runtime/jev/check-preflight.ts`: `defaults` in, `evidence.paths` out.
- `runtime/jev/hybrid-engine.ts`: `bind-ordinary` passes `defaults: {gate: question.gate}`; `paths` onto
  `OrdinaryBinding` and the `bind-ordinary` row; the Keeper's line glosses `regular_difficulty`.
- `runtime/jev/step-policy.ts`: the `bind-ordinary` question carries the policy's `gate`; `ordinaryBindings` writes
  `difficulty`/`bonus`/`penalty` records (jev or rule-default with rule, confidence, distribution) and `modifiers`
  `rule-default` when any part is; `settleOrdinaryBind` stamps `basis.binding: "rule-default"` and `basis.rule_default`
  (`ordinaryDefaults`), beside `basis.compile` and `basis.roll`.
- "Unless the book states one": the ordinary-check row issues no difficulty; the book's stated difficulty reaches an
  ordinary check through the kernel's obligation fold (§134.17), which overrides the binder's. No dead field was added.

**Tests.** `single-loop-binding.test.mjs` +3: the binder on long gate #2's turn-14 and turn-18 answers (unbound without
`defaults`, bound regular/none with them, paths); cleared `hard` and margin-cleared `extreme` override, uncleared `hard`,
an out-of-vocabulary answer and uncleared dice do not; route-selected check; several investigators (no actor default,
named); the advisory binder unchanged; the records and the basis stamp (and beside `basis.roll`), admission's paths;
the gate on the policy's question and in the engine's binder (the same answer is `jev` at 0.6 and the default at 0.95);
the Keeper's line. `admission-within-turn.test.mjs` +1 (4 subtests): the turn-14 shape at the extension seam with the
emitted kernel: the clerk rolls, `regular` by the default, stamped on the bind row and the basis, admitted `path:
"compile"`; uncleared `hard`, cleared `hard`, an uncleared penalty die.

**Fixtures.** `longgate2-t14`, `longgate2-t18` (shared `longgate2/workspace.tar.gz`), built with `gate-fixture.mjs --home
chatrpgv4-wt-integ-sl --campaign longgate2-haunting-0830 --turns 14,18 --name longgate2`. Recorded Keeper: turn 14, the
clerk's move to the ground floor (live), then `resolve` STR (target "nailed cupboard"), then threat + time; turn 18,
`resolve` STR (regular), `apply` flag + time, `narrate`. The harness's `resolveKey` drops the replayed Keeper's STR when
the clerk already rolled STR.

**Instrument.** `node experiments/single-loop-routing/run.mjs --fixture <f> --runs 3 --llm replay --seed 1 --out
experiments/single-loop-routing/results/sl31-<f>` on this branch: product driver, the recorded Keeper, **live Jev**,
prescreen on, lane admission replayed. One replay process at a time on the Mac (two PDF imports are also running on it).
Control arm: `longgate2-t14` with the engine passing no `defaults` (mutation M1 below, applied for that arm only), 3 runs.

**Registered acceptance (the ticket's).** In each fixture, 3/3 runs: the compile selects the ordinary check, the binder
binds it (no `ordinary_unknown` naming difficulty, bonus or penalty), and **the clerk executes it** (a policy-origin
`resolve` the kernel took), with `difficulty: regular` stamped `rule-default` / `regular_difficulty` on the bind row and
on the basis whenever Jev's difficulty answer does not clear.

**Registered predictions (mine).**
- `longgate2-t14`: the first compile selects the move (as live), the second the check. Difficulty `unknown` again
  (the default regular, 3/3). Profile: STR in most runs; a run where the binder's profile answers `unknown` or its
  route/consent is not ordinary/authorized is the binder's other dispositions (reported, not the defaults' failure).
  The clerk's STR replaces the Keeper's (one STR per run). Admission `path: compile` when the skill cleared, else the
  lane with `parameter_not_cleared:skill`.
- `longgate2-t18`: the compile selects the check; the binder's route `no_roll` (live 0.79) is overridden by the compile
  act when STR clears (SL-26's ruling); difficulty default regular; clerk STR 3/3.
- Control (`t14`, no defaults): `ordinary_unknown` with the generic line and empty bindings 3/3, the replayed Keeper's
  STR, as at the table.
- What falsifies the change rather than the model: an `ordinary_unknown` whose unresolved names difficulty, bonus or
  penalty; a clerk check whose difficulty is not `regular` while its difficulty record is not `jev`; a default taken
  without `rule_default` on the basis or the record; two STR rolls in one run.
