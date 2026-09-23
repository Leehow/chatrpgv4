# NPC personality and relationship implementation

Objective: make onstage NPCs recognizable people with their own priorities, directed relationship memory and coherent reunion history, while the player keeps control. Parallel Jev, background preparation/writes and shared credentials support this experience. Scope is the approved [specification](../specs/npc-personality-and-relationship-spec.md), parent [#102](https://github.com/Leehow/chatrpgv4/issues/102). No offstage simulator, auth replacement, retired Python production code, unrelated cleanup or App deployment.

Current branch: `0.9.4a`; initial HEAD `fb5c4c324`. Default session; no worker delegation. The explicitly requested implement skill calls for a scoped local commit after checks and review. Parent #102 must remain unchanged.

## Frontier

| Ticket | Slice | State |
| --- | --- | --- |
| [#103](https://github.com/Leehow/chatrpgv4/issues/103) | Stable personality | Closed; RPC persistence/recovery and actual request/interaction proof |
| [#104](https://github.com/Leehow/chatrpgv4/issues/104) | Directed relationship and shared history | Closed; scoped perspective tests, actual promises/payment arrangement and later conditional cooperation |
| [#105](https://github.com/Leehow/chatrpgv4/issues/105) | Own intentions and parallel Jev advice | Closed; background candidate supply, parallel diagnostics and one confirmed live adopted suggestion |
| [#106](https://github.com/Leehow/chatrpgv4/issues/106) | Lazy reunion | Closed; real two-hour return, canonical generated continuation and reload/idempotency tests |
| [#107](https://github.com/Leehow/chatrpgv4/issues/107) | Integrated acceptance/review/commit | Scoped experience checks and review complete; closeout recorded in the ticket |

## Completed path

Contract §123 precedes the implementation. Core host-only NPC jobs publish bounded stable personality with per-attempt claims, source/scope binding and idempotent recovery. Existing NPC views expose personality, directed reports, exact own recent speech and made/heard commitments. Tool-enabled Pi authors prepare conditional response banks in the background. One existing shared-auth adapter performs separate-view batched decisions; current snapshots are read together, successful suggestions are freshness-checked, and no-fit can request background refresh. Only ordinary Keeper resolve/apply/delivery has game authority.

Optional advice is bounded to a 1250 ms total foreground grace period, including reads/freshness checks, without awaiting authors. It expires after a public game tool, new input, bridge change or process/session change. Generation and indexing do not form a foreground barrier. Reunion uses ordinary apply npc to establish a modest compatible interval once, with explicit additive detail and no simulated intermediate turns.

Code review repaired deadline-bound freshness checks, death-ledger exclusion, retrying new background claims, cross-process epoch reuse and launch/contract test expectations. Focused final verification passed 40 cases; kernel typechecking passed. The strict extension check exactly matches 19 pre-existing transitive errors in the old voice baseline, with no new NPC errors.

## Evidence and open limits

See [the acceptance record](../research/npc-implementation-acceptance-20260922.md) for positive and adverse observations. The real campaign `npc-personality-20260921` reached committed turn 11 using xai/grok-4.6, with the main session as sole player and one natural input per turn. Turn 9 generated accepted reunion history after 120 game minutes; turn 11's Jev advice was observed in the actual outgoing request and followed by a natural farewell. Source mode used the ordinary canonical launcher route, with an isolated emitted TS kernel and tool-enabled coding-relay/gpt-5.6-sol background authors. `PI_COC_TASK_RUNTIME=0` means the separate typed task loop and installed App are not live-accepted by this run. All task-owned live drivers are stopped after settlement. Never replay retained inputs.

Separate diagnostic: 450 questions/arm, peak 16 HTTP calls, 5.565 s at 16 versus 7.503 s at 2. One unavailable high-concurrency result and uncontrolled load prevent a stable speedup claim. These are counterfactual diagnostics, not gameplay.

Full extension run: 2253/2262 passed initially, 9 failed. Six mount assertions and the compact-turn AST seam were corrected and passed a 19-case follow-up. NPC vocabulary additions are accounted for without changing the frozen oracle. Two cross-task failures remain: async Grok provider registration and the other owner's new source-material RPC omitted from the current-only compatibility list. Git-only contract checks ran at the real checkout. Full kernel/controller run: 1606 passed, 1 skipped, 1 failed. The failure was the NPC promise duplication/budget regression; after fixing occurrence deduplication, all 50 affected kernel cases and 123 extension/read/fulfillment cases passed. Full and recheck logs/exit-code records are retained.

## Preservation and closeout

Initial status and per-file baselines are under `.pi/npc-implementation/`. Other tasks own unified Jev auth, prescreen/source material, provider catalog, play-driver and packaging edits. They were preserved. The NPC implementation consumes the already-implemented shared auth extension; do not absorb that owner's uncommitted dependency into this commit.

The independently copied source snapshot is a test artifact, not a Git worktree. Its manifest is `.pi/npc-implementation/validation-source.json`. No lifecycle worktree was created/adopted. Never rebuild its emitted kernel while the full pytest process is running, or the shared main build while another live driver consumes it.

The selected tracked hunks for review are in `.pi/npc-implementation/scoped.patch`; corresponding review files are in `scoped-review/`. These exclude all other owners' changes, including contract §124 and the existing `_context_read` edit. Before staging, verify HEAD and the index remain unchanged, regenerate any task-owned doc hunk updated after that patch, inspect the final staged diff and stage only named new task files. No push, package, deployment or App restart is authorized.

Feature implementation and scoped acceptance are complete. The local commit and #107 closeout retain the known shared-checkout failures and unaccepted App/typed-loop/performance claims; those are not new implementation work silently added to this task. Parent #102 stays open.

## Follow-up: shared preparation (#109)

The user approved the integration spec and invoked implement on 2026-09-22. Primary acceptance remains the actual outgoing Keeper request and natural player interaction, with personality/relationship quality and total player wait. The existing NPC feature is complete; this follow-up replaces independent automatic preparation with shared reads, concurrent branches, one deadline/capacity owner and final-handoff freshness. Canonical effects and background publication keep their owners. No offstage simulation, new auth route, package, push or unrelated repair.

Starting HEAD is `85faec8b4`, branch `0.9.4a`. The material-supply task remains active; its ledger says its code writers stopped before frozen runtime v3 assembly and the root is performing live A/B. Preserve its dirty source and contract section 124. This task owns NPC modules, its additive contract section, new integration tests and its scoped integration hunks. Before overlapping edits, verify the frozen baseline and current owner state again. Recorded baselines and evidence are under `.pi/npc-prescreen-integration/`; never stage all shared changes.

Execution: (1) add the integration contract, (2) test/implement reusable NPC preparation and final validation, (3) integrate shared foreground scheduling/reads and preserve each-alone activation, (4) validate real request supply, privacy, stale/cancelled/partial behavior and budgets, (5) run focused and required full regressions, code review and actual player acceptance, (6) commit only owned changes and update #109 with precise functional/performance limits. Use the already confirmed seams without asking the user again. No implementation or integration acceptance is claimed yet.

### #109 implementation checkpoint

Contract section 125 and scoped baselines are recorded. The NPC private bridge now separates prepare from final validation; standalone evaluation retains its immediate check. The existing context owner claims automatic NPC work, shares a Jev adapter and bounded preparation/provider allowance, dispatches material/NPC decisions concurrently, and performs final NPC freshness after sibling work. The shared catalog can carry host-only limited NPC projections from the same loaded state; both reads use one projection implementation. New NPC content goes through the existing optional request-budget policy, so it cannot displace paired current evidence. Response relevance now has a separate parallel choice with a valid non-participation outcome; this does not force a response or create background refresh debt.

Real-kernel/host interface tests have demonstrated concurrent dispatch and both outputs in converted model messages, stale death-state rejection, shared limited views and budget-preserving omission. The wider material request suite found one changed telemetry lane expectation; compatibility was restored with one allowance event carrying the shared owner. Kernel typecheck passed; strict host checking still reports the same 19 pre-existing transitive diagnostics and no changed-module errors.

Work remains: finish same-input in-flight/completed reuse and conservative state revision checks; validate activation, shared capacity/accounting, cancellation/partial cases and explicit reads; review and broader regression; freeze compatible source baselines and run real Grok Build 4.7 fast/low player acceptance plus honest matched latency evidence; selective commit and #109 closeout. No source integration commit, real acceptance or speedup is claimed. Do not rebuild the shared main build used by other drivers. No new task-owned worktree or live driver exists yet. New test campaigns under `.pi/npc-prescreen-integration/tests/` are deterministic interface evidence, not gameplay, and are retained.
