# Pre-registered outcomes (rebuilt 2026-09-29 after the scratchpad was cleared; earlier sections live in the session transcript)

## Jev-rolls prototype (72460abfc, PI_COC_JEV_ROLLS) — same worktree/build, flag off vs on, concurrent pairs, scripts z1 & j2 (written before start)
- speed: first visible prose median, flag on vs off in the same concurrent pair; KP roll-only rounds per table.
- misses: turns where the Keeper still rolled a non-social skill check itself with the flag on.
- over-rolls: host rolls on turns whose same-index control turn had no roll (approximate; read each prose to judge).
- duplicate attempts: jev_rolled refusals.
- success: first-prose median down >= 5 s vs its pair, misses <= 2 per table, over-rolls that read wrong in the prose <= 1 per table.

## Amendment 2026-09-29 night — jev-rolls redesign (reuse ordinaryRouteBatch/ordinaryProfileBatch; concurrent round 1; bounded loops)
Prototype A/B (same build, flag off vs on, concurrent pairs, scripts z1 & j2) PASSES only if ALL:
- Jev actually answers: >= 80% of reached stage rows have complete batches (no opaque unavailable);
- first visible prose median (flag on) is >= 5 s lower than its concurrent flag-off pair on BOTH scripts, OR >= 5 s lower on the pooled 30 turns;
- misses (Keeper still rolls a non-social ordinary skill check itself, flag on) <= 2 per table;
- wrong host rolls (a host roll the declaration does not call for, judged by reading the declaration + prose) <= 1 per table;
- zero double rolls of the same check in a turn; zero stuck/undelivered turns attributable to the stage.
Fail on any => fix and re-measure; do not productionize.

## Real acceptance after productionization (live grok-4.5 KP, me as the player one line per turn, NO fixed script)
2 tables x 15-20 turns (research -> house exploration -> checks/social -> combat/sanity if reached). Pass lines:
- every turn delivered; no stuck turn; first visible prose median <= base median of the A/B pair minus 5 s;
- each host roll read against the declaration: wrong <= 1 per table; duplicates 0;
- Keeper still rolls non-social ordinary checks itself <= 2 per table;
- no new refusals/steers caused by the stage.

## Result v3 (6aa44e744) against the bar above: FAIL on speed, PASS on correctness
- misses 0/0 (only walk-on first-impression rolls left to the Keeper); host rolls 3 (Library Use x2 at records/library, Spot Hidden in cellar) all fit the declarations; dups 0; requests complete 57/57.
- first-prose median z1 25.8->25.5, j2 27.5->30.2: the -5 s median bar fails.
- Why (stated, not a re-reading): rolls occur on 2-3 of 15 turns, so the median sits on non-roll turns; the stage costs ~0.67 s median on every asked turn. Post-hoc: host-rolled turns 25.5 s median (n=3) vs Keeper-rolled turns ~34.7 s (n=7).
- The median bar cannot be met by any roll-only change; it was mis-specified. New bar for the NEXT measurement, written before it runs (below).

## v4 bar (written before measuring v4)
- roll turns: pooled host-rolled turns' first-prose median <= pooled Keeper-rolled turns' (both tables, same run window) - 5 s, with >= 4 host-rolled turns in total (else extend with another pair);
- non-roll turns: ON median <= OFF median + 1.5 s on each script;
- correctness: misses <= 2 per table; wrong host rolls <= 1 per table; dups 0; no stuck turns.
- v4 code: 6b8c8442c (early finish + parallel rule reads). Tables jr4-{off,on}-{z1,j2}, all four at once, 15:14:07.

## Amendment to the acceptance speed line (2026-09-29 15:16:12, before any acceptance table exists)
The acceptance line "first visible prose median <= A/B base median - 5 s" rests on the same mis-specification as the v3 bar
(rolls are 2-3 of 15 turns; a median over all turns cannot move 5 s from a roll-only change). Replaced by:
- host-rolled turns' first-prose median (both acceptance tables pooled) <= the v4 A/B flag-off Keeper-rolled turns' median - 5 s;
- non-roll turns' first-prose median <= the v4 A/B flag-off non-roll median + 1.5 s (each table);
- the original all-turn line is still computed and reported as-is, labelled as the original line.
Correctness lines unchanged.

## Prose-first step 1c (lead-in + immediate re-send), written 2026-09-29 15:47:22 before any 1c table
Tables: pf1c-on-{z1,j2} (PI_COC_PROSE_FIRST=1) and pf1c-off-{z1,j2} (flag off), all four concurrent, same worktree/build,
grok-build/grok-4.5 low, the same 15 fixed lines per script.
Metric (flag on): first visible prose = the first non-blank text_delta of the turn when the row's shown_then_withdrawn is false;
when true, the first delta of the last text-bearing assistant message (the one that stayed). Control: first coc-mechanics entry.
PASS only if ALL:
1. shown_then_withdrawn turns <= 1 per flag-on table (1b: 4 and 2);
2. first visible prose median, flag on <= control - 8 s on EACH script (1b: -12.1 / -10.0);
3. every turn delivered, none stuck, on all four tables;
4. every lead-in turn read by me: the lead-in states no outcome that the roll contradicts; wrong <= 1 per table.
Fail on any => report, do not merge. Pass => still a prototype step for the owner (A's steps are owner-approved one by one).

## Result 1c (bbe04a548): FAIL
- withdrawn turns z1 2 (t4 table_act_unsettled spoil; t13 time_unrecorded after an intent_result_owed resend), j2 2 (t0 table_act_unsettled spoil; t10 below_floor text beside two lookups). Bar <=1: fail.
- first visible prose median (excl. opening): on z1 36.5 / control 58.5 (-22.0); on j2 35.8 / control 36.5 (-0.7). Bar -8 s each: fail on j2. Provider slow in this window (control t7 112.9 s).
- all turns delivered (control j2 t11 had no mechanics card: to check). lead-ins 0 (z1), 2 delivered 2 (j2); resends 5.
- without 1c the same tables would have withdrawn ~4 and ~4 (resend-fixed turns + lead-ins added back).

## Prose-first step 1d, written 2026-09-29 16:06:33 before any 1d table
Changes: (a) a shown prose-only reply's time reading is not refusable under the flag (kernel delivers with a warnings row, next capsule's unrecorded time row asks for apply time); same for a held draft's commit; (b) text beside reads only (look/lookup/recall), under the floor, is a lead-in; the lead-in note rides on the first answered call of its message.
Tables pf1d-{on,off}-{z1,j2}, same bar as 1c (withdrawn <=1 per on-table; on <= control - 8 s each script; all delivered; lead-ins read coherent, wrong <=1 per table).
