Status: ready-for-agent
Stage: SL-12 (with SL-10/SL-11; before SL-03)
Spec: docs/specs/pi-native-single-loop.md (Rulings: "Parameter binding never goes to the LLM", "Parameters-only steps never go to the LLM", "An NPC's defence is data")

# SL-12 — Binding without the LLM: rules defaults for closed choices, code-composed explanations

## Evidence

- SO-04's replay (`turn3-obligations`, 6 runs): after the clerk staged Arty, Jev answered the approach bind `unknown` (0.76–0.80) every time, so `infer(bind)` sent the choice to the Keeper: one model call per run for a four-way closed choice among the investigator's own skills.
- `runtime/jev/candidates.ts` and `obligation-candidates.ts` mark `why`, `goal` (manoeuvre) and `outcome` (`combat:end`) as `open` parameters; `step-policy.ts` routes any required open parameter, and any closed one Jev could not settle, to `infer(bind)` followed by `direct llm_proposal`.

## Scope

1. **Rules defaults for closed binds** (`step-policy.ts`, the bind step): when Jev's answer is `unknown` or below the gates, the bind resolves to the rules default and the step continues as `direct`: the approach → the actor's highest current value among the offered skills (ties: the first in the obligation's stated order; the value read from the actor's sheet the kernel already issues in `table.resolve.options` profiles), dice modifiers → none, intent → the one the obligation/Mod/session declares, a target or weapon among several → no default (Jev only; a session step with several targets stays `decide(bind)` and, unresolved, hands the turn to the Keeper as today). The receipt carries `basis.binding: rule-default` (contract: the field on the operation's `basis`, beside `obligation`/`standing`); the Keeper may re-resolve with its own choice (a normal Keeper operation, no new verb).
2. **Explanatory parameters composed by code**: the candidate builder fills `why` / `how` / `goal` from its sources — the player's declaration quoted (`player: "<input>"`), the obligation's demand, a clue's or handout's authored `how`/cue, a move's declared destination — under the §135.21 one-sentence limit; these parameters are no longer `open`. `outcome` for `combat:end` and a manoeuvre `goal` stay open and those candidates stay Keeper-proposed (they are not issued to the clerk).
3. **`infer(bind)` on the clerk's path is removed**: a clerk candidate never reaches `infer(bind)`; the policy either binds (Jev / rules default / code) or drops the candidate for the run and hands the turn to the Keeper. Contract §135.x records the four binding ways and the one remaining `infer(bind)` case (Keeper-proposed operations only).
4. Telemetry: every bind records `path: jev | rule-default | stated | composed` with the value and, for Jev, the distribution.

## Acceptance

- Policy tests with stub ports: approach `unknown` → highest offered skill bound, `basis.binding: rule-default`, no infer; Jev confident → Jev's choice; several targets unresolved → Keeper, no infer; `why` composed from the player's words and the demand within the limit; a clerk candidate never produces an `infer(bind)` step (structural test over the policy's transitions). Mutations named and killed: default ignored (infer returns); the wrong tie-break; `why` generated instead of composed (a fake port that would answer an infer(bind) is never called).
- Replay `turn3-obligations` (product driver, 3 runs per seed, pre-registered): the approach bound without a model call in 3/3; passing roll LLM steps reported (expected 4, from 5); 11/11 rows kept; turn-3 original and fight-round unchanged.
- `npm run test:ext`, `uv run --frozen python -m pytest tests/kernel tests/play` green on the branch baseline (record it first); legacy untouched.
