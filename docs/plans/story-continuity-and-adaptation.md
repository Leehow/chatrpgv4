# Story continuity and adaptation — implementation record

## Objective
Implement issue84 for midgame causal clarity, source-backed interventions, and campaign-local graph adaptation. Source, kernel arithmetic, transactions, and world/receipt authority remain authoritative; no comprehension score, forced progression, new compulsory per-turn review, or Python production code.

## Branch and ownership
Source audit checkpoint `ca127652` is committed separately. Current memory repair remains on owned `codex/story-continuity` with final checks passed and ready for its scoped local commit. Primary is `827bad51` with other-task changes, untouched by this repair; no merge or push into primary.

## Implemented fixes
Timestamp-shape continuity failure; kernel-bound semantic correction references; supersession and late backfill; current-worldline reconciliation for legacy corrections; correction priority and inherited relevance; memory status/provenance; readable superseding content for explicit old recall; `record_integrity_only` transcript label; clearer continuity tool query description. No new memory database, semantic keyword classifier, or extra always-on model lane.

## Validation and evidence
Extension suite838 passed. Final dedicated memory suite5/5 passed, including worldline reconciliation; kernel memory module14 passed. Adjacent memory/recall/worldline/transactions/capsule suite85 passed, with one expected transcript-schema assertion initially omitting `verification_scope`; that assertion is corrected and the transcript module recheck passed all 4 tests. Final typecheck and runtime build passed. Evidence is retained in `.coc/playtests/memory-correction-contracts` and `/tmp/pipicoc-continuity-impl.yh2FpS`; no frozen Python oracle changed.

Real campaign `continuity-venue-live`, run with `tests/play/driver.py` and Keeper/memory model `deepseek/deepseek-v4-flash`, reconciled three legacy corrections during normal startup/backfill (1867ms, 1613ms, 1121ms; 4.601s total). It set `mem:t12-2` superseded by `mem:t15-1`, and `mem:t12-3` plus `mem:t13-3` superseded by `mem:t14-1`; raw memories/transcripts were not manually edited. Turn16's first three automatic memories were corrections `15-1`, `14-1`, `15-2`, with the three wrong reports absent. A fresh kernel read after stopping the driver confirmed this. Main-session recall/look behavior retained the childhood retraction, distinguished witness account from guesses, made no action/clue/roll receipts, and left clock824; the foreground round took113.0s, so this is not a speedup claim.

## Historical failures and human gate
Turns12/13 of `continuity-venue-live` remain failed evidence: the Keeper invented unsupported connections while the player declined the bible and asked for existing facts clarified. Retain those transcripts and classifications. No Greek transplantation, uninformed-human UI comprehension, universal hallucination elimination, or all historical source-error claim is proven. The human UI gate remains pending. Final source checks are complete; this is not a claim of universal hallucination prevention.
