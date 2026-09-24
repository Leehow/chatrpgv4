Status: ready-for-human
Stage: SL-24 (P1; amends SL-18)
Spec: docs/specs/pi-native-single-loop.md (Ruling: "A review that runs out of time is not a refusal")
Contract: docs/kernel-rpc.md §32.12.2 (amends §32.2, §32.7, §32.10, §32.11, §32.12)

# SL-24 — Keeper bookkeeping admission: concurrent reviewers, no silent refusals, a cap that bounds waiting

## Evidence (long live gate, campaign longgate-haunting-1010)
- `review_timeout` ×4: turn 1 (commission apply: clue, cash, item, handout, move), turns 6 and 7 (apply move to previous-tenants, twice: the Keeper then narrated the player as still on the street and the sanatorium visit never happened for the kernel), turn 14 (clue corbitt-diaries + time + threat: the diaries never existed; turn 19's `look object "Corbitt Diaries"` was unknown_entity).
- `not_player_action` ×4 with `grounds: None` and `proposed: None` (turns 10, 13 ×2, 15): refusals the Keeper cannot act on; turn 15's was the basement search.
- Lane latency for Keeper writes on this table: 2.4–7.4 s typical, 4 over 12 s; `path: typed` never; §32.11's fast path needs 0.87 and observed 0.72–0.80.

## Scope
1. Measure first: the lane's latency distribution on the long table's 26 Keeper-origin reviews and SL-10's retained bank; the typed reviewer's agreement with the lane on those (run it offline on the recorded batches); pre-register.
2. Contract (§32.12.2, amending §32.2/§32.11/§32.12): typed and lane run concurrently, first sufficient verdict wins; cap expiry on a bookkeeping-only batch with an authorizing typed verdict → admitted `path: typed_late`; other writes → `review_pending` returned to the Keeper with the typed verdict, resend once; a verdict without grounds is no verdict (fall through, never refuse); the cap value set from the measured distribution (state it and why).
3. Find why `not_player_action` came back with no grounds (extensions/kernel/admission.ts, the lane prompt/parse) and fix the parse or the prompt contract so every refusal carries grounds and the proposal.
4. Tests, mutation-killable; replay the long gate's turns 6 and 14 states with the recorded Keeper: the move and the clue land.

## Comments

### 2026-09-24 — measurement 1 (recorded evidence) and the pre-registration, before any scored run (branch `claude/sl24-20260924`, base `1dccf4578`)

**Where the evidence is.** The long gate's campaign id on disk is `longgate-haunting-0624` (the ruling's "1010" is the
clock of the triage, not the id): `chatrpgv4-wt-integ-sl/.coc/campaigns/longgate-haunting-0624` and
`.coc/playtests/longgate-haunting-0624-20260924T102454Z`, read only, copied to the session scratchpad. The retained bank
SL-10 measured against is the SL-10 worker's `bank.jsonl` (5 204 cases, built 2026-09-23 14:49 over the App home and the
main checkout), with its typed answers in `experiments/admission-jev-bank/results/sl10-bookkeeping/typed-distribution.jsonl`.

**The long table's lane reviews, as recorded** (`lane: "admission"` rows with `path: "lane"`, not reused; lane
`opencode-go/deepseek-v4.1-flash`, `lane_thinking: low`). Keeper-origin: 25 reviews plus one reuse (the "26"); clerk: 2.

| | n | p50 | p75 | p90 | max | over the 12 s cap |
| --- | --- | --- | --- | --- | --- | --- |
| Keeper, whole review `ms` | 25 | 5.2 s | 7.2 s | 12.4 s | 12.8 s (cut) | 4 (t1, t6, t7, t14), censored |
| Keeper, `apply` | 12 | 7.1 s | 12.0 s | 12.7 s | cut | 4 |
| Keeper, `resolve` | 13 | 4.1 s | 5.0 s | 5.4 s | 6.0 s | 0 |
| Keeper, `first_byte_ms` | 25 | 1.6 s | 2.5 s | 3.2 s | 8.5 s | -- |
| clerk | 2 | 3.3 s, 4.4 s | | | | 0 |

The four cut rounds had their headers at 2.9, 2.9, 1.3 and 6.6 s: each was streaming when the cap cut it, so what it
would have answered, and when, is not in the record. `path: typed` never occurs; the §32.11 fast path ran on 9 Keeper
bookkeeping batches and escalated every one (`jev_confidence` 0.20–0.70; 5 by a typed refusal line, 4 by low confidence).

**The retained bank's lane latency for the same lane model** (`opencode-go/deepseek-v4.1-flash`, 51 verdicts): `apply`
24, p50 3.2 s, p90 17.4 s, max 85.3 s, 4 over 12 s, 2 over 20 s; `resolve` 27, p50 3.9 s, p90 13.2 s, max 18.3 s, 4
over 12 s. For contrast, `deepseek/deepseek-v4-flash` direct (958 verdicts): p99 1.7 s, max 2.1 s; `xai/grok-4.6`
(3 969): p50 32–45 s. The tail is the provider route's, not DeepSeek's model.

**The no-grounds rows are admissions, not refusals.** The four `not_player_action` rows (t10 apply, t13 resolve, t13
apply, t15 apply) all say `admitted: true`, and the driver's `turn-N.json` shows their receipts landed (t15: `time:t15-c1`,
`threat:...-t15-c1`). They have no `grounds` because `admitAction`'s row writes `grounds`, `missing` and `proposed` only
when the verdict refuses (`extensions/kernel/index.ts`, the `settle` row: `...(admitted ? {} : {grounds, missing,
proposed})`). The triage read a missing column as an empty answer. Whether the lane itself ever answers without grounds is
measurement 2's question (the telemetry cannot say: no lane reply text is retained anywhere).

**Pre-registration for measurement 2** (the instrument is `experiments/admission-jev-bank/sl24-lane-typed.mjs`; nothing
has been run through it yet).

- *Corpus A:* the long table's Keeper reviews that the bank builder can pair with their tool arguments: 24 of 25 (the t9
  Keeper `apply` does not pair; `build.mjs` over a copy of the campaign and its playtest). Each is put to the lane
  (`opencode-go/deepseek-v4.1-flash`, `low`, the product prompt, cap 120 s) and to the typed family (minimum confidence
  0) at the same moment, one case at a time, 3 runs: 72 lane rounds. Known gaps: the setup prologue is omitted, and the 19
  admitted cases' lines are re-projected (the two moves among them lack `registered_destination`).
- *Corpus B:* the bank's lane-labelled `apply` batches whose triggering kinds are all among the ruling's bookkeeping kinds
  and include `cash` (95: authorized 66, entailed 7, not_player_action 2, not_authorized 20), typed only, minimum 0.
  SL-10's typed file covers the rest of the ruling's kinds (2 169 bookkeeping batches without cash).

Predictions (mine):

1. Corpus A lane latency, uncensored: p50 4–6 s, p90 10–18 s, at least one round over 20 s. The four batches the table
   cut are not intrinsically slow: each answers under 20 s in at least 2 of its 3 runs.
2. Every lane answer carries non-empty grounds (at least 71 of 72). If so, the "no grounds" finding is only the telemetry
   omission above.
3. The lane admits the t6 and t7 moves and the t14 clue batch in at least 2 of 3 runs each.
4. Typed agrees with the lane on admit/refuse in under 70% of corpus A's `apply` batches, because it refuses a line
   (a `person`, a `clue`) the lane admits, as in SL-10.
5. Corpus B: typed admits at least a quarter of the 20 lane refusals at minimum 0.

Decision rules, fixed now:

- **The cap *C*** (`PI_COC_ADMISSION_TIMEOUT_MS`'s default) is the p90 of the pooled uncensored Keeper-write distribution
  for this lane model (corpus A's 72 rounds plus the bank's 51), rounded up to a whole second, and no lower than today's
  12 s. The lane round's own hard deadline is 2*C*: the review keeps running past *C* so a resend can collect it. Stated
  in the contract with the p90, the p97.5 and the share of rounds past *C* and past 2*C*.
- **The late admission's typed threshold** is the lowest *T* (0.05 steps) at which, over the typed-admitted
  late-eligible batches of SL-10's file plus corpus B, lane refusals are at most 2% of typed admissions; if no *T* reaches
  it, typed late admission is left at SL-10's 0.87.

### 2026-09-24 — measurement 2 (scored against the pre-registration), and the decisions it forced

Results are in `experiments/admission-jev-bank/results/sl24/`:
- `longgate-lane-typed.jsonl`: corpus A, 72 rows;
- `bank-late-cash-typed.jsonl`: corpus B, 95 rows.

**Corpus A: the lane uncapped.** 72 rounds, 0 failures.

| | n | p50 | p75 | p90 | p95 | max | > 12 s | > 20 s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| all | 72 | 3.7 s | 4.5 s | 8.6 s | 15.1 s | 45.7 s | 5 | 3 |
| `apply` | 33 | 4.3 s | 6.8 s | 14.5 s | 26.9 s | 45.7 s | 4 | 3 |
| `resolve` | 39 | 3.4 s | 4.2 s | 4.8 s | 8.1 s | 14.8 s | 1 | 0 |

First byte: p50 1.6 s, max 3.0 s.

The four batches the table cut, per run:

| batch | lane (3 runs) | typed (verdict, confidence) |
| --- | --- | --- |
| t1: clue, cash, item, time, person | authorized 5.9 s, authorized 3.9 s, entailed 4.4 s | entailed / not_authorized ×2, 0.07–0.12 |
| t6: move + 3 persons | authorized 35.2 s, 9.9 s, 15.5 s | not_authorized (the Gabriela person line) 0.48–0.53 |
| t7: move + 2 persons | authorized 10.3 s, 21.5 s, 45.7 s | not_authorized (the move line) 0.22–0.37 |
| t14: clue, time, threat | authorized 4.2 s, 4.7 s, 4.6 s | authorized 0.25–0.34 |

**Scoring the predictions.**

1. **Missed on the level, held on the tail.** p50 3.7 s (predicted 4–6), p90 8.6 s (predicted 10–18), 3 rounds over
   20 s (predicted at least 1). The four cut batches are not all "not intrinsically slow": t1 and t14 are fast every time
   (a 12 s cut there was the provider's tail), but t6 and t7, a move beside several `person` lines, are slow every time
   (9.9–45.7 s). t7 answered under 20 s in only 1 of 3 runs.
2. **Held.** 0 of 72 answers had empty grounds. The long gate's "no grounds" was the row, not the lane.
3. **Held.** The lane admits t6, t7 and t14, and t1 too, in 3 of 3 runs each.
4. **Held.** Typed agreed with the lane on admit/refuse in 22 of 33 `apply` rounds (67%) and 33 of 39 `resolve`
   rounds. It refused a line the lane admitted in every run of t6 (a `person` line) and t7 (the move itself).
5. **Held.** At minimum 0, typed admits 9 of corpus B's 20 lane refusals.

**Decisions by the fixed rules.**

- **The cap is 13 s.** The pooled p90 is 12.3 s, over corpus A plus the bank's 51 verdicts for the same lane model:
  123 rounds, p50 3.6 s, p95 18.1 s, p97.5 21.4 s, p99 43.4 s, max 85.3 s. Rounded up, that is 13 s. 11 of 123 rounds
  pass 13 s. The hard cap is 26 s, and 3 of 123 pass it.
- **The late threshold is 0.70.** Over SL-10's 2 174 typed bookkeeping batches plus corpus B's 95, lane refusals as a
  share of typed admissions are:

  | *T* | 0.50 | 0.60 | 0.65 | 0.70 | 0.75 | 0.80 |
  | --- | --- | --- | --- | --- | --- | --- |
  | lane refusals / typed admissions | 3.4% | 2.5% | 2.5% | **1.9%** (4/214) | 2.1% | 1.1% |

  On `cash` batches alone, no false admission occurs at *T* ≥ 0.40 (35 admitted).

**What these numbers say about the long gate's four writes under the new rule.**

- None would have been a late admission: the typed confidences there were 0.07–0.53, or the typed answer refused.
- t14 and t1 answer inside 13 s: they land directly.
- t6 and t7 depend on the resend: the Keeper's step between the pending refusal and the resend overlaps the lane's tail,
  and a round past 26 s ends `review_timeout`. By the measured runs, about a third of t6/t7 rounds pass 26 s.
- The late admission, as calibrated, will rarely fire on this table. That is the measurement's answer, not a defect: typed
  confidence on these Keeper batches is low (0.2–0.7).

**Replay pre-registration (before any replay run).** Fixtures `longgate-t6` and `longgate-t14` are built by `gate-fixture.mjs`
from the long gate (read only). The live Keeper's call that the host refused with `review_timeout` is now replayed, and
marked `live_refused` in the baseline. Command: `run.mjs --fixture longgate-tN --runs 3 --llm replay --lane live --seed 1`.
This means:
- product driver, recorded Keeper, live Jev;
- the real lane (`opencode-go/deepseek-v4.1-flash`, `low`);
- a `review_pending` refusal is resent once at once. This models a Keeper that obeys the fix, with no Keeper latency,
  which is the pessimistic case for the overlap.

Registered acceptance (the lead's): the t6 move to `previous-tenants` and the t14 `corbitt-diaries` clue land. My
predictions:
- t14's clue lands in 3 of 3 runs, admitted by the lane before the cap.
- t6's move lands in at least 2 of 3 runs, either before the cap or on the resend.
- A t6 run that misses is the lane passing the 26 s hard cap. It ends `review_timeout` on the resend, and the row says so.

### 2026-09-24 — implemented, tested, replayed (branch `claude/sl24-20260924`, merged with the integration branch at `f0d90d626`)

**Commits.**

- `0942b32f8`: measurement 1 and the pre-registration.
- `8e987ae89`: contract §32.12.2, the implementation and its tests.
- `471c3f8c7`: measurement 2, the replay instrument, the fixtures and the replay pre-registration.
- `7d85cad47`: merge of `claude/integ-single-loop-20260923` at `f0d90d626` (SL-25). It merged clean.
- The commit carrying this comment and the replay results.

**Where each piece lives.**

- `extensions/kernel/admission.ts`:
  - `DEFAULT_ADMISSION_TIMEOUT_MS = 13_000` and `admissionHardCapMs` (2×);
  - `reviewAdmissionPrimary`: lane and typed started together, and the first sufficient verdict wins;
  - `reviewAdmission`: an answer with empty grounds is `NO_GROUNDS`, not a verdict;
  - `LATE_KINDS`, `lateEligibleBatch`, `admissionLateMinConfidence` (0.70) and `lateAdmission` (pure);
  - `admissionPending`, the `review_pending` refusal with the typed reading.
- `extensions/kernel/index.ts` (`admitAction`):
  - the late branch: `typed_late`, or pending with the round kept in `state.admissionPending` (cleared with the next
    player input);
  - the resend that collects the kept round, and `review_timeout` at the hard cap;
  - the `lane: "admission-late"` row;
  - `grounds`, `missing` and `proposed` on every verdict row.

**The no-grounds cause.** It was never a lane answer.

- The four `not_player_action` rows (t10, t13 ×2, t15) were **admissions**, and their receipts landed.
- The row omitted `grounds` because `admitAction`'s `settle` wrote `...(admitted ? {} : {grounds, missing, proposed})`.
  That is `extensions/kernel/index.ts:2029` at `1dccf4578`.
- Measurement 2 found 0 of 72 lane answers without grounds.
- Fixed two ways:
  - every verdict row now carries `grounds`, `missing` and `proposed` (the mutation M11 below restores the old
    conditional and is killed);
  - a lane answer with empty grounds is now no verdict (M6), so it can never refuse.
- Turn 15's basement search was admitted. What failed there is SL-25's missing guard and destination, not admission.

**Tests.**

- New: `tests/extension/admission-late.test.mjs`, 10 tests: the defaults; `lateAdmission` pure; typed-first and
  lane-first races; lane no-grounds with and without a late admission; `typed_late` at the cap on a real trickling
  socket with its late row; `review_pending` at the cap with the typed reading; the resend collecting a lane that
  answered after the cap; grounds on an admitting row.
- Updated for concurrency:
  - `admission-within-turn`: the cap is 13 s; the trickle returns `review_pending` within cap + 1 s; pending, pending,
    then a resend reaching `review_timeout` at the 3 s hard cap; the streak test.
  - `admission-fast-path` and `admission-jev`: "no typed request" assertions became "the typed answer did not stand".
    The lane answers are delayed, so the race order is the test's, not the scheduler's, and a lane refusal is scripted
    to prove who decided.

**Mutations.** Each was applied in place, the five admission files were run, and the file was restored from a saved
copy. 14 of 14 were killed.

| mutation | file | failing tests |
| --- | --- | --- |
| M1 cap back to 12 s | admission.ts | 4 |
| M2 no hard cap past the cap | admission.ts | 5 |
| M3 late admission ignores its threshold | admission.ts | 1 |
| M4 late admission for any `apply` batch | admission.ts | 1 |
| M5 late admission on a typed refusal | admission.ts | 1 |
| M6 a verdict without grounds is a verdict | admission.ts | 2 |
| M7 the pending round not kept | index.ts | 3 |
| M8 cap expiry refuses `review_timeout` again (SL-18) | index.ts | 4 |
| M9 a lane verdict waits for Jev (sequential) | admission.ts | 1 |
| M10 a standing typed verdict waits for the lane | admission.ts | 1 |
| M11 admitting rows without grounds (the old row) | index.ts | 5 |
| M12 a pending return resets the outage streak | index.ts | 1 |
| M13 the resend does not wait for the running round | index.ts | 1 |
| M14 no typed reading on `review_pending` | index.ts | 1 |

Not covered by a test: aborting the lane round when a typed verdict stands (a cost saving with no observable
behaviour), and that a `review_timeout` reached by the resend is kept for the turn. The refusal budget stops a fourth
identical call before admission, so no seam test reaches the reuse.

**Replays** (`results/sl24-longgate-t14`, `results/sl24-longgate-t6`, before the merge; `-merged` after). All used seed
1, the live lane `opencode-go/deepseek-v4.1-flash`, live Jev, the recorded Keeper, and a pending call resent at once.

Turn 14, the `corbitt-diaries` batch. The clue landed in **3/3** runs before the merge and **3/3** after, admitted by
the lane before the cap every time. As predicted.

| run | before the merge | merged |
| --- | --- | --- |
| 1 | authorized 6.7 s | authorized 4.2 s |
| 2 | not_player_action 4.7 s | authorized 6.4 s |
| 3 | authorized 4.2 s | authorized 4.8 s |

The lane grounds quote the player's words ("我下楼回厨房，撬开那个锁着的储物柜").

Turn 6, the move to `previous-tenants`, before the merge (the Keeper's `apply` reviewed). The move landed in **2/3**
runs, meeting the prediction but not the lead's acceptance:

- runs 2 and 3: authorized by the lane at 11.1 s and 9.9 s, before the cap;
- run 1: the only live exercise of the full path. `review_pending` came at 13.0 s (cause `cap`, `late_rule:
  typed_refusal`: the typed answer was not_authorized, as in measurement 2). The replayed Keeper resent at once, and the
  resend waited 12.7 s and ended `review_timeout` at the 26 s hard cap. That is the tail predicted for this batch, which
  measured 9.9–35 s in measurement 2. A live Keeper's step before the resend would not have saved it: the hard cap is
  measured from the review's start.

Turn 6 after the merge (SL-25). The move landed **3/3**, because SL-25 made the sanatorium recognisable: the clerk's
compile selects the move and it is admitted `path: compile` at 0 ms. The Keeper's reviewed batch no longer carries it.

**A probe outside the pre-registration (scratch, not scored).** Are the t6/t7 batches slow because of their `person`
lines? With the persons removed, 3 runs each: t6 answered in 8.0–9.4 s, against 9.9–35.2 s with them; t7 in 11.0–32.5 s,
against 10.3–45.7 s. The persons are not the main cause, and n = 3 decides nothing. The move line itself, with its
`registered_destination`, is slow on this route.

**Suites** (leehow-pc, the merged tree at `7d85cad47`):

- `ext on leehow-pc @ 7d85cad470c89f3e319f1a0c5a5489ae03a876c8: exit=1 wall=281s`: 2911/2912. The one failure was
  `jev-source-domain` "source-owned proof refuses an extraction version changed after semantic approval": its 7 s "source
  task deadlocked" watchdog fired while the box ran at load 45 (other workers). The file passes 5/5 rerun alone on the box
  and on the Mac. On `8e987ae89` it was 2905/2908: the same file ×2 and `npc-preparation-integration`'s overlap timing,
  all passing alone. These are the known timing tests SL-10 named; none reads admission.
- `loop on leehow-pc @ 7d85cad470c89f3e319f1a0c5a5489ae03a876c8: exit=0 wall=89s` (137/137).
- pytest was not run. Nothing SL-24 changed is read by the kernel (`kernel-ts/`, `content/`, `tests/kernel`, `tests/play`
  are untouched). SL-25's kernel change arrived with the merge and is covered by its own branch's runs.

**Not verified, and open.**

- No live table.
- The late admission (0.70) will rarely fire with the confidences typed on this table (0.07–0.70). On the long gate it
  would have admitted none of the four.
- The resend is modelled in the replay, not seen from a live Keeper. The `prompts/keeper.md` paragraph on admission
  refusals does not name `review_pending`; the refusal's `fix` carries the instruction, as SL-18 left it.
- A clerk (policy-origin) write that is returned pending is not resent by the clerk. A Keeper's identical call collects
  it, but no test covers that path.
- The lane often writes its grounds in the player's language, against the prompt's "in English". Measurement 2 saw it in
  both languages.
- `kpi.py` counts `review_pending` as a verdict, and does not yet group rows by `path` (`typed_late`) or read
  `admission-late` rows.
