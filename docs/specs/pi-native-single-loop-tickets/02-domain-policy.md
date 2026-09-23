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
