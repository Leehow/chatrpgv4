Status: ready-for-human (report below; measurement only, no product code touched)
Stage: SL-77 (P1, measurement; Stage 2a acceptance of `docs/specs/jev-driven-steps.md` D6)
Spec: docs/specs/jev-driven-steps.md D4/D6

# SL-77 — Shadow agreement per class on two long gates, before any behaviour changes

## Scope
- `tests/play/long-gate-triage.py` (or a sibling `jev-steps-report.py`) reads `lane:"route", shadow:true` rows and reports per class: offered, cleared, `keeper_did` true/false/other, agreement where the Keeper acted, false positives read against the transcript (each listed with turn and the Keeper's prose), added Jev ms per turn.
- Run on gates #13 and #14 (they carry SL-76 in shadow by default). Write the numbers into this ticket and `docs/specs/jev-driven-steps.md` D6; the decision to open SL-78 is the owner's on these numbers.
- No product code.

## Comments

### 2026-09-26 — measurement, `tests/play/jev-steps-report.py`

Ran the report (read-only over `.coc/campaigns/<cid>/telemetry.jsonl` and `turns/*.json`, no writes, no live
model calls) against the two long-gate tables that actually exist under
`/Users/haoli/leehow/code/chatrpgv4-wt-pkg-b088de327/.coc/campaigns/`: **gate #14** (`longgate14-haunting-0505`,
finished, 21 turn files 0..20) and **gate #15** (`longgate15-haunting-0538`, **still running** — snapshot at 17
turn files, 0..16, taken 2026-09-26 02:01 local). Gate #13 (this ticket's original scope text) is not in that
directory — the only `#13` data on disk lives in a different worktree (`chatrpgv4-wt-integ-sl`) and was out of the
paths I was given to run against, so it is not included here; flagging in case the owner wants a follow-up pass
once gate #15 finishes and gate #13 is worth pulling in for comparison.

Command: `python3 tests/play/jev-steps-report.py /Users/haoli/leehow/code/chatrpgv4-wt-pkg-b088de327 'longgate14-haunting-*' 'longgate15-haunting-*'`

#### Table 1 — gate #14 (`longgate14-haunting-0505`, 21 turns, 8 stranded/undelivered: 9,10,12,13,17,18,19,20)

Shadow rows: 39 candidate + 20 `exists` rows, over turns [1,2,3,4,5,6,7,8,15,16]. None of the 8 stranded turns
carry any shadow row at all (the run never got as far as a read that issued D1 candidates before it went
`model_unavailable`), so the "unpaired: turn undelivered" bucket this script reports is 0 for every class here —
not because `keeper_did` came back `null` on a row, but because no row was ever written for those turns. That
narrows the ticket's premise ("8 turns stranded, whose rows have `keeper_did: null`"): the stranding is real (8/21
turns, matches the ticket's number) but it manifests as **absent rows**, not `null`-valued ones; the script still
carries the "unpaired" bucket and would report undelivered-turn rows separately from the class stats if a future
table produces any.

| class | offered | cleared | keeper_did=true | false | other | null | unpaired (stranded) | agreement true/(true+false) |
|---|---|---|---|---|---|---|---|---|
| `npc_reaction` | 9 | 3 | 0 | 4 | 5 | 0 | 0 | 0/4 = 0.00 |
| `clue_follow_up` | 30 | 6 | 6 | 14 | 10 | 0 | 0 | 6/20 = 0.30 |
| `time_cost` | 0 | 0 | – | – | – | – | 0 | n/a — no `time_cost` candidate was ever offered this table |

`exists` rows (the "does this family apply at all" Noul; no `keeper_did`):

| class | offered | cleared=true | cleared=false | unresolved (null) |
|---|---|---|---|---|
| `npc_reaction` | 8 | 4 | 1 | 3 |
| `clue_follow_up` | 12 | 5 | 3 | 4 |
| `time_cost` | 0 | 0 | 0 | 0 |

Cleared-but-`false`/`other` rows (candidate, turn, confidence, structural evidence from that turn's own
`receipts`): **`clue_follow_up` has zero** — every one of its 6 cleared rows paired `true` (6/6 precision on
cleared rows, 0 false positives, well inside D6's "≤ 1 per table per class" line). All 3 cleared-but-not-`true`
rows are `npc_reaction`:

- turn 6, `Vittorio Macario`, confidence 0.76, `keeper_did: other`. Player text: "我去罗克斯伯里疗养院，请求探视维托里奥·马卡里奥，问他在那房子里看见了什么。" The turn's own receipts carry a `roll` with `decision: natural-npc:first-impression, npc: vittorio-macario` — the Keeper *did* run exactly the mechanic `keeperDidFor` looks for, on exactly this person. It never registers as `true` because the row's own `key`/`target` carries the pending-contact's **display label** ("Vittorio Macario"), while the roll receipt's `npc` field is the **normalized handle** ("vittorio-macario"); `keeperDidFor`'s strict string equality (`text(receipt.npc) === entry.target`) can never match label to handle.
- turn 7, `Gabriela Macario` (asked twice, confidences 0.80 and 0.78), `keeper_did: false`. Player text: "我找到加布里埃拉·马卡里奥，轻声请她讲讲搬走那晚发生的事。" — an explicit, addressed request. The turn's compile telemetry independently confirms this: `basis.compile` for this turn's `resolve`/`apply` candidates clears `addressee: "Gabriela Macario"` at confidence 1.0. But the Keeper's actual roll this turn is a plain `Persuade` check, not a `natural-npc:first-impression` roll (Gabriela was presumably already met, so the first-impression gate no longer applied) — `keeperDidFor`'s `npc_reaction` branch only recognizes the specific first-impression mechanic as evidence of "did", so a genuine engagement resolved through any other social roll reads as `false` even though nothing here is a Jev misjudgment.

**Diagnostic only (not the product's own pairing):** re-running `npc_reaction`'s pairing with `target` resolved
through a label→handle map built from the turn's own `person` receipts (script's `corrected_npc_reaction`) turns
0/4 into 3/6 = **0.50** agreement, and reclassifies the turn 6 row above (and two uncleared rows, turn 4 "the Hall
of Records clerk" and turn 5 "Mr. Dooley") from `false`/`other` to `true`. This does not touch the turn 7 rows
(no first-impression roll exists there under either key form), which stay a genuine, if narrow, definitional miss.

Added Jev ms per turn (`{lane:"run", event:"consequence_budget"}`): 12/21 turns carried a shadow call — 742, 456,
905, 494, 477, 440, 500, 466, 937, 476, 520, 488 ms. Median 491 ms, mean 575.1 ms, max 937 ms — well inside D6's
"≤ 1.5 s added" line.

#### Table 2 — gate #15 (`longgate15-haunting-0538`, snapshot: 17 turns present, 0..16, **run still in progress**, 1 stranded: turn 10)

Shadow rows at snapshot: 38 candidate + 15 `exists` rows, over turns [3,6,7,9,12,14,16]. These numbers will change
if re-run once the table finishes; re-run the script for a final count.

| class | offered | cleared | keeper_did=true | false | other | null | unpaired (stranded) | agreement true/(true+false) |
|---|---|---|---|---|---|---|---|---|
| `npc_reaction` | 7 | 3 | 0 | 2 | 5 | 0 | 0 | 0/2 = 0.00 |
| `clue_follow_up` | 31 | 6 | 8 | 14 | 9 | 0 | 0 | 8/22 = 0.36 |
| `time_cost` | 0 | 0 | – | – | – | – | 0 | n/a — no `time_cost` candidate was ever offered this table (either) |

`exists` rows:

| class | offered | cleared=true | cleared=false | unresolved (null) |
|---|---|---|---|---|
| `npc_reaction` | 5 | 3 | 1 | 1 |
| `clue_follow_up` | 10 | 6 | 3 | 1 |
| `time_cost` | 0 | 0 | 0 | 0 |

Cleared-but-`false`/`other`: again **zero for `clue_follow_up`** (6/6 precision on cleared rows). All 3 are
`npc_reaction`, and all 3 are the same shape as gate #14's turn 6: a genuine, addressed engagement (same two
NPCs, same player phrasing pattern — this module's neighborhood-gossip scene repeats across both long-gate runs)
paired with a first-impression roll on the matching handle, mislabeled `other` by the same label/handle key
mismatch. Diagnostic label→handle correction: 0/2 = 0.00 → 3/5 = **0.60**.

Added Jev ms per turn: 10/17 turns carried a shadow call — 465, 792, 458, 904, 485, 473, 983, 933, 492, 508 ms.
Median 500 ms, mean 649.3 ms, max 983 ms — also inside the 1.5 s line.

#### Reading: the `npc_reaction` false positives are not the presence-vs-engagement shape

The pre-registered hypothesis for this reading was that the reaction candidate clears on mere **presence** while
the Keeper stages a first impression only on **engagement**, and that the compile's `addressee` feature (rather
than presence) would be the structural condition separating the two. Checked against the transcript and the
turn's own structured records, **this is not the shape found in either table**: every one of the 4 cleared-but-
not-`true` `npc_reaction` rows across both gates has a player sentence that explicitly addresses the named NPC
(a request to visit-and-question, or to sit down with them — never a passing mention), and in gate #14 turn 7 the
compile's own `addressee` feature independently clears onto that same NPC at confidence 1.0, corroborating that
this is genuine engagement, not presence, by an entirely separate judgment than the shadow route's own Noul. The
actual causes of every one of these mismatches are structural, not semantic: (1) `npc_reaction`'s candidate key
carries the pending-contact's **display label** (`"Vittorio Macario"`) while the Keeper's own first-impression
`roll` receipt stores a normalized **handle** (`"vittorio-macario"`), so `keeperDidFor`'s exact-string match can
never see the same entity on both sides of the pairing when a table's module names its NPCs this way; and (2) the
`npc_reaction` pairing only recognizes one specific mechanic (`decision: natural-npc:first-impression`) as
evidence the Keeper acted, so a real engagement resolved through a different roll (e.g. a bare `Persuade` when the
NPC is not a true "first" contact) reads as `false` even though the Keeper plainly did engage. `addressee` is a
useful corroborating signal when the compile's predicate happens to carry it (turn 7's case), but it is not a
complete substitute for presence-checking either: gate #14 turn 6's compile predicate was `move` (the player's
sentence phrased the engagement as "go to the sanitarium and ask him", which compiled to a destination, not a
person) and its own `addressee` feature stayed `null` even though the turn is, by every other read, a genuine
engagement. Net: `clue_follow_up` is clean in both tables (0 false positives, 6/6 and 6/6 precision on cleared
rows); `npc_reaction`'s apparent 0% raw agreement is very largely a pairing-instrumentation artifact (label vs.
handle) rather than evidence against Jev's own judgment, with one narrower residual gap (the pairing's mechanic
vocabulary not covering every way the Keeper can genuinely engage someone). Recommend, before SL-78 reads these
numbers as a go/no-go signal: fix `keeperDidFor`'s `npc_reaction` branch to compare handles (not label vs. handle)
before trusting the raw agreement figure for that class — this ticket does not do that (measurement only).
