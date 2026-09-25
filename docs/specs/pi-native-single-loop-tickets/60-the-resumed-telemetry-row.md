Status: ready (filed 2026-09-25 from the 血色公路 batch-8 table; batch 9)
Stage: SL-60 (P3, telemetry; follows SL-54)
Spec: docs/kernel-rpc.md §22.4.6.1 (SL-54)

# SL-60 — A displaced read that resumes writes its `resumed` row

## Evidence (ticket 29 batch-8 entry)
- SL-54's displacement and resume worked at the state level on the b8 table (the job went back to queued and later completed), but no `resumed {from_generation, generation, reread}` telemetry row was written; the triage had to infer it from the queue file.

## Scope
1. The host writes the `resumed` row on every claim that resumes a displaced job (the kernel already returns the marker); one test on the reading service asserting the row.

## Comments
