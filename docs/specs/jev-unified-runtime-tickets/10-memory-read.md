Status: accepted
Execution: complete bounded semantic memory read; independent GO
Parent design: #101
Stage: S4
Model: gpt-6-astra
Helper: gpt-5.6-terra for memory-read fixtures and tests only

# Implement adaptive memory read, recall, and bounded context

Retrieve relevant committed memory through exact sources and typed relations, with honest omission reporting and no world mutation. Astra owns this ticket because all production readers are in `kernel-ts`.

## Depends on

- T03, T06, T07, and T09 accepted.
- T08/S3 is explicitly not a dependency.

## Scope

- Retrieve across authorized history using goal, scene, receipt, entities, corrections, and temporal links.
- Classify relevance, support, current applicability, contradiction, and link-following over closed candidates.
- Fetch originals, convert legacy code-point ranges explicitly, and preserve exact terms, negation, conditions, secrets, attribution, and worldline boundaries.
- Enforce a 12 KiB/20-row context budget with used/omitted coverage and raw-record fallback while indexing lags.
- Preserve optional query rules and no-query direct behavior; recall remains read-only.

## Proposed exclusive write set

- `kernel-ts/read/memory.ts`
- `kernel-ts/read/capsule.ts`
- `kernel-ts/read/assemble.ts`
- `kernel-ts/memory/recall.ts`
- `tests/kernel/test_jev_memory_read.py`

**Subassignment boundary:** Terra may own memory-read fixtures and tests only. Astra owns every production reader change in `kernel-ts`.

## Acceptance

- A differently worded old promise and non-module memory are found beyond recent-12/current-NPC limits.
- Same-turn receipts change context; contradictions and omissions remain explicit.
- Query plus direct detail is rejected; secret and worldline boundaries hold; recall causes no mutation.

## Retirement and rollback

Keep legacy indexes and no-query direct reads. Typed retrieval can be disabled while raw committed records remain usable. Promise payout is not accepted until T13.

## Accepted bounded gate (2026-09-20)

V5 preserved separate semantic needs and retrieved the actual turn-9 player preference and turn-10 complete NPC money/key utterance, with speaker attribution and explicit partial coverage. The child and parent closed cleanly without transcript fallback, packing failure, effects or payout. The initial empty plan subgoal was schema-refused and then corrected. Actual typed task 40.350 seconds, whole turn 81.5 seconds, parent 5 questions and child 160 questions; these are unpaired observations, not a speed claim.

The raw-gap field is now presented as extraction backlog with an explicit original-transcript fallback explanation. Its projection test passes; writer wording after that clarification was not replayed. A final sparse-index regression proves any missing requested need triggers bounded raw-history widening even when another need already has supported indexed evidence. Domain 8/8, public host 8/8, kernel read-owner 12/12; original v1/v3/v4 adverse evidence remains retained. Evidence and independent review are linked in the manifest.
