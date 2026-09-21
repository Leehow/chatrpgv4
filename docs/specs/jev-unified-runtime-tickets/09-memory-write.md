Status: accepted
Execution: bounded referenced-memory write and incumbent-reader integration passed independent GO; adaptive retrieval and reward fulfillment remain separate tickets
Parent design: #101
Stage: S4
Model: gpt-6-astra
Helper: gpt-5.6-sol for the non-kernel memory host helper and tests only

# Implement reference-first memory write and organize lifecycle

Replace narrow generative extraction with a committed-turn-only, reference-backed lifecycle while preserving raw history and legacy readability. Astra owns this ticket because it changes `kernel-ts` memory semantics.

## Depends on

- T03, T04, T06, and T07 accepted.
- T08/S3 is explicitly not a dependency.

## Scope

- Emit post-commit jobs over exact spans and typed annotations with retain/skip/defer.
- Add a versioned eight-kind enum and distinguish duplicate, reinforcement, independent, correction, contradiction, and temporal relations.
- Give promises explicit identity and target links rather than pair-only supersession.
- Add batch cursor/backlog, idempotent replay, and an optional marked derived summary.
- Preserve freeform statement rows, raw committed turns, attribution, worldline scope, and source authority.

## Proposed exclusive write set

- `extensions/memory/index.ts`
- `kernel-ts/memory/jobs.ts`
- `kernel-ts/memory/corrections.ts`
- `tests/extension/jev-memory-write.test.mjs`
- `tests/kernel/test_jev_memory_write.py`

**Subassignment boundary:** Sol may own `extensions/memory/index.ts` and memory-write tests. Astra owns every `kernel-ts` memory change and integration.

## Acceptance

- More than twelve worthy segments are processed or honestly deferred.
- Job/step replay is idempotent; two promises from one NPC coexist; a targeted correction does not erase an independent claim.
- Temporal history, exact attribution, legacy rows, and backlog survive restart.
- No regex/list semantic classifier and no memory job before the whole-turn commit.

## Retirement and rollback

Keep raw committed turns and legacy readers for rebuild. Remove the old generative orchestrator only family by family after accepted submissions reach real readers. T09 cannot claim reward settlement.

## Implementation evidence (2026-09-20)

The versioned protocol is in kernel RPC §122. `kernel-ts/memory/referenced.ts` verifies canonical Git source/scope, owns twelve-segment steps without a job cap, materializes exact statements/refs, binds occurrence-specific relations, and recovers prepared publication into the existing candidate/story/NPC/event views. Legacy jobs retain their protocol. Full canonical hashes coexist with retained abbreviated commits.

The shared TaskRuntime now hosts a separately rooted committed-memory domain. The existing memory lane queue invokes it behind `PI_COC_JEV_MEMORY=1`; memory publication goes through private registered owner operations and cannot resolve/apply/deliver. Shutdown leaves committed work pending regardless of extension hook order. Jev classifies retention, kinds, names, membership, relations and source-selected story evidence; it never writes a copied statement.

Final conformance: 19 referenced RPC cases, 15 legacy memory cases, consumer/owner checks, and 191 Jev cases at review; subsequent prior-attribution domain checks passed 14 cases. All statement-bearing memory consumers retain closed semantic attribution and conversation-report authority. Canonical offstage speakers and table aliases bind in the kernel, prepared replay compares the entire row, and queued decisions wait for refundable peer budget holds.

Real evidence: `.coc/playtests/jev-memory-live-03-20260920/memory-evidence.json` retains the exact v3 NPC promise, canonical subject, original SourceRef and speaker, plus three honestly pending source segments. Restart recovered the previous turn's pending work. In `jev-memory-live-04-20260920/memory-reader-evidence.json`, the corrected capsule obligation carries that exact statement and attribution into the configured Grok Keeper, which distinguishes promise from actual receipt of money and delivers through ordinary narrate/commit (`ac91588`, 26.396 seconds, no resolve/apply/award). Independent bounded GO: `.tmp/team-lead/jev-t09-core-review.md`.

Earlier v1/v2 trials are adverse/partial evidence and their rows remain intact. This acceptance covers new opt-in referenced jobs and legacy readability, not global semantic accuracy, adaptive T10 retrieval, T13 reward fulfillment, paired performance, or product rollout.
