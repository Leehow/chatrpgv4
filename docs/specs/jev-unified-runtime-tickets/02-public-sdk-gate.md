Status: accepted
Execution: complete for the bounded S0 probe only
Parent design: #101
Stage: S0
Model: gpt-6-astra
Helper: gpt-5.6-terra for SDK conformance harness and evidence capture only

# Prove the public SDK host seam and decide go/no-go

Build a bounded integration probe for the highest-risk seam. This is a gate, not the production TaskRuntime.

## Depends on

- T01 accepted.

## Current progress

- Retained real-provider evidence is `.coc/playtests/jev-s0-live-20260920/s0-evidence.json`, backed by `turn-1.json` and `events.jsonl`.
- The run used configured Grok 4.6, a private plan, three real Jev decisions, two real guarded recall reads, and normal narrate/commit. It answered the original promise without inventing an amount or accepting for the player.
- Root reports 49 new focused conformance cases passing across contract, decision transport, read dispatch, delivery guard, public SDK/adapter, and actual `startS0Rpc` JSONL lifecycle boundaries. SDK 6/6 and RPC lifecycle 4/4 were independently completed and reviewed after the retained real run.
- T02 is accepted only as the source-only bounded S0 integration probe. No full TaskRuntime, general lookup/PDF, memory, mutation-domain, consumer-migration, or performance acceptance is claimed.

## Scope

- Prove public SDK role-message handling for private planner and writer roles without patching Pi. The planner gets one private `submit_plan_packet` protocol tool; the writer reuses existing `narrate`/`ask`, `message_end`, termination, and split-order guards. The normal global seven-verb surface remains unchanged outside the probe.
- Use SDK/test doubles only for serialization, factory, subscription, and callback conformance. Mark this evidence `conformance-only`; it cannot prove provider auth, actual role delivery, Jev use, RPC, guard preservation, accounting, cancellation, or gameplay.
- Extract the smallest shared read-only seam needed for a real S0 guard claim: schema validation, existing `tool_call` preflight, `runTool`, and `tool_result` failure accounting. Limit it to `look`, `recall`, and explicitly classified read-only `lookup` variants; no raw `bridgeCall`, mutation, preparation, publication, or delivery.
- Separately exercise a configured real Grok Keeper, real Jev typed endpoint, real host launcher/JSONL/RPC surface, auth/model selection, new/resume/fork adapter rebind/re-subscription, cancellation, delivery visibility, usage/context accounting, and the bounded guarded read seam.
- Prove actual Jev use is attributed separately from the configured Grok Keeper and no API key is persisted.
- Record a go/no-go result. Failure leaves every hybrid-dependent ticket inactive.

## Proposed exclusive write set

- `runtime/launch.ts`
- `runtime/jev/host-session-adapter.ts`
- `extensions/kernel/index.ts` — only the bounded read-seam extraction and registration needed by S0.
- `extensions/kernel/readonly-operation-dispatcher.ts`
- `tests/extension/jev-s0-public-sdk.test.mjs`
- `.tmp/team-lead/jev-ticket-plan/` for retained probe evidence only

**Subassignment boundary:** Terra may own the SDK conformance harness, read-only fixtures, and evidence capture. Astra owns every production-path edit, the real-provider/RPC probe integration, and go/no-go.

## Acceptance

- The SDK test-double suite passes and is reported only as conformance evidence.
- Separately, one bounded read-only objective requiring a dependent second Jev decision completes through the real configured Grok/Jev/host/RPC path and the bounded shared read dispatcher.
- New, resume, and fork each rebind the adapter; cancellation reaches owned work.
- The real trace, not the test-double trace, proves RPC delivery visibility, existing preflight and result-failure accounting, bounded usage/context, correct model attribution, and no hidden post-close model call.
- The current launcher path still works when the probe is disabled.

## Retirement and rollback

The legacy launcher remains the default and the accepted S0 route stays opt-in. No incumbent path retires at this gate. The full dispatcher and every mutation family remain T05 or later; rollback disables the S0 flag without deleting session, turn, receipt, or evidence data.

## Completion evidence

- Real provider seam: `.coc/playtests/jev-s0-live-20260920/s0-evidence.json` and `turn-1.json`.
- Public SDK adapter: 6/6 focused cases, including writer deadline, Keeper identity, cancellation, lifecycle, and canonical implicit commit observer.
- Production `startS0Rpc` JSONL lifecycle: 4/4 focused cases for default/custom session directories, exact IDs, new/switch/fork rebind, no-session identity, and workspace confinement.
- Kernel read/delivery conformance: public hooks, failure bookkeeping, stale/cancelled reads, explicit/implicit delivery guards, review deadline rechecks, and material retry.
- Independent review: `.tmp/team-lead/jev-s0-review.md` recommends GO for S0 only after all four findings closed.

## Not this ticket

No production TaskRuntime, mutation, domain rollout, push, package, restart, fake play, or production Python.
