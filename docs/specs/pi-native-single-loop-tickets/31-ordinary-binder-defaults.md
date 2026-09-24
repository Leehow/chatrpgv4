Status: ready-for-human (implemented 2026-09-24 on `claude/sl31-20260924`, merged with `claude/integ-single-loop-20260923`@b8aced229; the t14 replay did not reach the binder, see Comments)
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

### 2026-09-24 — replays, mutations, suites (branch `claude/sl31-20260924`, base `762d639e1`)

**Commits.** `33f21d89f` contract; `bacbb0ff0` implementation and tests; `6c73d5fdf` fixtures and the pre-registration
above; `a709ac67a` merge of the integration branch at `b8aced229` (SL-32; no overlap: nothing in `runtime/jev`); the
commit carrying this comment has the results and the manifest.

**Replays** (live Jev, the recorded Keeper, lane admission replayed, prescreen on, one process at a time on the Mac at
load 5–7 beside the two PDF imports; `experiments/single-loop-routing/results/sl31-*`).

| fixture / arm | run | compile act (second compile for t14) | selected | binder route; skill | difficulty record | clerk's roll | its admission | Keeper's rolls |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `longgate2-t18` (seed 1) | 1 | investigate 0.89 | ordinary check | no_roll 0.81 (compile_act); **Spot Hidden** 0.57 (STR 0.23), cleared by margin | **rule-default** `regular_difficulty` (Jev `unknown`, 0.40) | **yes**, regular | **compile**, `rule_default.difficulty`, `roll: compile_act` | STR (replayed) |
| | 2 | investigate 0.91 | ordinary check | no_roll 0.78; Spot Hidden 0.52 (STR 0.27) | rule-default (0.45) | **yes** | **compile** | STR |
| | 3 | investigate 0.91 | ordinary check | no_roll 0.83; Spot Hidden 0.55 (STR 0.24) | rule-default (0.38) | **yes** | **compile** | STR |
| `longgate2-t18` control: M1 (no defaults) for this arm (not registered) | 1–3 | investigate 0.90–0.91 | ordinary check | — | — | **no**: `ordinary_unknown`, "An actor, difficulty or modifier is not bound.", Jev's difficulty `unknown` 3/3 | — | STR |
| `longgate2-t14` (seed 1) | 1–3 | first: move ✓ / move 0.51–0.58; second (kitchen): **move 0.52–0.58** | the move only | not asked | — | no | — | STR (replayed) |
| `longgate2-t14` control: M1 (registered) | 1–3 | second: investigate 0.44–0.51, **not cleared** | the move only | not asked | — | no | — | STR |
| `longgate2-t14` extra (seed 2, not registered) | 1–3 | second: investigate 0.41–0.45, not cleared | the move only | not asked | — | no | — | STR |

**Against the registration.**
- `longgate2-t18`: **met 3/3** as the ticket words it: the compile selected the check, the binder bound it with the
  difficulty `regular` by `regular_difficulty` (Jev's difficulty `unknown` every time, as live), the dice by Jev (`none`
  0.92–0.97), the single investigator stated, and the clerk executed it, admitted `path: compile` with `basis.binding:
  rule-default`, `rule_default: {difficulty: {value: regular, rule: regular_difficulty}}` and SL-26's `basis.roll`. The
  control reproduces the live defect 3/3. **My prediction "clerk STR" failed**: for "我把柜子挪开，看后面的墙和地面。" the
  binder's profile question chose **Spot Hidden** (0.52–0.58 against STR 0.23–0.27, cleared by the margin rule), the
  look behind the cupboard rather than the shift; so the replayed Keeper's STR (a different skill, not deduplicated) also
  ran: two checks on the turn, one each for the two clauses. That is the binder's reading of a two-action sentence, not
  the defaults; the live Keeper would see `clerk_did` Spot Hidden before deciding its STR.
- `longgate2-t14`: **not met, 0/3 selected**, and the defaults were never reached: after the clerk's move the second
  compile read `act` as move 0.52–0.58 (or investigate 0.41–0.51), under the gates, in all nine runs of three arms;
  live it read investigate 0.68 (0.71 / move 0.22) and selected the check. The route's `need` question then left the
  check to the Keeper, who rolled STR as at the table. The binder's side of turn 14 (its recorded answers, difficulty
  `unknown` 0.49) is covered at the extension seam with the emitted kernel (`admission-within-turn.test.mjs`, SL-31
  test, "difficulty unknown" subtest) and in `single-loop-binding.test.mjs`. What would make the fixture reach the
  binder is the compile's act on "撬开那个锁着的储物柜" after a move in the same declaration (SL-26's open point (2) is the
  same family: a declaration that moves and then acts) -- outside this ticket; for the owner.
- No falsifier seen: no `ordinary_unknown` naming difficulty, bonus or penalty on this branch; every executed check's
  difficulty is `regular` with its record `rule-default` and the basis stamped; no two rolls of one skill in a run.

**Mutations** (each applied alone in this worktree, then `single-loop-binding`, `check-preflight-request`,
`check-preflight`, `jev-ordinary-resolve-domain`, `single-loop-compile`, `scene-obligation-candidates` and the SL-26/SL-31
tests of `admission-within-turn`, restored after; all 15 killed; counts are failing tests, fast files + seam subtests).

| mutation | file | failing |
| --- | --- | --- |
| M1 the engine passes no `defaults` | `hybrid-engine.ts` | 1 + 5 |
| M2 an uncleared answer is taken (no gate) | `ordinary-resolve-domain.ts` | 2 + 3 |
| M3 a cleared answer does not override | `ordinary-resolve-domain.ts` | 2 + 5 |
| M4 the difficulty default is `hard` | `ordinary-resolve-domain.ts` | 2 + 4 |
| M5 the single investigator only for a compiled check | `ordinary-resolve-domain.ts` | 2 + 0 |
| M6 the binder drops `paths` from its evidence | `check-preflight.ts` | 1 + 5 |
| M7 the basis is not stamped | `step-policy.ts` | 2 + 4 |
| M8 no per-parameter records | `step-policy.ts` | 2 + 5 |
| M9 the `modifiers` record always `jev` | `step-policy.ts` | 1 + 4 |
| M10 the policy's question omits the gate | `step-policy.ts` | 1 + 0 |
| M11 the engine ignores the question's gate | `hybrid-engine.ts` | 1 + 0 |
| M12 the Keeper's line has no gloss for the rule | `hybrid-engine.ts` | 1 + 0 |
| M13 the margin rule not applied | `ordinary-resolve-domain.ts` | 2 + 0 |
| M14 the rule not recorded on the path | `ordinary-resolve-domain.ts` | 2 + 4 |
| M15 the dice default is one die | `ordinary-resolve-domain.ts` | 1 + 2 |

**Suites** (leehow-pc at `a709ac67a`, the merged tree; the box at load 22–25 on 16 threads).
- `loop` 152/152, exit 0 (61 s).
- `ext` 2949/2950 (exit 1, 267 s): `post-delivery-continuity` "a review that could not answer is recorded as an
  unreviewed delivery" (`reading 'mode'` of an undefined row); rerun 2948/2950 (exit 1, 293 s) with a different pair:
  `single-loop-looks-first-visit` §135.31.1 seam ("both reads ran the prescreen: prepared, fallback") and
  `jev-source-domain` "root consultation" ("source task deadlocked", a timeout). Each failed once and passed in the other
  run; each file passes on the Mac at the same HEAD (`post-delivery-continuity` 10/10 three times; the other two 11/11);
  none touches the ordinary binder. Timing under the box's load, as SL-26 recorded for `jev-source-domain`.
- pytest not run: no kernel input changed (`kernel-ts/`, `content/`, `prompts/`, `tests/kernel`, `tests/play` untouched).

**Watch items.** (1) With a default difficulty, the binder now also binds the social ordinary checks of turns 7 and 8
(talking to Gabriela and Knott), where its route question answered `no_roll` 0.51–0.79 and the compile's act settles
roll-or-not (SL-26's ruling): a live table may see a clerk's Persuade/Charm on a quiet conversation where the Keeper
rolled none. (2) The two-clause declaration of turn 18 gets the clerk's Spot Hidden and, if the Keeper still wants it,
its own STR.

**Not done.** No live table, no packaging, no push.
