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

### 2026-09-24 — addendum: alternative-model measurement after long gate #4's cap hits (worktree `chatrpgv4-wt-sl39`, branch `claude/sl39-20260924`, base `a1bdf7004`)

**Trigger.** Long gate #4 (`longgate4-haunting-1308`, integration `a1bdf7004`) hit the lane's 13 s cap four times and one `review_timeout` in 20 turns while still on `opencode-go/deepseek-v4.1-flash`. This measurement-only addendum answers the natural follow-up to the ticket's own closing note ("no separate slower model to move away from *today*"): what would the numbers look like on the ALTERNATIVE models the App's logins can already reach, before anyone chooses to switch. **No setting was changed.**

**Bank.** SL-39's own bank was not committed (by design — it carries player/module text), so it was rebuilt the same way, `experiments/admission-jev-bank/build.mjs` against `chatrpgv4-wt-integ-sl/.coc` (read-only), filtered to the two campaigns this addendum needs: `longgate3-haunting-1058` (22 of 23 recorded lane rows pair, same one-row gap the original ticket found — turn 13's `resolve`) and `longgate4-haunting-1308` (31 lane-path rows pair). 53 batches total. SL-39's other 2 cases (SL-29A's hand-reconstructed t7/t14, from a PDF-import playtest with no per-turn tool-call log) are **not** included here — reconstructing them by hand was a one-off exercise in the original ticket, not reproducible tooling, and manufacturing new answers for them would not be a real measurement. This addendum's bank is smaller than SL-39's 24 (22+31 = 53 batches, no SL-29A cases), noted rather than hidden.

**Candidates**, everything plausibly fast the App's five provider logins (`xai`, `grok-build`, `deepseek-extended`, `google`, `opencode-go`) can reach:
- `opencode-go/deepseek-v4.1-flash` — current.
- `grok-build/grok-4.7-build-fast`, low thinking — the Keeper's own model (`manualModelSelection` in the copied `pipiui-settings.json`), reached through the same OAuth token the table uses; not in `models-store.json` (it isn't a models-store provider), so the harness registers it the same way the `grok-build-oauth` extension does at session start (`createAuthProvider`, which awaits the live catalog — confirmed it returns `grok-4.7-build-fast` alongside `grok-4.7`/`grok-4.6`/`grok-4.5`).
- `xai/grok-4.6` — the one non-`grok-build` xai model already in `models-store.json`.
- `google/gemini-2.5-flash-lite` — the google flash candidate.
- `opencode-go/qwen3.8-flash` — the other opencode-go "flash"-named model.

Reasoning effort was left at the lane's own default (`laneThinkingLevel`, low unless `PI_COC_LANE_THINKING` overrides it) for every candidate, so each ran at the same effort the product lane would actually give it (`laneReasoningOptions` maps that level per API automatically) — no candidate was special-cased.

**Replay** (`experiments/admission-jev-bank/sl39-lane-alternatives.mjs`, live calls from the Mac, `reviewAdmission` called directly with `PI_COC_ADMISSION_MODEL` forced per candidate — the same production code path and the same review prompt the table uses): 3 runs × 53 cases × 5 candidates = 795 live calls. The harness capped each call at 60 s, not the product's 13 s: the product genuinely aborts a round at 13 s, so a round cut there would say nothing about how much slower a candidate is beyond it, which is exactly what this measurement exists to show (the same choice SL-39's own replay made, for the same reason). Every row still carries whether it exceeded the product's 13 s cap, so "share of calls over the cap" is a real, uncensored number, not an artifact of where the harness happened to cut it.

| candidate | ok / 159 | p50 | p90 | p95 | max | over 13 s cap |
| --- | --- | --- | --- | --- | --- | --- |
| **opencode-go/deepseek-v4.1-flash (current)** | 158/159 (1 `model_error`) | 4.1 s | 7.8 s | 9.8 s | 35.3 s | 4/158 (2.5%) |
| grok-build/grok-4.7-build-fast | 159/159 | 5.2 s | 11.1 s | 13.7 s | 15.2 s | 9/159 (5.7%) |
| xai/grok-4.6 | 159/159 | 8.4 s | 14.1 s | 17.6 s | 22.6 s | 23/159 (14.5%) |
| opencode-go/qwen3.8-flash | 89/159 (70 `model_error`, most at the harness's own 60 s ceiling) | 22.9 s | 55.8 s | 60.0 s | 60.0 s (capped) | 69/89 successes (77.5%) |
| google/gemini-2.5-flash-lite | 0/159 (159 `model_error`) | — | — | — | — | — |

(latency over successful calls only, as SL-39's own table reported it.)

**Verdict agreement**, over the 53 cases whose recorded outcome was a real verdict:

| candidate | run-level agreement | cases where all 3 runs match recorded | cases where ≥2 of 3 match | cases where ≥1 of 3 matches | cases where all 3 runs agree *with each other* |
| --- | --- | --- | --- | --- | --- |
| **opencode-go/deepseek-v4.1-flash (current)** | 99/158 (62.7%) | 27/53 (50.9%) | 33/53 (62.3%) | 39/53 (73.6%) | 40/53 (75.5%) |
| grok-build/grok-4.7-build-fast | 94/159 (59.1%) | 26/53 (49.1%) | 29/53 (54.7%) | 39/53 (73.6%) | 37/53 (69.8%) |
| xai/grok-4.6 | 76/159 (47.8%) | 20/53 (37.7%) | 26/53 (49.1%) | 30/53 (56.6%) | 41/53 (77.4%) |
| opencode-go/qwen3.8-flash | 58/89 (65.2%, survivorship-biased — see below) | 8/53 (15.1%) | 18/53 (34.0%) | 32/53 (60.4%) | 10/53 (18.9%) |
| google/gemini-2.5-flash-lite | n/a (0 successful calls) | 0/53 | 0/53 | 0/53 | 0/53 |

qwen's run-level agreement figure is computed over only the 89 of 159 calls that completed at all (56%); the 70 that failed or hit the harness's 60 s ceiling are excluded from the numerator and denominator alike, so its 65.2% is not comparable to the other candidates' near-100%-completion figures — it looks competitive only because its failures were removed rather than counted against it.

**Errors, by candidate:**
- **google/gemini-2.5-flash-lite: 159/159 calls failed, all `model_error`, all in 1-90 ms** (never reached the network). Not a model-quality signal — it is a real, reproducible defect: the lane's `thinking: {enabled: true, level: "LOW"}` option (`laneReasoningOptions`, `extensions/lanes/subsession.ts`, for any `google-generative-ai` model) breaks `ModelRegistry.complete()` in the installed `@earendil-works/pi-coding-agent@0.87.0`, surfacing as `callerSignal.addEventListener is not a function` inside the reply's `errorMessage`/`stopReason: "error"`. Confirmed model-independent (4 google models tried: `gemini-2.5-flash-lite`, `gemini-2.5-flash`, `gemini-3.5-flash`, `gemini-3.1-flash-lite`, identical failure) and build-independent (reproduces on both the vendored `build/node_modules` copy and the live `node_modules` copy, same version). A plain `complete()` call with no `thinking` option succeeds against the same model/credential, isolating the option as the trigger. **No google model can serve as the admission lane's reviewer today, in either build.** This is a dependency defect, not something this measurement-only ticket fixes; flagged separately (see below).
- **opencode-go/qwen3.8-flash: 70/159 calls (44%) failed**, all `model_error`/aborted, the overwhelming majority (69) at or past the harness's own 60 s ceiling. Genuinely slow, not hanging: single calls that did complete took as long as 55-60 s with a first byte around 1.5-2 s (slow generation, not a stalled connection). "Flash" in name only for this lane's purposes.
- `opencode-go/deepseek-v4.1-flash`'s one failure and `grok-build`/`xai`'s zero failures are unremarkable (deepseek's single `model_error` is consistent with the ~1-in-144 transient rate SL-39's own replay already recorded).

**Ranking and recommendation: keep `opencode-go/deepseek-v4.1-flash`.** It leads on every axis measured — fastest p50/p90/p95, lowest share over the 13 s cap (2.5%, a fifth of the next-best working candidate), highest agreement with the recorded verdicts at both the run level (62.7%) and the case level (50.9% exact, 3 points and change ahead of `grok-build`). Its one outlier (35.3 s) is a single transient, not a pattern. `grok-build/grok-4.7-build-fast` is the only real fallback candidate: agreement within 3-4 points of current, and the tightest worst-case latency of any working candidate (max 15.2 s, nobody else's max is under 22 s) — worth keeping in mind if `deepseek-v4.1-flash`'s endpoint ever degrades, but there is no case for switching to it now, since it is already slightly slower and slightly less aligned on every measured figure. `xai/grok-4.6` is worse on every axis that matters for a capped lane (p90 already past the cap, triple the current model's over-cap share, and the lowest agreement with recorded verdicts of any working candidate) and is not a contender. `opencode-go/qwen3.8-flash` and `google/gemini-2.5-flash-lite` are disqualified outright — one too slow/unreliable to run under a 13 s cap, the other unable to complete a single call.

**Left for separate tickets, not fixed here (measurement only):**
1. *The google-generative-ai `thinking` option breaks `ModelRegistry.complete()`* in `@earendil-works/pi-coding-agent@0.87.0` (both the vendored and live copies) — a real defect blocking every google model from this lane (and, by the same code path, from any other zero-tool lane that runs at other than the provider's own default effort). Worth its own ticket if a google model is ever wanted here; not investigated further in this measurement-only addendum.
2. *Run-to-run verdict instability is not particular to one model or one path*: 69.8-77.4% self-agreement on the three working, mostly-reliable candidates (`deepseek-v4.1-flash`, `grok-build`, `xai`) sits in the same 55-78% band SL-39's own two arms already found for `deepseek-v4.1-flash` alone. This addendum's data adds evidence that the instability SL-39 flagged as a separate ticket candidate is a property of the batches/prompt in general, not of the specific reviewer model — worth folding into whatever ticket ends up measuring it.

Raw per-case, per-run numbers (ids, turns, verb, verdict labels, ms only — no player text, no proposal text, no grounds) are in `experiments/single-loop-routing/results/sl39-lane-alternatives/per-case.json`; aggregate figures in `summary.json`. The bank and full raw replay output (which carry module/player text) are not committed.
