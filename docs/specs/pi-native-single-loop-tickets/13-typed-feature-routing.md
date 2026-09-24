Status: ready-for-human
Stage: SL-13 (after SL-12; before SL-03)
Spec: docs/specs/pi-native-single-loop.md (Rulings: "Routing asks what the player does, never whether a candidate is due", "Parameters-only steps never go to the LLM", "Parameter binding never goes to the LLM")

# SL-13 — Typed-feature routing: one Jev compile per turn, predicates select the clerk's candidates

## Evidence (live gate #3, 0.9.5a `19965521e`, campaign `gate3-haunting-2329` under `chatrpgv4-wt-integ-sl/.coc/campaigns/`)

- Turn 1, "我接。先去《环球报》剪报室，翻科比特宅这些年的旧报道。": route s2 offered `apply:move:newspaper-morgue`; `need_2` = now 0.61 / later 0.37, confidence 0.42 < 0.6 → `low_confidence`, the whole turn went to the Keeper (5 model calls, 58.2 s). Gate #2's table scored the same sentence 0.93.
- Turn 2, "我说明来意，请他帮忙调出科比特宅这些年的旧剪报。": `resolve:obligation:globe-clippings-access` offered; the seeks question answered `not` 0.54 / seeks 0.31 / unknown 0.15 → `ask_llm`.
- Turn 3, "我回诺特办公室，揪住他的领子一拳打过去…": the move selected at 0.90 (the one success); the disposition bind `avoids_fighting` 0.67 of the mass, confidence 0.59 → `clerk_unbound`.
- The route rows with `offered`, `answers` and `probabilities` for every step are in that campaign's `telemetry.jsonl` (`lane: "route"`); the pre-turn states are its `turns/000{0,1,2}.json` and `world.json`.

## Scope

1. **A compile step.** After the read, before routing, one Jev `decide(compile)` reads the player's declaration into closed features. Each feature's options come from the read: destinations (scenes the capsule offers as moves), addressees (people present, by the table's label), asks (the open obligations' demands and the clue/handout names the scene offers), acts (the session's issued actions when a session is active; else a small closed set the kernel already knows: the resolve intents), targets (people present / fighters), items (carried). Every feature has `none` and `unclear`. The question text is built from rows, never from a hand-written list; a feature with no rows to offer is not asked.
2. **Predicates.** Code in the policy selects candidates from features and their rows: a move whose `to` equals the destination feature; an obligation candidate whose meeting person or demand equals the addressee/ask; an attack whose target equals the target feature; a disposition bind stays a bind (SL-12). A predicate fires only on a feature answer that clears the gate; otherwise the candidate falls through to the existing `need` question. The exit question stays.
3. **Budget.** One compile call per turn plus SL-12's binds; the compile replaces the first fan-out when it selects, so the Jev calls per turn do not go up. Record a `lane: "route"`, `purpose: "compile"` row with the features, their distributions and which predicates fired.
4. **Contract.** §135.30 in docs/kernel-rpc.md: the compile step, the feature families and where each family's options come from, the predicates, the telemetry row. Contract first, then code.
5. **Replay fixtures** built from the gate #3 campaign's three pre-turn states (the harness in `experiments/single-loop-routing` takes an RD-04 digest; the campaign directory is read-only evidence, copy what you need). Pre-register the expected selections before running.

## Not in scope

Changing the gates (0.6 + margin), the Keeper's prompt, or the candidate builders' rows. No embedding index, no lexical matching, no word lists.

## Acceptance

- Replays, 5 runs each, live Jev, recorded Keeper: turn 1 selects `apply:move:newspaper-morgue` ≥ 4/5; turn 2 selects `resolve:obligation:globe-clippings-access` ≥ 4/5 (its approach then binds by SL-12); turn 3 selects the move ≥ 4/5. The `turn3-obligations` and `fight-round` regressions unchanged or better (live rows, LLM steps).
- Policy tests with a stub decision port: a predicate never fires below the gate; a feature with no rows is not asked; a compile that selects skips the first fan-out; mutation-killable (predicate disabled, gate ignored, options invented).
- `npm run test:ext`, the loop suites, and pytest green on the branch and after merging 0.9.5a.

## Comments

### 2026-09-24 — implemented (branch `claude/sl13-20260924`, base `ef8efdf97`)

Commits: `d4b09f5e4` contract §135.30; `fe54e7432` contract amendment (the attack with no cleared target falls through to
its own bind); `a34455cbf` implementation and tests; `1098b9249` the gate fixtures, the control arm and the replay
pre-registration; the scored replays and this close on top. 0.9.5a has not moved since `ef8efdf97`, so the branch is
also the merged state.

**Where each piece lives** (contract §135.30):

| piece | code |
| --- | --- |
| feature rows (destination, addressee, ask, act, target, item) from the read's own kernel rows | `runtime/jev/compile-rows.ts` (`compileRows`); `obligation-candidates.ts` exports `guardedThings` (the fact question's words, shared) |
| the compile question (rows + `none` + `unclear`), gated answers, predicates, decided / fell through | `runtime/jev/route-compile.ts` (`compileBatch`, `readFeatures`, `COMPILE_PREDICATES`, `interpretCompile`) |
| the gates (unchanged, now shared by route, bind and compile) | `runtime/jev/decision-gate.ts` |
| the step: once per run, before the first route; a selecting compile replaces the first fan-out; decided candidates consumed | `runtime/jev/step-policy.ts` (`compileDue`, `settleCompile`, `createStepPolicy` decide `compile`) |
| rows on every read; the `lane: "route"`, `purpose: "compile"` row; a compile-settled parameter recorded as `jev` on the bind row; engine option `compile` (default true) | `runtime/jev/hybrid-engine.ts` |
| prototype driver | `experiments/single-loop-routing/loop.ts` (`runTurn` handles `compile`; it asks one only when its refresh port carries rows) |
| tests | `tests/extension/single-loop-compile.test.mjs` (9); `single-loop-domain-policy` and `scene-obligation-candidates` count route batches instead of all decisions (their stubs answer the compile `unknown`, so their route paths run as before) |
| instrument | `experiments/single-loop-routing/gate-fixture.mjs`, fixtures `gate3/` (shared tarball), `gate3-t1..t3/`; `product-entry.ts --compile off`, the compile row and selections in the summary |

**Decisions made here that the owner should confirm:**

1. **An obligation check fires on the ask, never on the addressee alone.** Speaking to the gatekeeper is not seeking what
   he guards. The addressee is a guard: cleared on someone else or on `none`, it blocks; the act, cleared outside a fight,
   blocks when it is not one of the check's own closed intents (so "punch him" at the morgue cannot roll Persuade). The
   ruling's wording ("the obligation whose meeting or demand is the addressee and the ask") admits the stricter "both";
   with "both", t2 would have selected in 3/5 (the addressee cleared in 3/5).
2. **A candidate the compile decided and did not select is the Keeper's for the rest of the run** (consumed, as §135.26's
   fact question consumes an unselected obligation). "Decided" means the feature the predicate turns on cleared on a row
   or on `none`; `unclear`, `unknown` or below the gate fall through to the `need` question.
3. **Clue and handout names are `ask` rows, but no predicate selects a clue or a handout by the ask** (asking for a thing is
   not getting it); they are there so "something else" is an answer. Clues, handouts, roster persons, Mod contact checks,
   the ordinary check and session steps other than the investigator's attack keep the `need` question.
4. **`target` is asked only in a fight** (its rows are the attack row's issued targets); outside one the people present
   are the `addressee`'s rows. **`item` is asked whenever an investigator carries something, and no predicate reads it
   yet**: the answer is only recorded on the compile row (§31's third end is the operator). Drop it, or name the predicate
   that should read it.
5. **`destination` rows are every move row the kernel issues**, a withheld one (unmet gate, guarded exit) included: the
   answer is about the words; the predicate reaches only issued candidates.
6. **The compile is asked once per run, before the first route, and only when a predicate can reach an offered
   candidate**; it is not re-asked after a scene change (the morgue's candidates at turn 1 go to the route, as before).
7. **Fight-round miss (below):** "继续揍他" does not clear the only issued target (0.24–0.28), so the attack falls through
   and the run spends one Jev decision more than SL-12's. Whether the attack predicate should fire on the act alone when
   the kernel issues exactly one target is yours; it was not changed after the registration.

**Replays** (product driver, replayed Keeper = the recorded gate #3 Keeper, live Jev, `--admission lane`, seed 1 unless
named; pre-registered in `1098b9249`; full tables in `experiments/single-loop-routing/RESULTS-20260923.md`, traces under
`results/sl13-*`). Jev decisions = the run's `lane: "route"` rows (c compile, r route, b bind); the prescreen's own Jev calls
come on top (the same read in both arms; 3–19 per run, the first run of each arm the highest).

| arm | runs | selected | by | Jev decisions per run | LLM steps | live rows |
| --- | --- | --- | --- | --- | --- | --- |
| t1 compile (`apply:move:newspaper-morgue`) | 5 | **5/5** | compile, destination 0.99–1.0 | c r r = 3 | 5 | 5/11 |
| t1 control | 5 | 5/5 | route, need 0.79–0.82 | r r r = 3 | 5 | 5/11 |
| t2 compile (`resolve:obligation:globe-clippings-access`) | 5 | **5/5** | compile, ask 0.71–0.79 (addressee cleared 3/5, act social 0.95–0.97) | c b r = 3 | **1** | 2/2 |
| t2 control | 5 | 0/5 | fact `not` 0.15–0.30 | r r = 2 | 2 | 2/2 |
| t3 compile (`apply:move:commission-briefing`) | 5 | **5/5** | compile, destination 0.99; the morgue's check decided (ask `none` 0.94–0.95), never selected | c r r b r (r) = 5–6 | 6 | 7/7 |
| t3 control | 5 | 5/5 | route, need 0.87–0.89 | r r r b r r = 6 | 6 | 7/7 |
| turn3-obligations seed 4 | 3 | move 3/3 (compile, 1.0); morgue check 1/3 (route) | | c r r r r / c r r r r / c r b r r r | 5 / 5 / 4 | 11/11 |
| fight-round | 3 | attack 3/3 **by the route**; compile 0/3 | act 0.99, target 0.24–0.28 (not cleared) | c r b r = 4 (SL-12: 3) | 2 | 5/5 |

Against the acceptance: turn 1 ≥ 4/5 **met (5/5)**; turn 2 ≥ 4/5 **met (5/5)**, its approach bound by SL-12 with no model
call (Jev `Persuade` 0.72–0.79, every parameter path `jev`; the claimed roll failed 5/5 under seed 1, the obligation stayed
open); turn 3 ≥ 4/5 **met (5/5)**. Regressions: turn3-obligations unchanged (11/11, 4–5 LLM steps as SL-12's 4–5);
fight-round unchanged in live rows and LLM steps (5/5, 2) but **one Jev decision more** per run, the registered "attack by
the compile ≥ 2/3" **missed (0/3)**.

What the numbers do and do not show: the replay reproduces the live failure only on turn 2 (control 0/5 → compile 5/5, one
model step fewer). On turns 1 and 3 the control's route also selects 5/5 on this instrument (the live turn 1 sat at 0.61 vs
0.37; the replay's read gives 0.79–0.82), so there the compile adds margin (0.99–1.0), not the outcome; a live gate can say
whether it fixes turn 1 on the table.

**Mutations** (each applied to the worktree file, the covering test file `tests/extension/single-loop-compile.test.mjs` run
with `--test-concurrency=2`, the file restored; all 14 killed):

| mutation | file | killed | failing tests |
| --- | --- | --- | --- |
| M1 move predicate disabled | `route-compile.ts` | yes | 4 |
| M2 obligation predicate disabled | `route-compile.ts` | yes | 1 |
| M3 attack predicate disabled | `route-compile.ts` | yes | 1 |
| M4 gate ignored (any row answer clears) | `route-compile.ts` | yes | 1 |
| M5a invented option read as a row | `route-compile.ts` | yes | 1 |
| M5b invented option offered in the question | `route-compile.ts` | yes | 1 |
| M5c a family with no rows asked | `route-compile.ts` | yes | 1 |
| M6 compile does not replace the fan-out (selected not queued) | `step-policy.ts` | yes | 7 |
| M7 decided candidates not consumed | `step-policy.ts` | yes | 4 |
| M8 compile asked again after a route | `step-policy.ts` | yes | 4 |
| M9 addressee guard removed | `route-compile.ts` | yes | 1 |
| M10 act guard removed | `route-compile.ts` | yes | 1 |
| M11 compile row not recorded | `hybrid-engine.ts` | yes | 1 |
| M12 read carries no rows | `hybrid-engine.ts` | yes | 1 |

Before the owner's throttle, M1–M5b had also run against the nine single-loop test files (loop suite, `single-loop-*`,
`scene-obligation-candidates`): killed with 4 / 1 / 1 / 1 / 8 / 1 failing; that run was stopped there and the loop redone on
the one covering file.

**Counts:**

| suite | baseline `ef8efdf97` (own worktree) | branch `a34455cbf` |
| --- | --- | --- |
| `npm run build:runtime` | exit 0 | exit 0 |
| `npm run test:ext` | 2821: 2820 pass, 1 fail (`npc-preparation-integration`: "independent NPC and material decisions must coexist", a timing assertion, run while the machine was at load 38+) | 2830/2830 (the baseline's 2821 + 9 SL-13 tests) |
| loop suites (`loop.test.mjs`, `single-loop-*.test.mjs`, `scene-obligation-candidates.test.mjs`) | — | 93/93 |
| `uv run --frozen python -m pytest tests/kernel tests/play` | not run | not run: nothing the kernel reads changed (`kernel-ts/`, `content/`, `tests/kernel`, `tests/play` untouched; `build/kernel/` byte-identical to the baseline's build) |

**Not shown:** a live table (not in scope); the Keeper reading `basis.compile`; the compile at a table whose first read
materials give the need question 0.61, as the live turn 1 did.

### 2026-09-24 — SL-13 follow-up after live gate #4 (branch `claude/sl13b-20260924`, base `db056b144`)

**A. The live turn with no compile.** Live gate #4 turn 1 (`gate4-haunting-0214`, run `run-01a0d20e-…22e`) had no compile
row. Cause, reproduced on the gate #4 turn-1 fixture's first read (`experiments/single-loop-routing/probe-reads.mjs`): the
commission's clues were not yet revealed, so all seven exits carried `unlock_when.met: false` (the morgue's:
`clue_discovered: knott-research-leads`) and the builder issues no move for such a row (`runtime/jev/candidates.ts:278`);
the destination rows existed, but no offered candidate was one a predicate could select, so no compile before the first
route (correct). The Keeper's clue (s3/s4) unlocked the exits, and `compileDue` (`runtime/jev/step-policy.ts:274-276` on
`db056b144`) owed the compile only while no route had been asked, so the move went to the `need` question (s5) and the
morgue's check to the fact question (s8). Not the cause: empty rows, the engine option, a digest collision, the read's
rows (all present). Gate #3's turn 1 did not show it because gate #3's turn 0 had already revealed the clues.

Fix (§135.30.1): the compile is due whenever an offered candidate a predicate can select is outside
`RunView.compiledOver` (the keys the run's compiles were asked over), so a later read's reachable candidates get one too,
including a scene the clerk moved into. Decision 6 above ("not re-asked after a scene change") is superseded by this.

**B. Owner ruling: an obligation step is selected only by the compile.** `obligation_check` and `stated_meeting` are
`sole` predicates; `interpretRoute` skips a `compileOnly` candidate; `settleRoute` consumes it after a complete route. The
fact question is still asked and its answer recorded on the route row. §135.30.1, amending §135.26; pointer in
`docs/specs/scene-obligations-as-candidates-tickets.md`.

**The read's material (added to scope by the lead).** Every read of live gate #4 said `prescreen: {status: "not_run"}`:
its source-mode launch did not set `PI_COC_JEV_PRESELECT`, the Jev preselect setting defaults to off, and the engine runs
the read's prescreen only with it on (`runtime/jev/hybrid-engine.ts`, the read port). The replays set it (as the owner's
App has it, SL-00 inventory), so they put 5–10 materials in front of the compile where the live table put none. The read
row now names the reason (`preselect_off` etc., §135.6). Not changed: whether the hybrid engine's read should ignore the
setting (the setting is the user's, the engine is opt-in, and the stub-port tests drive the read without it); a live gate
of this engine should launch with `PI_COC_JEV_PRESELECT=1`. **Turn 2's ask 0.35:** the ask rows on gate #3's and gate #4's
morgue states are byte-identical (`{"demand": "Access to the Globe clippings", "guards": ["clue globe-unpublished-story
(An unpublished 1918 feature …)", "clue macario-tragedy (…)"]}`, the clue's summary, the handout's name); the obligation row
has no play-language label (`kernel-ts/read/obligations.ts` issues the module's `name` only) and the guarded clues are
unrevealed (no `clue_labels`), so there is no kernel label to use; the addressee rows differ only by the table's own labels.
The replay without the prescreen reproduces the live distribution (`none` 0.35–0.39 / obligation 0.26–0.31 / clue
0.18–0.22, 0/5 selected); with it, obligation 0.82–0.87, 5/5.

**Replays** (pre-registered in `e0d421251`; tables in `RESULTS-20260923.md`, "sl13b"): gate4-t1 move by the compile 10/10
(on/off), the morgue check 0/10; gate3-t1 move 10/10, check 0/10; gate3-t2 check 5/5 with the material, 0/5 without;
gate3-t3 move 10/10. Registered miss: gate4-t1 LLM steps 4, not ≤ 3 (the instrument's delivery path; the live table's
count was 4 too). **Finding for the owner:** where the declaration names what the gate guards without addressing its keeper
(gate #4 t1, gate #3 t1), the ask clears on the obligation in 20/20 runs (0.60–0.97) and the addressee's cleared `none` is
the only thing that keeps the check from being selected and refused as it was live.

**Mutations** (each applied, the four covering files run -- `single-loop-compile`, `scene-obligation-candidates`,
`single-loop-binding`, `single-loop-domain-policy` -- file restored; all killed):

| mutation | file | failing tests |
| --- | --- | --- |
| MA1 the compile only before the run's first route (the parent's rule) | `step-policy.ts` | 3 (incl. the gate #4 turn-1 test) |
| MA2 `compiledOver` never recorded | `step-policy.ts` | 5 |
| MA3 `compileReaches` ignores the keys already compiled | `route-compile.ts` | 5 |
| MA4 never a second compile in a run | `step-policy.ts` | 1 |
| MB1 the route's `seeks` selects again | `step-policy.ts` | 4 |
| MB2 `obligation_check` not sole | `route-compile.ts` | 4 |
| MB3 `stated_meeting` not sole | `route-compile.ts` | 1 |
| MB4 a compile-only candidate not consumed after the route | `step-policy.ts` | 1 |

The new test file run against the parent's code (`db056b144`, scratch worktree, `compileOnly` import dropped): the gate #4
turn-1 test fails ("the compile runs before the next route": `route`), as do the ruling-B test and the amended
"route earlier in the run" case.

**Suites** (leehow-pc): `test:ext` 2842/2842 at `e715c2cdf`; loop suites 105/105 at `e0d421251`. pytest not run: nothing the
kernel reads changed (`kernel-ts/`, `content/` untouched).

**Also seen:** gate #4's sidecar repository has no `turn 1:` commit; turn 1's record landed in the `turn 2:` commit
(`28b1a51`). `gate-fixture.mjs` now takes the oldest commit holding the record; the cause is not investigated here.
