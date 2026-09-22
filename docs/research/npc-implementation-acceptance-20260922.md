# NPC implementation and acceptance, 2026-09-22

Parent specification: [#102](https://github.com/Leehow/chatrpgv4/issues/102). Implementation slices: [#103](https://github.com/Leehow/chatrpgv4/issues/103), [#104](https://github.com/Leehow/chatrpgv4/issues/104), [#105](https://github.com/Leehow/chatrpgv4/issues/105), [#106](https://github.com/Leehow/chatrpgv4/issues/106), [#107](https://github.com/Leehow/chatrpgv4/issues/107). This is source-runtime evidence, not installed-App acceptance or a controlled quality/latency A/B.

## What now works

- Core NPC personality is interpreted from authored descriptions, or compatibly supplemented by a tool-enabled background Pi author. Accepted material persists across restart and remains available without Jev. Source material wins; generated material retains its origin.
- NPC look/capsules carry directed relationship evidence, made/heard promises and exact recent own speech. The latter is available before asynchronous extraction finishes. Reports and beliefs are not silently promoted to world facts or reciprocal feelings.
- A background author supplies conditional response intentions from each person's limited perspective. One shared-auth adapter batches independent questions, overlaps compatible requests and accepts suggestions only against a current view. No-fit, unavailable and stale results leave ordinary Keeper play available.
- At an actual reunion, the ordinary Keeper can establish a modest intervening story through apply npc. Accepted history is reused, with explicit additive detail available; no intermediate NPC turns or persistent offstage simulator exist.
- Character authors, bank refresh and derived indexing are background work. Optional automatic advice has a 1250 ms total grace period, including reads and freshness validation, with a maximum configurable 2000 ms. It does not wait for authors or publish gameplay effects. Its temporary context expires after a public game tool, another input, bridge rebinding or restart. Canonical apply/resolve/delivery retain authority.

## Genuine player interactions

Campaign `npc-personality-20260921` reached committed turn 11 with Grok `xai/grok-4.6` as Keeper and the main Codex session as the sole player. Every input was submitted once as a natural utterance through the ordinary RPC play driver. Source extensions were loaded by a transport-only wrapper around canonical launchMain, with an isolated emitted TS kernel; this avoided modifying the shared build used by other campaigns. `PI_COC_TASK_RUNTIME=0` selected the ordinary source route. The separate typed task loop and installed App were not accepted by this run.

The shared Jev extension resolver supplied credentials from the consuming process environment. No credentials were copied into sources, evidence or a new auth store. Personality/bank authors used `coding-relay/gpt-5.6-sol`; author tasks had read/write/edit/bash and background priority.

| Behavior | Retained observation |
| --- | --- |
| Stable personality | Knott's accepted practical, impatient, money-minded personality appeared verbatim in actual outgoing Grok requests after restart. It guided evidence requirements rather than a mandatory catchphrase. |
| Concrete relationship history | The player promised truthful/confidential reporting and deferred the advance until verifiable evidence. Knott remembered the arrangement, accepted records later, and offered a narrowly worded introduction letter. No numerical trust increase is claimed; courtesy did not require a fabricated relationship-affect record. |
| Distinct priorities | Knott wanted usable evidence to reduce property losses. Arty granted archive access with a condition about news priority. Ruth helped while protecting the filing order and her position. These are scoped qualitative observations, not a matched personality A/B. |
| Lazy reunion | On turn 9, after 120 game minutes away, Grok independently applied reunion background about office work, ledgers and cooling coffee, retained an attributed report and the existing payment condition, then used them in conversation. The canonical receipt and subsequent outgoing request contain this history. |
| Real typed advice adoption | On turn 11, Jev selected allowing Thomas to leave without inventing an errand or repeating an already-made decision. The observer confirmed `npc_response_advice` in the actual Grok request. The final farewell respected closure and retained Knott's concern. This verifies one adopted suggestion, not every subsequent response. |

Adverse evidence is retained. An earlier travel intention was met with another prompt rather than immediate travel. Earlier 750 ms advice windows timed out; one later decision completed in 607 ms but did not produce confirmed adopted context. Shared snapshot reading and compact candidate references reduced redundant work, and the 1250 ms total window produced the observed adoption. Several deliveries repeated the player's words. A letter exchange took 233.3 seconds because an existing continuity/possession check demanded registration of the investigator's legacy revolver. Those observations prevent a general pacing or speedup claim.

No campaign evidence was deleted. Driver runs are retained under `.coc/playtests/npc-*20260921` and the explicitly named `npc-responses-20260922`, `npc-reunion-20260922`, `npc-advice-final-20260922`, `npc-closure-20260922`. Canonical campaign data is under `.pi/npc-implementation/live-home/.coc/campaigns/npc-personality-20260921`. The bounded evidence index is `.pi/npc-implementation/integrated-live-evidence.json`; request hashes/booleans are in `provider-proof.jsonl`. All task-owned live drivers were stopped after settlement.

## Concurrency diagnostic

A separate component diagnostic used one retained perspective with 18 fixed counterfactual inputs, 450 questions per arm, and the shared resolver/adapter. At concurrency 16, the actual peak was 16 overlapping HTTP requests, with 5.565 seconds total. At concurrency 2, the total was 7.503 seconds. These inputs were not gameplay and caused no world writes.

One high-concurrency result was unavailable despite HTTP 200; that first diagnostic did not retain its normalized failure detail. Load and warm state were uncontrolled, and result elapsed time includes queue wait. This proves concurrent dispatch, not a stable percentage speedup or reduced whole-turn latency. Requests, cases, transport timings and results remain under `.pi/npc-implementation/throughput-1A79Z1`. Later production telemetry records normalized failures and selected/no-fit/stale outcomes.

## Validation and review

The current NPC-focused suite passed 40 cases covering actual RPC publication/read/reload, claims and replay, directed perspective privacy, heard-promise attribution, generated bank refresh, reunion acceptance/addition, death-state exclusion, concurrent decisions, stale/premise refusal, cancellation, shared auth, ephemeral context, background retry, parent-budget exhaustion, typed memory policy system language, world-state seams and contract references. Additional review checks ensure a numeric epoch retained from another process cannot revive old advice. Kernel typechecking passed. Strict extension checking has the same 19 existing transitive diagnostics as the old NPC voice extension baseline; no new NPC diagnostics were added.

The full extension run used an independent non-Git source snapshot to preserve other owners' live build. It ran 2262 cases: 2253 passed, 9 failed. The three Git-only contract checks passed in the real checkout. Six NPC mount assertions and the compact-turn AST seam were corrected and passed the 19-case targeted recheck. The NPC-specific current-only RPC names were added without changing the frozen oracle. The remaining vocabulary difference is another task's `module.source.materials.snapshot`; the other remaining failure is concurrent Grok provider registration becoming asynchronous. Those other owners' changes were preserved.

Full kernel/controller regression completed with 1606 passed, 1 skipped and 1 failed in 2047.92 seconds. The failure was caused by duplicate promise occurrences in the new commitments and existing history consuming the capsule budget and displacing an earlier canonical promise. The producer now deduplicates by host-owned memory identity before projection; exact original promises and attribution remain intact. All 50 affected memory/NPC kernel cases then passed, and 123 extension/fulfillment/read cases passed. The full run preceded final review repairs; focused follow-ups verify those changes. Evidence logs and source-snapshot manifest are under `.pi/npc-implementation/`.

Review covered the task-owned diff against recorded baselines and all new NPC files, following the actual producer/read/adoption/publication path. It repaired blocked freshness reads, background retry claims, dead-person advice eligibility, reused session epochs, launch/contract test integration, and duplicate promise projection under capsule limits. No known remaining NPC correctness defect is being waived. Semantic/pacing observations above remain limits of the evidence.

## Integration boundary

Only NPC changes and the discussion/spec/prototype artifacts from this task are eligible for the local commit. The shared Jev auth extension, prescreen, provider catalog, driver and packaging edits belong to other tasks and remain separate. The NPC implementation consumes the working tree's existing unified-auth extension; its clean-checkout dependency is not silently bundled into this commit. No push, package, deployment or App restart was performed. Parent #102 is preserved.
