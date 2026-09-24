Status: closed (2026-09-24 — measured, no code change: the lane already follows the fast-model setting)
Stage: SL-39 (P2, admission lane tail)
Spec: docs/kernel-rpc.md §32.12.2, §32.12.3; memory "fast model: one setting for all quick lanes"

# SL-39 — The lane's own tail after SL-30: measure the reviewer model, then default the lane to the fast model

## Evidence
- Long gate #3 (SL-30 in): 23 lane reviews, ms sorted 1.9, 2.0, 2.7, 2.8, 2.8, 3.1, 3.4, 3.6, 4.1, 4.4, 4.7, 4.8, 5.1, 5.1, 5.2, 5.5, 5.7, 7.8, 7.8, 8.9, 9.9, 10.2, 13.0 s (p50 4.8 s, p90 9.9 s; one `review_pending` at the 13 s cap on t1's resolve). No `review_timeout`. Line-level clearing changed no verdict (paths: lane 23, compile 15, none 2).
- SL-29A: the move reviewer (deepseek-v4.1-flash) timed out at 10.0 s on t7 and hit the 13 s cap on t14, same move both times.
- The batches are now plain (no `person`/`threat` lines reach the lane), so the remaining cost is the reviewer model's latency itself.

## Scope
1. Measurement (recorded lane inputs from gate #3 and SL-29A, replayed against the current lane model and the fast-model setting's model; 3 runs each): p50/p90/max per model, verdict agreement with the recorded verdicts. Report before any change.
2. If the fast model clears the same verdicts at a lower tail, the lane follows the fast-model setting by default (env > setting > follow the table, per the existing rule; storage key unchanged); the ticket records the numbers. If not, the ticket records that and closes with the measurement.
3. Tests: the lane's model resolution order (already covered by the fast-model tests; add the default case if it changes).

## Comments

### 2026-09-24 — measurement: (a) and (b) are already the same model; no code change (worktree `chatrpgv4-wt-sl39`, branch `claude/sl39-20260924`, base `1660ec0fd`)

**Before replaying anything: the code already does what Scope 2 asks.** `resolveLaneModel` (`extensions/lanes/subsession.ts`), the function every `runLane` call (including admission's, `envName: "PI_COC_ADMISSION_MODEL"`) resolves its model through, already reads `PI_COC_ADMISSION_MODEL` → the fast-model setting (`fastChoice(ctx)`, `runtime/fast-model.ts`) → `ctx.model` ("follow the table"), in that order. This has been true for admission specifically since §109.3, and was generalized to the remaining lanes by `3b943cb31` ("it is the fast model, and every lane that has to be quick runs on it", 2026-09-23; already on `main`/this base): its own commit message says "§109.3 had already moved admission, verifier, memory, journal and voice onto it". `tests/extension/fast-model-resolution.test.mjs` already drives `admission` through all three cases in `ZERO_TOOL_LANES` (`"variable unset, setting present"`, `"variable set"`, `"neither"` → table) — the "default case" Scope 3 asks to add if the order changes is already there, unchanged.

So "(a) the current lane model" and "(b) the model the fast-model setting resolves to" are not two candidates to bake off: they are the **same lookup**. Reading the App's fast-model setting confirms it (never printed; `ext.coc-keeper.laneModel` under `wt-pdf-a/.pi/coc-agent/pipiui-settings.json`, and the copy at `wt-integ-sl/.pi/coc-agent/` used for long gate #3 agrees byte-for-byte on the relevant keys): `model: "opencode-go/deepseek-v4.1-flash"`, thinking `off`. That is exactly the `model` field long gate #3's and SL-29A's admission rows already recorded. The setting file's mtime (08:48) predates both evidence files (11:02, 11:19), so it was not changed in between. The operator has already pointed the fast-model panel at `deepseek-v4.1-flash`; the lane, already wired since §109.3, already followed it when this evidence was produced.

**Reconstruction.** `experiments/admission-jev-bank/build.mjs --home wt-integ-sl/.coc` against the long-gate-3 driver playtest (`wt-integ-sl/.coc/playtests/longgate3-haunting-1058-20260924T145842Z/turn-*.json`) recovers 22 of the 23 recorded lane-path admission rows (turn 13's `resolve`, key `7d278e491ab1`, does not pair to any tool call in the driver's turn files — an unpaired-by-order gap in the tooling itself, not something this ticket fixes). SL-29A's converse stage (a PDF-import playtest) kept no per-turn tool-call log, only `turns.log`'s human-readable summaries, so t7 and t14 (same key `868cdeabc5d5`, per the ticket's own evidence) are reconstructed by hand: `turnContext` (`experiments/admission-jev-bank/bank-core.mjs`, reused, not reimplemented) supplies each turn's player-visible context, and the `proposed` lines are borrowed from t14's row (t7's `model_error` row carries no `proposed`) since both rows share the same key. `landed`/`refused` default to `[]` (no other admission row shares either turn, so this is a reasonable default, not a measured one). 24 batches total, noted in the case file.

**Replay** (`experiments/single-loop-routing/results/sl39-lane-latency/`, live calls from the Mac, credentials copied read-only from `wt-pdf-a/.pi/coc-agent/` into this worktree's own `.pi/coc-agent/`, gitignored, never committed or printed): whole-batch `reviewAdmission`, 3 runs × 24 cases × 2 arms = 144 live calls, cap 60 s (well past the product's 13 s, so the tail is not truncated by the cap this measurement is trying to check):
- **(a) forced to the recorded model**: `PI_COC_ADMISSION_MODEL=opencode-go/deepseek-v4.1-flash` (bypassing the setting, replaying exactly what ran).
- **(b) resolved live through the fast-model setting**: no override; `ctx.cwd` is this worktree, so `resolveLaneModel` reads the copied `pipiui-settings.json` through the real code path, the same one production uses.

Both arms resolved to `opencode-go/deepseek-v4.1-flash` on every successful call (143 of 144; one transient `model_error`/abort in arm (a), case `longgate3-haunting-1058:2:1` run 2 — the same case that also took the longest successful call, 50.6 s, and disagreed with itself across verdicts, see below).

| arm | n calls | failed | p50 | p90 | p95 | max |
| --- | --- | --- | --- | --- | --- | --- |
| (a) current (forced) | 72 | 1 | 5.0 s | 13.0 s | 15.0 s | 50.6 s |
| (b) fast-model setting (resolved) | 72 | 0 | 5.6 s | 14.3 s | 17.3 s | 22.8 s |

(latency over successful calls only; §32.12.2's own pooled measurement was p50 3.6 s / p90 12.3 s on the same model — this replay's p90 lands within a second of that, on a much smaller n.)

**Verdict agreement**, over the 21 of 24 cases whose recorded outcome was a real verdict (excluding SL-29A's t7 `model_error` and t14 `review_pending`, and longgate3 t1's `resolve` `review_pending` — none of those recorded a verdict to agree with):

| arm | run-level agreement (of 63 runs) | cases where all 3 runs match | cases where ≥2 of 3 match | cases where ≥1 of 3 matches | cases where all 3 runs agree *with each other* |
| --- | --- | --- | --- | --- | --- |
| (a) current (forced) | 35/63 (55.6%) | 10/21 | 11/21 | 14/21 | 14/21 |
| (b) fast-model setting (resolved) | 39/63 (61.9%) | 10/21 | 13/21 | 16/21 | 12/21 |

The two arms are statistically indistinguishable (a 6pp gap on n=63 is under 1 standard error), as expected for the same model reached two different ways. (b)'s agreement is not lower than (a)'s own — if anything marginally higher — and (b)'s latency is not lower-tail than (a)'s (p50/p90/p95 all slightly higher, within noise; only the max is lower, driven by (a)'s one outlier). Raw per-case, per-run numbers (ids, turns, verb, contract-enum kinds, verdicts, ms — no player text, no proposal text, no grounds) are in `per-case.json`; aggregate figures in `summary.json`.

**Decision (Scope 2): no code change.** The premise ("if the fast model clears the same verdicts at a lower tail, make the lane follow the fast-model setting by default") does not apply because there is no separate, slower "current" model to move away from: the wiring that Scope 2 describes already shipped (§109.3, generalized by `3b943cb31`), is already tested (`fast-model-resolution.test.mjs`), and is already what produced this ticket's own evidence, because the operator had already pointed the fast-model setting at `deepseek-v4.1-flash`. Resolution order is unchanged (env > setting > table) and the storage key is unchanged, as the ticket asked. Closing with the measurement, no code touched, no test added (Scope 3's "add the default case if it changes" — it does not change).

**Left for a separate ticket, not fixed here (out of scope for this one):**
1. *The lane's own verdict is unstable run-to-run*, independent of arm: only 10/21 cases got the same verdict in all 3 runs as was originally recorded, and 5/21 substantive cases never matched the recorded verdict in any of the 6 runs across both arms (`longgate3-haunting-1058:2:1`, `:2:2`, `:5:1`, `:9:0`, `:3:1`). This is a property of the model/prompt on ambiguous batches, not of which model resolution path is used, and existed before this ticket (§32.12.2's own reused-verdict machinery exists partly because of it) — but 55–62% run-level self-consistency on a live table is worth its own measurement ticket.
2. *SL-29A's t14 batch, given patience, looks admissible.* Replayed at 60 s instead of the product's 13 s cap, it resolved `authorized`/`entailed` in 5 of 6 runs (never `not_authorized`, which is what the typed reviewer read at cap time and what drove the `review_pending`). That the cap-starved batch was plausibly a legitimate action, not a genuinely contested one, is circumstantial (n=6, no ground truth), but worth flagging for whoever looks at cap tuning next.
3. `experiments/admission-jev-bank/build.mjs`'s order-pairing leaves one recorded row (long gate #3 turn 13's `resolve`) unrecoverable when a driver turn's tool-call count does not exactly match the review-row count for that verb; not investigated further here.
