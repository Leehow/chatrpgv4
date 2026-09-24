Status: ready-for-agent
Stage: SL-24 (P1; amends SL-18)
Spec: docs/specs/pi-native-single-loop.md (Ruling: "A review that runs out of time is not a refusal")

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
