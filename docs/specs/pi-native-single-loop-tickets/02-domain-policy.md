Status: ready-for-human
Stage: SL-02
Spec: docs/specs/pi-native-single-loop.md

# SL-02 — Migrate the domain policies; the plan is no longer the entry

Move table evidence (the prescreen), ordinary resolve/apply and the routing fan-out into the RunPolicy; make the plan an optional artifact; remove `submit_plan_packet` from the hybrid tool set; one tool catalog for the LLM and Jev; `infer(bind)` for open parameters.

## Depends on

- SL-01 accepted.

## Scope

- Candidates from real state only (kernel apply options with availability, scene assets, uninstroduced people under the capsule's label, Mod pending contacts, ordinary check with the closed binder, active-session families, located entities); no internal tags; consumed keys.
- Read first, re-read after a scene change; the prescreen allowance becomes the run's Jev budget.
- Jev's own tools (read more, locate, bind); the LLM fills open parameters when Jev chose the operation.
- `IntentBinding` required, `Requirements` and `PlanArtifact` optional; complex inputs get a `PlanArtifact` inside the run, never a second executor.

## Rulings that bind this ticket (spec, "Rulings")

- The clerk's authority list (a–d) and the boss-only list are the candidate policy; `needs_player` never becomes an `ask` without the Keeper.
- Keeper batches with order and one success/failure branch per step; a fallen branch returns to the Keeper.
- Clerk steps are committed at once and listed in the capsule as "clerk did"; reversal is an explicit Keeper operation.
- Research item (decide by measurement, report before closing): whether a fully-bound, kernel-issued, Jev-selected operation still passes §32 admission, or whether §32.10's typed admission (or none) is enough for policy-origin operations.
- The compose step streams raw prose; the delivery card replaces it in place when the turn closes.
- **Parameters-only steps never go to the LLM** (spec ruling of the same name): the combat/chase session families are candidates built from the kernel's session view (`turn_of`, `actions[]`, `pending_defense.options`), not an LLM proposal path. Determined steps (one legal action, damage, initiative advance) are `direct`; closed choices (the NPC's defence, its target when several) are `decide(bind)`; the LLM is asked only when the player's words leave the target or weapon open, or for the prose. Acceptance adds: a replay of a fight round from the 打斗测试 table closes with one LLM step (the compose) when the player names the target, and every non-prose step carries the kernel's issued row as its basis.

## Scene obligations (scheduled here; owner, 2026-09-23)

`docs/specs/scene-obligations-as-candidates.md` (rulings Q1–Q7 recorded there) and its tickets `scene-obligations-as-candidates-tickets.md` are part of this stage:

- SO-01 (shape, validator, the haunting's morgue pair), SO-02 (kernel issuance in `table.apply.options.obligations`, settlement by flag through `resolve action.obligation`) and SO-03 (reader extraction) are SL-02 workers that do not touch the loop; they may start while SL-01 is still open.
- SO-04 is this ticket's candidate builder: clerk authority (e) = the next step of an open stated obligation; precedence `person → mod_check → obligation_check → core-check → clue/handout → move`; `guarded_by` candidates withheld; `reaction: "preordained"` suppresses the Mod contact-check candidate for that pair; hazards never become candidates; clerk-origin refusals stay off the Keeper's budget.
- The §32 research item above reports obligation checks as their own row (`basis: obligation <handle>`).

## Acceptance (design §13 SL-02 gate)

- A simple turn has no forced LLM plan; the turn-3 replay reproduces 8/8 live actions with ≤ 5 LLM steps against the product driver; special families reach the LLM only for open parameters and the prose (see the parameters-only ruling); every route distribution is in telemetry.
- With SO-01/SO-02/SO-04 on the branch (ruling Q6): on the fixture variant with the morgue pair authored, the meeting with Arty and the gatekeeper's check are selected `now` in 3/3 runs; a passing roll closes in ≤ 3 LLM steps (target 2); a failing roll is recorded as the Keeper improvising past an open obligation, not scored.

## Comments

### 2026-09-23 — implemented on `claude/sl02-domain-policy-20260923` (from 0.9.5a `6428aa283`)

**Commits.**

- stage A `94f7dde65`: contract, candidates, clerk authority, session steps;
- stage B `59d2cbb18`: read step, clerk writes through the gateway, batches, projection;
- stage C `bbf75a033`: product-driver replay instrument, fight-round fixture, pre-registration;
- `856f3a5c8`: the `llm_bound` fix and the scored runs;
- `8d3afa7f3`: the registered re-run;
- `bb40b28a0`: prototype policy tests;
- `f63b81378`: cherry-pick of `8a9340d0e`, the `test_mods.py` repair, at the coordinator's offer;
- the commit that carries this comment.

**Contract: §135.** §133 is taken on this branch and §134 on another branch, so this section is §135. Its parts:

- §135.2: candidates;
- §135.3: clerk authority;
- §135.4: one tool catalog and the policy-origin write;
- §135.5: batches and the plan artifact;
- §135.6: read first, and the prescreen as the run's read;
- §135.7: telemetry;
- §135.8: the `coc-clerk` note;
- §135.9: what is left;
- §135.10: the §32 research item.

**Where things live.**

- **Candidate builder:** `runtime/jev/candidates.ts`, moved from the prototype, which now re-exports it. It covers
  kernel `apply.options` with availability, scene handouts, people not yet introduced under `untold.label`, Mod
  pending contacts, the ordinary check with its binder, located entities, consumed keys, and the combat/chase
  session steps built from the kernel's session view. It also holds the SO-04 seam `obligationCandidates()`,
  which returns nothing.
- **Policy:** `runtime/jev/step-policy.ts`. It holds `CLERK_AUTHORITY`, the forced steps, closed variant binds
  (an NPC's turn), option descriptions, `PlanArtifact`/`Requirements`/`IntentBinding` in the state, and
  `batch_fallen`.
- **Read step, write path and projection:** `runtime/jev/hybrid-engine.ts`.
  - The read port runs the kernel reads and `prepareKeeperSupport` inside the run. It hands its packet to the
    context hook (`coc:run-prescreen`), and the hook runs no prescreen on hybrid (`coc:loop-engine`).
  - The operations port sends a clerk write to `coc:operation-dispatcher` → `dispatch`, with a
    `HostOperationContext` of origin `policy`, and runs the Keeper batch branch for the model's own calls.
  - The projection port writes the `coc-clerk` note.
  - The decision port handles route, bind and the ordinary binder, and writes `lane: "route"` rows.
- **Origin tracing:** in `extensions/kernel/canonical-operation-dispatcher.ts` (`hostOrigin`) and
  `extensions/kernel/index.ts` (admission and tool rows).
- **The rest:** the S0/TaskRuntime refusal on hybrid is in `runtime/launch.ts`; `closedNoise` for `coc-clerk` is
  in `extensions/table/context-policy.ts`.

**Verified (shown, not claimed).**

- **Tests.**
  - `node --test experiments/single-loop-routing/loop.test.mjs`: 12/12 (the prototype's 10 plus 2: a forced step
    runs before any route; a closed variant bind runs the chosen action).
  - `npm run test:ext`: 2595/2595. The baseline at `6428aa283` was 2583. The new tests are 6 in
    `single-loop-candidates.test.mjs`, 5 in `single-loop-domain-policy.test.mjs` and 1 in `launch.test.mjs`.
  - `single-loop-run-driver.test.mjs` changes one assertion: the route now carries one need per candidate. An
    earlier full run had one failure in `lanes.test.mjs` ("等响应头时被砍", a timing race on the lane's
    request/response rows). That file passes 3/3 on its own, and the next full run was green.
  - `uv run --frozen python -m pytest tests/kernel tests/play`: 1614 passed, 1 skipped, exit 0. The three `tests/kernel/test_mods.py` failures of `6428aa283` are gone with the cherry-picked `8a9340d0e`; nothing else was red.
  - Legacy: no legacy test was changed. Every legacy-path code change is gated on a policy-origin frame or on the
    `coc:loop-engine` announcement.
- **Seam tests: real kernel.** Read first. The route runs over candidates with no internal tag. The clerk's move is
  the Keeper's own `apply` through the gateway, with the `tool_call`/`tool_result` hooks, admission (`authorized`,
  `origin: "policy"`), the Mod hooks on the minted `t2-c1`, and the Keeper's narrate on `t2-c2`. The scene change
  is read again before the next route. The `coc-clerk` note lists the move with its receipts and `basis`. Route
  distributions are retained.
- **Seam tests: fake kernel.** A fallen batch step returns to the Keeper without a route question; the skipped
  call is answered, never run. No `submit_plan_packet` on hybrid (legacy keeps it). No clerk write without an
  IntentBinding or without clerk authority. The context hook injects the run's packet and runs no prescreen.
- **Pure and emitted-kernel tests of the combat split.** An NPC's pending defence is forced: a Jev bind over the
  kernel's options, direct with one option, an LLM bind on `unknown`. An NPC's turn is a closed Jev bind over its
  issued actions, and a manoeuvre's open kind goes to the LLM. The player's declared attack is direct with one
  target, a closed bind with several, and runs once per turn. The player's answer to an already-open choice
  settles that choice.

**Replays against the product driver.** The instrument is `run.mjs --llm replay` → `product-entry.ts`; details are
in `experiments/single-loop-routing/RESULTS-20260923.md` (pre-registered in `bbf75a033` before the scored
runs; the instrument-development runs are listed there).

| fixture | arm | runs | live actions | LLM steps | clerk steps | Jev calls | wall |
| --- | --- | --- | --- | --- | --- | --- | --- |
| turn3 | lane | 3 | 8/8 ×3 | 5 ×3 | move (route `now` 0.67–0.81) | 19 / 9 / 9 | 7.1–9.4 s |
| turn3 | jev | 3 | 8/8 ×3 | 5 ×3 | move (0.74–0.80) | 19 / 9 / 9 | 8.6–10.9 s |
| fight-round | lane | 3 | 3/3 ×3 | 2 ×3 | player's attack, NPC's attack | 10 / 5 / 5 | 4.6–6.6 s |
| fight-round | jev | 3 | 3/3 ×3 | 2 ×3 | same | 10 / 5 / 5 | 5.3–6.5 s |
| fight-round (re-run after the `llm_bound` fix) | lane | 3 | 3/3 ×3 | 2 ×3 | same | 10 / 7 / 6 | 5.8–6.7 s |

- **Turn 3: acceptance met.** 8/8 live actions, ≤ 5 LLM steps, 3/3 (6/6 with the typed arm), and every route
  distribution in `lane: "route"`. The live turn took 6 LLM calls.
- **Fight round: the ticket's "one LLM step" is refuted in 6/6 scored runs; the result was 2.**
  - The clerk ran the player's attack (route `now` 0.90–0.94; `target` and `weapon` issued with one value each).
  - Jev answered `unknown` (0.54–0.66) on the NPC's defence every time, so the defence went to an LLM bind.
  - Jev bound the NPC's counter-attack (`combat:attack` 0.67–0.74), and the clerk ran it.
  - The player's own defence opened during the run, so the Keeper handed it back with `ask`.
  - The live turn took 5 LLM calls (56.6 s of model time).
  - Every clerk step carries its kernel row (`basis.path` `context.session.actions[0]`). The LLM-completed defence
    was missing its `llm_bound` row in the scored runs. That is fixed, and the pre-registered re-run shows it
    3/3 (`context.session.pending_defense`).

**The §32 measurement.** 18 policy-origin writes:

- **Exempt: 6.** §32.1 exempts every NPC attack, whose actor is not an investigator.
- **Reviewed: 12.** 6 moves and 6 player attacks. **Refused: 0.**
- **Lane arm.** The live lane's recorded verdicts on the Keeper's same proposals, replayed: authorized. Live they
  took 2 109 ms (the move) and 18 250 ms (the attack).
- **Typed arm (§32.10).** `authorized` on all 6 reviewed clerk writes, with confidence 0.86–0.89 on the moves and
  0.48–0.56 on the attacks, all under the 0.9 family minimum. So every one fell back to the lane. The typed review
  costs 313–376 ms. On the model's own writes in the same runs, typed confidence was 0.15–0.44, and the typed line
  verdict disagreed with the live lane on 7 of 12.
- **Caveats.**
  - n is 2 distinct clerk writes, each seen 6 times.
  - The lane arm's verdicts are for the live Keeper's wording of the same action. The clerk's move carries no
    `label`, `via` or travel minutes. Only the typed arm judged the clerk's exact lines.
- **No decision taken.** A policy-origin write passes §32 exactly as a model-origin one does (§135.10). The owner
  decides between §32, §32.10 typed (for which the family minimum would need re-reading for clerk writes), and
  none.

**Assumed, not verified.**

- **No live table.** The SL-02 stage gate is the owner's.
- **The Mods extension is not loaded in the replays.** Both fixtures have no queued Mod work at their pre-turn
  commits; the clerk's Mod hooks are asserted at the seam instead.
- **The replayed Keeper answers with the live Keeper's recorded calls.** Where a run diverged from the live turn,
  the replay cannot show what a live Keeper would have done. None of the scored runs diverged in its actions.
- **The Jev budget is the prescreen allowance, 12 s.** The runs used up to 19 calls; none hit the budget.

**Found on the way (outside SL-02, not changed).**

- The kernel's `pending_defense.options` includes `none` (`defenseOptions` in `kernel-ts/read/session-view.ts`).
  `ask kind: mechanics` refuses `none` as `unknown mechanics choice option`. The live Keeper passed the kernel's
  list, was refused, and spent one more model call, both times in the fight table (turns 6 and 8).
- A scene's handout asset is offered as a candidate on every turn, even after it was handed over. The asset rows
  carry no "shown" state, so the route question sees it each turn; it is judged "later" at 0.95–0.99.
- On hybrid, the prose close is delivered by the kernel extension's implicit narrate, and the run still ends
  `undelivered` in the run events. That is SL-03's, as SL-01 recorded.

**Left for SL-03.**

- The operation service with suspension and a durable journal: the run's journal is in memory, and recovery goes
  by `call_status` inside the run only.
- Scope frames.
- Delivery evidence for the implicit narrate.
- The compose step's raw-prose streaming, with the card replacing it in place (`03-operations-and-delivery.md`
  does not move it into SL-02).
- UI consumers of the clerk steps. The `coc-clerk` note and the run events carry them.

**Left for SO-04.** The obligation candidates at the empty seam, and the rule that clerk-origin refusals stay off
the Keeper's refusal budget. Today a clerk refusal is struck like any other.

**Scratch left behind.** None in the worktree. The instrument's workspaces are removed per run. The scored traces
are committed under `experiments/single-loop-routing/results/sl02-*`.

### 2026-09-23 — live-gate finding: the hybrid run did not own the turn close (fixed on `claude/hybrid-prose-delivery-20260923`)

**What the player saw.** On the installed `e1b4176d3`, campaign `game-b5367f88` (the-haunting, zh-Hans, Keeper
grok-4.7-build-fast low), the input asking Arty for the Corbitt clippings showed "3 steps · Thinking · resolve"
and then the §38 notice "no delivered result". Nothing reached the player.

**What the evidence says (session file and telemetry, read-only).**

- Turn 2 (the failed turn): the Keeper called `resolve` (Persuade 34 against 10, failed). The failure branch
  returned to the Keeper (`batch_fallen`). The provider's answer was `blocks: ["thinking", "text"]`: the Keeper
  had written the refusal. Two people were present and the draft carried no say token. So `message_end` dropped
  the text for the §40 speech steer (`lane: "speech"`, `steered: true`, `reason: "no_token"`), and the persisted
  assistant message kept only its thinking. Legacy would now steer once from `agent_end` and continue the run. On
  hybrid, `agent_end` fires after `runDriver` has returned, so the steer was only queued for the next input, the
  run ended `undelivered, prose:no_delivered_evidence`, and the notice went out. The prose was lost, not missing.
- Turn 1 (the declared move): the Keeper made its calls and then wrote prose with its lines wrapped. The kernel
  extension closed the turn with the implicit narrate (`narrate` rows `implicit: true`, `turn-closed`), and the
  player read it. The run did not see that narrate and logged `undelivered`: the logging gap SL-01 and SL-02
  recorded.

**The fix (contract §135.11, amending §135.9).**

- The implicit narrate stays where legacy has it, in the kernel extension's `message_end`, inside the driven
  infer step's own stream. It has to replace the draft before the message is committed (§34.14). A later driver
  step could only narrate a draft already on the transcript, and that would be a second delivery path.
- Before the run finishes without delivery evidence, the step policy runs one policy-origin `turn_close`
  operation. It asks the kernel extension's new `coc:turn-close` port for its verdict:
  - `delivered`: a narrate or ask committed this run, and the implicit narrate cites its own `call_id`. That is
    the run's evidence, and the run ends `delivered` with reason `implicit_narrate`.
  - `steer`: the steer legacy's `agent_end` sends, picked by the same `takeTurnCloseSteer` and spent once per turn.
    The policy runs one more `infer(compose)` with that `coc-host` message prepended.
  - `none`: the run ends `undelivered` with reason `turn_close_<reason>`.
- On the driven engine, `agent_end` no longer sends a steer, so no stale nudge reaches the next input.
- The kernel's steer is not a `finishTurn` continue (no product extension returns one), so `turn_boundary_continue`
  was not the channel. The policy acts on the port's verdict instead.

**Verified.** Unless noted, these runs are on the merged state (0.9.5a `a9ffec252` merged in).

- `tests/extension/single-loop-turn-close.test.mjs`, 6 cases (hybrid seam, fake kernel):
  - a text-only last step: `delivered` with reason `implicit_narrate`, a `table.narrate` with `implicit: true`
    carrying the prose, and the evidence's `call_id` equal to it;
  - a step that called `narrate` itself: unchanged (steps `operate, decide, infer, operate, finish`, no
    `turn_close`);
  - live turn 2's shape (a failed check, then a bare draft with a person present): speech-steered once inside the
    same run, then delivered;
  - a thinking-only step after a failed check: steered once ("turn not closed"), then delivered;
  - a prose-only turn with no tool call: floor-steered once, and the second leg's nothing delivers the dropped
    draft;
  - nothing twice: `undelivered` with reason `turn_close_steer_spent`, the §38 notice, and no steer queued.
- Mutations, each run against the new file. All four were killed:
  - no `turn_close` step: 5 of 6 fail;
  - the verdict hides the implicit delivery: 3 of 6 fail;
  - the implicit narrate dropped on the driven engine: 3 of 6 fail;
  - the policy ignores the steer: 4 of 6 fail.
- `npm run build:runtime`: ok.
- `npm run test:ext`: 2753/2753 on the merged state. Before the merge, 2734 (2728 + 6); one run under a load
  average of 75–130 had timing failures that pass alone.
- `uv run --frozen python -m pytest tests/kernel tests/play`: 1691 passed, 1 skipped on the merged state (1676 passed, 1 skipped before the merge).
- The SL-00 inventory recounts `agent_end`'s `sendHost` from 5 to 1 (legacy only).

**Not verified.**

- No live table. The owner's gate re-runs it.
- The `agent_end` guard (no steer after a driven run) is covered only where the run's `turn_close` already spent
  the steer. A driven run that ends on a failed or aborted model step (no `turn_close`) is not exercised.

### 2026-09-24 — live gate #3 on 0.9.5a `19965521e` (driver.py, hybrid-v1, Keeper grok-4.7-build-fast low, fresh haunting campaign `gate3-haunting-2329`)

Pre-registered in the session scratchpad (`live-gate-3-preregistration.md`) before the table opened. Three
turns, one sentence each, all delivered, all under 60 s of wall time. Gate #2's stalled sentence went through.

| turn | player | wall | model calls (s) | admission | Jev route | clerk executed | LLM steps |
|---|---|---|---|---|---|---|---|
| 1 | accept the commission, go to the Globe morgue | 58.2 s | 5 (36.1) | lane 7.5 + 6.9 s | `now` 0.61 on the move, confidence 0.42 < gate → `low_confidence`; then `ask_llm` ×2 | nothing | 5 |
| 2 | ask the editor for the Corbitt clippings | 29.5 s | 2 (16.8) | lane 2.2 s | seeks question `not` 0.54 / `seeks` 0.31 / `unknown` 0.15 → `ask_llm`; then `low_confidence` | nothing | 2 |
| 3 | back to Knott's office, grab him and punch him | 58.9 s | 8 (44.4) | lane 3.3 + 2.3 s, one exempt | move selected 0.90 → executed; disposition `avoids_fighting` 0.67, confidence 0.59 < gate → `clerk_unbound`; then `ask_llm` ×2, `low_confidence` | `apply:move:commission-briefing` (bind `to` stated); `resolve:combat:defend:steven-knott` with `defense: dodge` stated from `pending_defense` (no Jev, no LLM) | 8, of which 3 produced only a `look` |

Scored against the pre-registration:

- (1) startup `loop_engine: hybrid-v1`, no manual session edit: **met**.
- (2) turn 1 delivered ≤ 60 s, ≤ 5 model calls: **met**; the Keeper proposed one `lookup`, refused by the
  45 s budget (`model_batch`), so 0 read-only calls executed and 1 proposed.
- (3) turn 2 delivered ≤ 60 s, no `infer(bind)` anywhere on the table: **met**. The obligation candidate
  `resolve:obligation:globe-clippings-access` reached the route (offered in turn 1 s6, turn 2 s2, turn 3 s2) but
  was never selected, and turn 2 has no bind row because the clerk executed nothing. **Product finding, corrected 2026-09-24:** the
  Keeper's `core-check:ordinary-check` Persuade (44 vs 40, failure, bonus 1) did carry `action.obligation`;
  the attempt was recorded (`settled: false`, the book's failure and push lines) and the obligation stays
  `open` because a failure does not settle it. The owner's first reading ("bypassed, unpaid") was a misread of
  a truncated dump. SL-14 still lands for the narrower gap: the same check without the claim counted as nothing.
- (4) stalled stream: not exercised, no stall occurred.
- (5) budget rows in turns 1 and 3 (compose at 47.1 s and 45.2 s), both runs still `delivered`: **met**. Turn 3
  paid a second compose after `turn_close` (`audit-repair`, 4.8 s), which is where its 55 s came from.
- (6) admission: every clerk write went through the `lane` path (deepseek-v4.1-flash), none `typed`: **not met**.
  The 7.5 s lane in turn 1 reviewed a mixed batch (clue, handout, cash, item, move, time), outside the
  bookkeeping-only rule; the move-only batch in turn 3 took 3.3 s.
- (7) fight: Knott's defence executed by the clerk from the standing row with no Jev or LLM step: **met**; his
  disposition asked of the Keeper once after Jev's 0.59 (`avoids_fighting` 0.67 of the mass): **met, allowed**;
  round wall 58.9 s: **met**; LLM steps ≤ 2: **not met** (8; the turn also carried the move and the provocation).
- (8) nothing fabricated: **met**.

Reading. The 60 s line holds only because the budget cuts the run at its compose; the Keeper still does the
work. In all three turns Jev's answer sat just under a gate on a different question each time (0.42 on a
declared move that scored 0.93 on gate #2's table with the same sentence, 0.30 on the seeks question for a
sentence that is the request, 0.59 on a disposition whose mass was 0.67), so the clerk was handed one move and
one standing defence in three turns. The variance of the route confidence at the gate, not model speed, is the
bottleneck; that is what the proposed typed-feature scoring (SL-13) is for. Two follow-ups filed: an ordinary
check on an obligation's approach made without the claim counts as nothing (SL-14; the gate's own check did
carry the claim, see above), and a `look` still costs one full model round each (three in turn 3, 15.4 s for
the first; SL-15).

Evidence: `chatrpgv4-wt-integ-sl/.coc/campaigns/gate3-haunting-2329/{telemetry.jsonl,turns/000{1,2,3}.json}`
and `.coc/playtests/gate3-haunting-2329-20260924T032940Z/`.

### 2026-09-24 — live gate #4 on the integration branch `db056b144` (SL-13/14/15, driver Linux fix, pytest parallel; driver.py, hybrid-v1, grok-4.7-build-fast low, campaign `gate4-haunting-0214`)

Pre-registered in the session scratchpad (`live-gate-4-preregistration.md`). Same three sentences as gate #3.

| turn | wall | model calls (s) | compile | clerk executed | Keeper | delivered |
|---|---|---|---|---|---|---|
| 1 accept + Globe | 79.1 s | 4 (46.2) | **no compile row** | move by the route (0.88); Arty staged (stated meeting); obligation check selected by the route's seeks 0.55 → **refused by admission** (not_authorized: the player said nothing about Arty) | adjudicate after the refusal, its own resolve refused too; compose ×2 | **no**: speech steer dropped the first draft, the second draft was never delivered, `turn_close_steer_spent:no_delivered_evidence`, turn stranded |
| 2 clippings | 58.8 s | 4 (39.7) | ran; ask feature obligation 0.35 / none 0.36 → nothing fired | nothing | first-impression (Appearance 100, fumble) then Persuade with the claim (98, fumble): barred from the morgue per the book | yes |
| 3 punch Knott | 44.2 s | 7 (25.7) | selected the move at 0.98, act combat 0.76 | move; Knott's dodge (stated); disposition Jev 0.31 → Keeper | attack, session, one source lookup (refused) | yes |

Scored: (1) startup met. (2) turn 1: compile absent, 79 s, undelivered: **not met** on three lines; calls ≤ 4 met. (3) turn 2: the compile ran but the ask did not clear; the roll carried the obligation (claimed by the Keeper); 58.8 s and 4 calls: **not met** on wall and calls. (4) turn 3: clerk move by compile, Knott's defence by the clerk, carried views present (scene 3,008 B; Knott's card 3,865 B with `mechanics`; session), wall 44.2 s: **met**; looks 0: **not met** (one `lookup kind: source` for "Steven Knott", refused; not a card look); calls ≤ 5: not met (7). (5) `infer(bind)` = 0 and no stall: met; every turn delivered: **not met**. (6) met.

Findings and where they go:
- **The second draft after the speech steer is dropped on the driven path** (turn 1). Top severity: the player saw nothing for 79 s while the Keeper wrote twice. Fix in progress on `claude/sl16-20260924`.
- **The compile did not run on turn 1** (no row) although move rows existed; the route selected the move later. Follow-up on `claude/sl13b-20260924`.
- **Premature obligation selection**: the route's seeks question selected the clippings check on the travel sentence; admission refused it correctly at ~20 s cost. Ruling: an obligation check is selected only by the compile's predicates; the seeks question no longer selects. Same branch.
- **Ask-feature variance**: obligation 0.35 vs none 0.36 for the sentence that is the request (replay 0.71–0.79). A measurement worker is testing the language gap (English rows vs Chinese declaration) and option count; no tuning until measured.
- **Turn 3 improved** over gate #3 (58.9 → 44.2 s, 8 → 7 calls, 3 looks → 1 source lookup) and the carried card reached the Keeper whole enough to act.

Evidence: `chatrpgv4-wt-integ-sl/.coc/campaigns/gate4-haunting-0214/{telemetry.jsonl,turns/000{1,2,3}.json}`, `.coc/playtests/gate4-haunting-0214-20260924T061454Z/`.
### 2026-09-24 — live gate #4 finding: a steered second leg the kernel refused stranded a turn written twice (fixed on `claude/sl16-20260924`, from `db056b144`)

**What the player saw.** Campaign `gate4-haunting-0214`, turn 1, run `run-01a0d20e-6088-7125-b1ab-0973c812e22e`:
79 s, then "(no assistant text this turn)". The Keeper had written prose twice. The turn record `0001.json` has
`closed_by: "stranded"` and empty text.

**What the evidence says (telemetry rows with `"turn": 1`, read-only).** s14 `infer compose` (`run_budget`)
produced text. The host dropped it for the §40 speech steer (`lane: "speech"`, `reason: "no_token"`, Arty Wilmot
present). s15 `turn_close` answered `steer`, `kind: "speech"`. s16 `infer compose` (`turn_close:speech`) produced
text again (10.4 s). **The dispatch brief's "no implicit narrate row" was a misread:** telemetry row 243 is
`{tool: "narrate", call_id: "t1-c8", implicit: true, ok: false, code: "needs", reason: "repeated_line"}`. The
steered leg wrapped its lines, one of them repeated a line already said at the table, and the kernel's §113 D check
refused the Keeper-wrapped repeat. The hook's catch (`extensions/kernel/index.ts:4662–4668` at `db056b144`) set
the `audit-repair` delivery fix, cleared the held first draft (`floorDraft`) and dropped the text without a delivery
row. s17 `turn_close` then hit `takeTurnCloseSteer`'s `if (state.steeredThisTurn) return { none: "steer_spent" }`
(`:1222`), which comes before the delivery-fix branch (`:1234`). The repair was never handed back, the first
draft was gone, and the run ended `turn_close_steer_spent:no_delivered_evidence`. Legacy shares the seam: its
`agent_end` takes the same `takeTurnCloseSteer`, so the same turn strands there too.

**The fix (contract §135.11, addendum 2026-09-24).**

- In `message_end`, when the steer is spent and a floor or speech steer's dropped draft is held, a refused
  implicit narrate of the second leg is followed by one implicit narrate of the dropped draft: a new `call_id`, the
  same Mod hooks and review, and §128.3 attribution. A host-wrapped repeat is a finding, not a refusal. If it
  lands, the turn close answers `delivered` with that `call_id`. If it is refused too, the repair is set and the
  draft is dropped as before. The bound stays one steer per turn and one extra model step per run. A continuity
  review outage still pauses and is never retried.
- Every drop path in the hook records a `lane: "delivery"`, `ok: false` row with its reason. The new rows are
  `text_beside_tool_calls`, `review_unavailable`, `preparation_wait`, `reading_wait`, `owes_ask`,
  `floor_steer`, `speech_steer` and `review_paused`, plus `implicit_narrate_refused` and `steered_leg_refused`,
  which carry `code`, `kernel_reason` and `call_id`. The `turn_close` `none` row carries `unsent_fix` when a
  repair was set that the spent steer could not carry.

**Tests.**

- `tests/extension/single-loop-turn-close.test.mjs` (hybrid, fake kernel, `FAKE_KERNEL_ERRORS` `repeated_line`):
  - the live shape: the steered leg is refused, and the first draft is delivered, `implicit_narrate`. The
    `turn_close` row names the fallback's `call_id`, and the `speech_steer` and `steered_leg_refused` rows are
    present. Fails on `db056b144`.
  - both refused: `undelivered`, rows `[speech_steer, steered_leg_refused, implicit_narrate_refused]`,
    `unsent_fix: "audit-repair"`. Fails on `db056b144`.
  - prose twice without a token: the second leg is delivered. Passes on `db056b144`, which is what showed the
    brief's hypothesis was not the cause.
  - a speech-steered second leg with nothing: the dropped draft is delivered. Passes on `db056b144`.
  - the floor test now also asserts its `floor_steer` row, and a new case covers `text_beside_tool_calls`.
- `tests/extension/speech-attribution.test.mjs` (legacy engine, **real kernel**): the opening wraps Knott's
  line, and the player turn replays live gate #4. A bare draft is speech-steered, and the steered leg wrapping the
  same line is refused by §113 D (`repeated_line`). The dropped draft is then published with the words untouched,
  and `0001.json` has `closed_by: "narrate"`.
- Mutations, all killed:
  - fallback removed: 3 fail (both gate #4 hybrid cases and the legacy real-kernel case);
  - the `steered_leg_refused` row not recorded: 3 fail;
  - the `implicit_narrate_refused` drop unrecorded: 1 fails;
  - the `speech_steer` drop unrecorded: 2 fail;
  - `unsent_fix` dropped: 1 fails;
  - `floor_steer` and `text_beside_tool_calls` unrecorded: 2 fail.

**Suites (leehow-pc).**

- `ext`: `tests 2845 / pass 2845 / fail 0` (exit 0, 123 s).
- `loop`: `tests 107 / pass 107 / fail 0` (exit 0, 25 s).
- `py`: not run, because nothing the kernel reads was touched (`kernel-ts/` is unchanged).

**Not verified.**

- No live table.
- The `preparation_wait`, `reading_wait`, `owes_ask`, `review_unavailable` and `review_paused` rows have no test
  of their own.
- The fallback draft goes through §128.3 attribution. With Jev unreachable, that draft goes out without the say
  tokens the steer asked for.

### 2026-09-24 — live gate #5 on the integration branch `a575e01e6` (gate #4 + SL-16 turn-close fallback + SL-13 follow-up + prescreen on via `PI_COC_JEV_PRESELECT=1`; driver.py, hybrid-v1, grok-4.7-build-fast low, campaign `gate5-haunting-0259`)

Pre-registered in the session scratchpad (`live-gate-5-preregistration.md`). Same three sentences. First driver table with the prescreen on, matching the App.

| turn | wall | model calls (s) | prescreen | compile | clerk executed | delivered |
|---|---|---|---|---|---|---|
| 1 accept + Globe | 66.1 s | 3 (43.4: 24.8 commission + 6.9 + 11.7 compose) | ran at the first read (7 Jev, 5 materials, 3.1 s); `allowance_spent` at the second | after the clue unlock: ask = obligation 0.92, addressee none 0.81 → correctly no check | nothing (the Keeper bundled the move with the commission's six effects; lane 7.7 s) | yes (`text_beside_tool_calls` drop recorded, then implicit narrate) |
| 2 clippings | 41.4 s | 3 (25.5) | **fallback `binding_changed`, 0 materials, 6.9 s spent** | ask none 0.20, addressee unclear 0.21 → nothing | nothing | yes; Persuade 65/40 failure with the Keeper's claim; a speech steer (`unwrapped_quote`) cost one extra compose |
| 3 punch Knott | 58.7 s | 5 (36.7) | ran twice (6.1 s finish_partial + 2.4 s timeout) | move 0.98 → executed; second compile addressee Knott 1.0, act combat 0.90 but no target rows outside a session → route | move; Knott's defence (fight back, stated); disposition Jev 0.28 → Keeper (9.8 s) | yes; looks 0; carried scene 3,013 B + Knott's card 3,725 B with mechanics + session |

Scored: (1) met, with turn 2's fallback noted. (2) compile row, no premature check, delivered: met; wall 66.1 s and clerk move: not met (the commission turn's floor is the Keeper's own 24.8 s bookkeeping call). (3) delivered, ≤ 45 s, obligation on the roll: met; compile selection, clerk check, ≤ 2 calls: not met, all downstream of the prescreen fallback. (4) all met (first time). (5) all met: every turn delivered, every drop has a reason row, no `infer(bind)`, no stall. (6) met.

Findings:
- **Prescreen `binding_changed` fallback** (turn 2): assertSnapshot in extensions/table/prescreen.ts throws when any of 13 binding keys moved during the run; turn 1's post-turn lanes (npc, journal, memory, continuity review) land while turn 2's prescreen runs. Without material the compile is a coin flip (ask 0.20 here, 0.92 with material on turn 1). Fix in progress on `claude/sl17-20260924`.
- **Prescreen cost**: 3.1 s, 6.9 s (wasted), 6.1 + 2.4 s per turn; `loop_packing failure: packing_limit` on every round. Same branch reports it.
- **Disposition never binds** (0.31 / 0.28 / 0.59 across gates): each fight pays a ~10 s Keeper step for it. A rules default from the card (SL-15 already carries `combat_disposition`/`combat_tactic`) is the SL-12-shaped fix. Follow-up to file.
- **Attack predicate needs a session**: outside a fight the compile has no target rows, so the first punch always goes to the Keeper (13.6 s here, with a refused resolve+apply). Follow-up: target rows from the people present when act = combat.
- **Admission lane** 2.5–7.7 s per write, still never `typed`.
- Gate #3 → #5 on the fight turn: 58.9 → 44.2 → 58.7 s (this one carried a real hit and Knott's fight-back), 8 → 7 → 5 calls, looks 3 → 1 → 0.

Evidence: `chatrpgv4-wt-integ-sl/.coc/campaigns/gate5-haunting-0259/{telemetry.jsonl,turns/000{1,2,3}.json}`, `.coc/playtests/gate5-haunting-0259-20260924T065940Z/`.
### 2026-09-24 — live gate #5 finding: a post-turn lane's write voided the read's whole prescreen (fixed on `claude/sl17-20260924`, from `a575e01e6`; contract §124.11, §135.6 addendum)

**What happened.** Campaign `gate5-haunting-0259`, turn 2, run `run-01a0d238-db4d-72e1-ae72-5c2b2105bb58`, read s1. The prescreen
took 6.8 s and 12 Jev calls. The locate judged 277 cards, and the loop took five steps (follows `globe-clippings-access`,
`arty-wilmot`, `globe-archivist` and `ruth-blake`, and one rule read) and then finished `sufficient`. It ended as
`{status: "fallback", fallback: "binding_changed"}` with 0 materials. The compile then ran without material: the ask feature
got none 0.2 and addressee unclear 0.21, so the clerk did nothing.

**Which key changed, and who wrote it.**

- The key was `stateStamp`. It was not `memory_revision`, `npc_revision` or `records_revision`: turn 1's journal and memory
  lanes landed at 07:01:39Z and 07:01:41Z (events 38–39), before turn 2 started at 07:02:16Z.
- The writer was the npc-voice lane. Arty Wilmot's voice job was queued after turn 1, and its model call started at 07:01:53Z.
  The lane finished it at 07:02:23.429Z (`telemetry.jsonl` line 266). `voice.submit` (`kernel-ts/voice/index.ts:55-57`) writes the package's dossier into `world.json`
  (`kernel-ts/voice/jobs.ts:241`, `campaign.writeWorld`). That is event 42, `dossier-established` at 07:02:23Z, and the
  `npc-voice/.../arty-wilmot.json` mtime is 07:02:23Z. `world` is part of `stateStamp` (`kernel-ts/read/workspace.ts`
  `stateStamp()`).
- The prescreen's `fallback` row (line 269) came about 50 ms later, after the round-6 `finish`. Its `validation_ms` was 0, so the throw
  came from the final validation.
- The owner's check over the retained keys (graph units and a rule clause, which depend on `source_revision` and
  `rules_revision`) passes when only `stateStamp` moved. The host's own comparison at `extensions/table/prescreen.ts:633-634`
  re-imposed `stateStamp` and threw the result away.
- The other writes in the window (`npc/responses/*.json` at 07:02:19Z, `npc/jobs/*.json` at 07:02:20Z) are in no binding.
- The dispatch hypothesis, "turn 1's memory, npc or records lanes", was wrong on the lane. It was right on the shape: a
  post-turn lane landing during the next read.

**Fix (contract first: §124.11, and the §135.6 addendum).**

- *Run keys void the result:* campaign, worldline, loop, turn, `source_revision`, `rules_revision`, scene and adapter, plus
  `catalog_revision` on a page. The fallback row, and the read row, name the key.
- *Volatile keys are re-checked per material:* `stateStamp`, `memory_revision`, `npc_revision` and `records_revision`.
  - Loop pages are bound to the run keys only, so a lane's write does not refuse a page.
  - The final owner check runs over the full original binding. The kernel's stale answer now names `stale_keys`, the
    requested material keys a change reaches.
  - The host drops exactly those materials. Each becomes a public gap `binding_changed` with its read, and the key is recorded
    privately in `gap_details` and `pending_reads`. A memory finisher's `refresh` drops the memory materials it covers.
  - That one check is the only re-check. There is no retry.
- *Legacy v1 catalog:* still voided by any change.
- *Read row:* `jev_calls` counted only a prepared prescreen, so gate #5 said 0 while 12 had run, and the run's `jevCalls` budget
  undercounted. It now counts the calls of a prescreen that fell back too. The prepared row carries `binding_refresh`.

**Tests.** `tests/extension/prescreen-binding-drift.test.mjs` runs the real kernel on the Haunting's opening. The lane writes go
through `voice.submit` and `table.apply`. It has six cases, and all six fail on `a575e01e6`:

- the gate #5 shape publishes;
- a page after the write is served;
- only the stale investigator `look` is dropped;
- a move voids the result with `key: "scene"`;
- the owner's `stale_keys`;
- on the hybrid engine, the read row shows `key: "scene"` and the discarded prescreen's call count.

Two older tests encoded the old whole-discard rule, and I updated both to the contract:

- `prescreen-request-supply`'s memory-refresh case now asserts that the memory is dropped and never published.
- `keeper-support-lookup`'s stale case now uses an owner-faithful stale check, and a scene change still rejects.

**Mutations.** All were killed by the new file and `keeper-support-lookup`:

| Mutation | Tests that fail |
|---|---|
| The final check compares `stateStamp` again | 4 |
| The fallback row loses `key` | 2 |
| Pages bound to the full binding | 1 |
| `stale_keys` ignored | 2 |
| The read row counts prepared calls only | 1 |
| The read row loses `key` | 1 |
| The kernel omits `stale_keys` | 2 |

**`loop_packing failure: packing_limit` (not changed; follow-up).**

It is a halving step inside a decision, not a loop stop: the run's `stop_reason` was `sufficient`. The mechanics:

- Every decision starts from the 48-operation frontier page plus navigation (49).
- The state is measured as UTF-8 JSON bytes, the §124.10 token upper bound. That state plus the operation question must be at
  most 32,000.
- On gate #5 the first decision packed at 25 offered, and every later one at 13. The 49 offer measured 33,962–39,109 bytes of
  state, and the 25 offer 29,964–33,524.
- So 36–45 issued operations were left off every round. They were reachable only through the navigation operation, which costs
  a decision.

What is packed, estimated from the row differences:

- 24 plain operations cost about 7.0 KB, about 290 B each. The first 16 carry 320-character previews, at about 450 B each.
- The non-operation state (retained materials up to the 16 KB packet, the capsule overview up to 8 KB, the supplied preview up
  to 4 KB, and gaps) was about 20 KB at decision 2 and about 24 KB by decision 6. That leaves 8–12 KB for operations.
- The operation question lists every offered alias with its label again: 4.8 KB at 49.

Why this is not a clear bug:

- The bound is computed on what the contract says. `JSON.stringify` keeps CJK raw, so it is not an escaping inflation.
- It is conservative: the provider reported 97,186 input tokens against an upper bound of 299,588 for the same 12 calls, a
  ratio of 0.32.

Follow-up options, each needing its own measurement:

1. Calibrate the bound with the measured ratio (a contract change to §124.10's "provable" bound).
2. Budget the packet's materials and the context jointly against the 32 K state limit, instead of independently (16 KB + 12 KB
   of 32 KB).
3. Size the operation page to the remaining budget instead of halving from 48. Halving costs two failed trials and two
   telemetry rows per decision.
4. Stop repeating labels in the operation question's criteria.

**Suites (leehow-pc).**

- `ext`: `tests 2854 / pass 2854 / fail 0` (exit 0, 111 s).
- `loop`: `tests 110 / pass 110 / fail 0` (exit 0, 27 s).
- `py`: `1709 passed, 2 skipped` (exit 0, 174 s). It ran because `kernel-ts/read/workspace.ts` changed.

**Not verified.** No live table and no replay of gate #5. The context-hook reuse path (`reusePrescreen`) is unchanged: it already
used the owner's per-key check and drops volatile memory as `owner_refresh_required`.

### 2026-09-24 — live gate #6 on the integration branch `3d10e7cdf` (gate #5 + SL-17 prescreen binding drift; driver.py, hybrid-v1, PI_COC_JEV_PRESELECT=1, grok-4.7-build-fast low, campaign `gate6-haunting-0335`)

Pre-registered in the session scratchpad (`live-gate-6-preregistration.md`). Same three sentences.

| turn | wall | model calls (s) | prescreen | compile | clerk executed | delivered |
|---|---|---|---|---|---|---|
| 1 accept + Globe | 64.8 s | 4 (47.4) | prepared, 5 materials, 2.9 s | ask = obligation 0.87, addressee none → no check (correct) | nothing (Keeper bundled the move) | yes |
| 2 clippings | **112.3 s** | 3 (34.9) | **prepared, 10 materials, 6.5 s** (no fallback) | **selected `resolve:obligation:globe-clippings-access`** (ask 0.91, addressee Arty 0.55) | **the obligation check**: Persuade by Jev 0.68, goal/method composed, executed in 3.0 s (lane 2.8 s); Persuade 16 = hard success, `obligation.settled: true` | yes |
| 3 punch Knott | 61.6 s | 7 (34.6) | prepared twice (4.5 + 1.8 s) | move 0.99 → executed | move; Knott's dodge (19, hard success, stated); disposition Jev 0.40 → Keeper | yes (`implicit_narrate_refused` drop, then the SL-16 fallback delivered) |

Scored: (1) every read row prepared or keyed; no `jev_calls: 0` after a run: met. (2) turn 2 materials, ask cleared, clerk check with a bind row, obligation on the roll, delivered: met, the first time the whole SO-04 + SL-12 + SL-13 chain ran at a live table; wall ≤ 45 s and ≤ 2 calls: **not met**, entirely after the clerk's success. (3) turns 1 and 3 delivered; walls 64.8 / 61.6 s: not met by 2–5 s; turn 3 looks 0: met. (4) all met.

Findings:
- **A lane review of 57.2 s** (HTTP 200 at 1.7 s, then the model streamed for 55 s) on the Keeper's later resolve targeting Ruth Blake, refused not_authorized. `admissionTimeoutMs` defaults to 120 s, so nothing cut it; the turn budget's 45 s cannot cut a running review either. Every clerk write across gates #3–#6 went through the lane (never typed). Ruling and fix on `claude/sl18-20260924`: the lane is capped inside the turn (12 s → `review_timeout`), and a clerk write the compile selected with cleared features and recorded parameter paths is admitted on that evidence (`path: compile`), no LLM review.
- **After the clerk settled the declaration, the Keeper kept proposing**: route s6 low_confidence → LLM (first-impression check, then a Ruth Blake step). The exit question should lean to `finish` once the declaration's own step is settled; to measure on SL-13's fixtures before ruling.
- Turn 1 and 3 walls sit at 62–65 s: the commission's 24.8 s Keeper call, the prescreen (2.9 / 4.5 + 1.8 s), lane reviews (3.9 / 4.9 + 3.1 s), and the disposition's Keeper step (turn 3) are the remaining costs; disposition default and prescreen calibration are the filed follow-ups.

Evidence: `chatrpgv4-wt-integ-sl/.coc/campaigns/gate6-haunting-0335/{telemetry.jsonl,turns/000{1,2,3}.json}`, `.coc/playtests/gate6-haunting-0335-20260924T073558Z/`.

### 2026-09-24 — live gate #7 on the integration branch `a1a266470` (gate #6 + SL-18 admission cap and compile-evidence admission + SL-19 disposition default / first blow + SL-20 finish after settlement; driver.py, hybrid-v1, PI_COC_JEV_PRESELECT=1, grok-4.7-build-fast low, campaign `gate7-haunting-0534`)

Pre-registered in the session scratchpad (`live-gate-7-preregistration.md`). Same three sentences.

| turn | wall | model calls (s) | compile | clerk executed / admission | delivered |
|---|---|---|---|---|---|
| 1 accept + Globe | 80.8 s | 3 (52.8: 28.2 commission + 9.7 + 16.0 compose) | move 1.0 → executed, **admission `path: compile`, 0 ms** | move; the exit after the move cleared `ask_llm` on its own (as the SL-20 measurement predicted for a move) | yes |
| 2 clippings | **25.8 s** | 2 (8.6) | obligation check selected (ask 0.91, addressee 0.51) | check bound with **skill by rules default = Intimidate** (Jev Persuade 0.67, confidence 0.59 under the gate; the actor's highest offered skill is Intimidate); the lane **refused it**: "explaining purpose and asking a favor; nothing chooses coercion"; the Keeper then rolled Persuade with the claim (95, failure) | yes |
| 3 punch Knott | 56.9 s | 7 (30.8) | move 0.98 → executed, admission `path: compile`; act combat 0.48 → first blow to the Keeper | move; Knott's dodge (89, failure; Brawl 13 hard success, hit); disposition bind `unavailable` (Jev budget spent) → Keeper | yes (explicit narrate after an `implicit_narrate_refused` drop) |

Scored: (1) no admission row over 12 s (max 4.6 s): met. (2) compile selection and ≤ 45 s / ≤ 2 calls: met; `path: compile` on the check and a settled route: **not met**, the check was refused. (3) turn 3 delivered, looks 0, ≤ 60 s: met; first blow to the Keeper as expected. (4) turn 1 ≤ 65 s: **not met** (80.8 s: a 28 s commission call and a 16 s compose). (5) all met; compile-path admissions carry origin/path/ms. (6) met.

Findings:
- **The approach's numeric default contradicts the declaration's manner.** SL-12's `highest_offered_skill` chose Intimidate for a player who explained and asked; Jev had leaned Persuade 0.67 but sat under the gate. The lane refused correctly and the turn still delivered in 25.8 s, but the clerk's step was wasted. Ruling and fix: SL-21.
- **The prescreen spends the run's Jev budget.** Turn 3's first read ran a 10.1 s prescreen (timeout) and the second read another 4 calls (aborted by timeout, 0 materials); the policy's Jev budget was then exhausted, the disposition bind was `unavailable`, and every later decide became a `compose` with reason `jev_budget` (five composes in one run, 22 s of model time). Fix: SL-22.
- Turn 1's floor is unchanged (the Keeper's commission call, 24–28 s) and its compose ran 16 s; the move's admission by compile evidence worked (0 ms).

Evidence: `chatrpgv4-wt-integ-sl/.coc/campaigns/gate7-haunting-0534/{telemetry.jsonl,turns/000{1,2,3}.json}`.
