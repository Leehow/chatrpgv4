# Enhanced Locations Mod implementation ledger

Status: active. Owner approval: 2026-10-19, including specification, tickets,
implementation and real multi-place stress testing. The owner explicitly requires
a location enhancement Mod and permits necessary kernel changes.

## Intent and acceptance

Players can visit compatible places through natural language without an exhaustive
registered-exit map. A hotel, its lobby, its rooms and the front desk remain
distinguishable; returning restores their identity and current consequences.
The versioned Enhanced Locations Mod owns this enhancement. Its independent
package and state lifecycle support later iteration and migration.

Success requires the actual Keeper to use the capability in a real game, not just
schema validation, synthetic moves or a large test count. A renamed apply effect
with all old context and registration gates intact is hollow completion.

## Scope and ownership

- Source checkout: latest mainline `0.9.8a`, baseline `ad1f607f942d616f8a2f5929270a18d3ee5293bc` (ahead of origin by 30 commits).
  Existing design/research documents belong to this task. No new worktree is needed.
- One writer integrates serially. Preserve unrelated concurrent edits. No push,
  deployment, package installation, branch deletion or evidence deletion is authorized.
- Production is TypeScript only. Never restore/run the retired Python kernel.
- New package: `mods/enhanced-locations/`, backed by a named kernel capability.
- Shared transaction, arithmetic, admission, existing Mod lifecycle and raw evidence
  remain authoritative. No second Keeper, transaction manager or generic world patch.
- No new geometry engine, forced building taxonomy, template bank or split-party UI.
- Supporting kernel, host, schema, context and test changes are approved as required
  to implement the Mod. Other gameplay domains are not being redesigned.

## Tickets

| Slice | Issue | State | Outcome |
|---|---|---|---|
| EL-00 | [#115](https://github.com/Leehow/chatrpgv4/issues/115) | specified | Normative contract, Mod boundary and acceptance plan |
| EL-01 | [#116](https://github.com/Leehow/chatrpgv4/issues/116) | implemented; validation active | Versioned package, capability, stable state and graph/read projection |
| EL-02 | [#117](https://github.com/Leehow/chatrpgv4/issues/117) | implemented; RPC regression passed | Atomic Mod writes, creation, local position, passages, feature continuity |
| EL-03 | [#118](https://github.com/Leehow/chatrpgv4/issues/118) | implemented; host regression active | Separate place tool, native decisions, admission and final author consumption |
| EL-04 | [#119](https://github.com/Leehow/chatrpgv4/issues/119) | implemented; projection regression active | Demand-loaded Mod contract/material, history projection and request evidence |
| EL-05 | [#120](https://github.com/Leehow/chatrpgv4/issues/120) | in progress | Regression, real travel stress, restart/return continuity and final report |

The contract and per-issue acceptance govern the slices. Record actual completion,
commits and validation here at meaningful milestones; do not close on code alone
when a ticket requires live evidence.

## Required behavior matrix

1. A compatible unregistered ordinary hotel can be established and entered without
   separately discovering a construction tool or running another generation agent.
2. A known authored or previously created destination reuses its identity. Source
   coverage gaps are not mistaken for nonexistent places.
3. A hotel, lobby, room and corner/feature have explicit containment or relative
   position; containment alone grants neither passage nor zero travel time.
4. Two hotels can each contain room 203. Local and qualified references disambiguate
   them; ambiguous references produce a useful correction rather than a nearest match.
5. Approaching the desk and looking toward it have different location results.
6. Doors, windows and other stable features can be referred to again; meaningful
   changes persist. They do not automatically become carried inventory.
7. Failed atomic batches leave no dependent place/position/time changes. Real
   partial journeys commit only their actual accepted stages, with concrete causes.
8. A truly indivisible mixed-domain batch uses the same location handler and sees
   earlier staged state. Retrying does not duplicate places or charge time twice.
9. Native and standalone entrances reach the same Mod behavior; a closed issued
   destination enum cannot reintroduce the unknown-place wall.
10. Relevant Mod detail can be requested mid-turn. A quiet turn retains only a small
    entry/current position, with host-owned long guidance omitted from the request.
11. Mod disable/version migration preserves stored places and history; raw source,
    transcripts and receipts are never rewritten.
12. Author output, actual receipts, public scene details and later references agree.

## Validation and resource plan

- LAN probe: amax unavailable; leehow-pc reachable and idle. Heavy builds/ext,
  integration and loop suites use the existing remote-test runner, one heavy suite
  per box. Small meaningful tests can run locally. No dependency change is planned.
- Use the existing quick checks and focused selector while iterating, then the
  complete applicable regression suites. Preserve logs and real exit statuses.
- Live play remains on the Mac via `tests/play/driver.ts` RPC and `bin/pi-coc`.
  The root agent is the only player, one natural message per actual Keeper turn.
  No scripted player, fake Keeper, keyword router or synthetic acceptance log.
- Explicit live profile: `minimax-cn/MiniMax-M3.1-Flash-Preview`, medium, final
  author and supporting lanes included. Only observed quota exhaustion permits
  `grok-build/grok-4.5`, high; preserve that error and verify the actual switch.
- Read the test storage contract before creating data (done). Reuse a retained seed
  through `scripts/test-workspace.mjs` or driver `--seed-home`, with default 4 GiB
  seed / 512 MiB changed+raw output / 10 GiB free-space admission. Record actual
  paths and before/after capacity at test start. Fresh small synthetic fixtures use
  the existing scratch lifecycle; formal campaigns and all live evidence persist.
- Travel tests follow the actual fiction across several kinds and scales of place.
  They include return, local positioning, compatible improvisation and an actual
  obstacle when encountered. A local stress excursion is not claimed as a complete
  mystery or chapter. Counts alone are not acceptance.
- Report actual provider request declaration/history size, available cache/input
  usage and latency separately. No token/latency saving is assumed from source bytes.

## Current state

- Goal is active. Design and two GPT-6 Pro rounds are retained in the linked research.
- Current owner clarification supersedes the draft's optional-guidance-only Mod
  boundary. Supporting kernel work is explicitly authorized.
- Next: publish section 242 and file the bounded implementation issues, then execute
  EL-01 through EL-05. No implementation validation has yet been claimed.

## Implementation checkpoint

- Section 242 and six issues are filed (#115–#120). The package is `enhanced-locations` 1.0.0, state version 1, requiring `locations.v1`.
- One typed place effect serves direct submit, native output and mixed apply. Canonical movement owns actual arrival and time; local position and observable features live in Mod state.
- A real RPC regression exposed the legacy scene-part fallback swallowing an explicitly new child. New registration now uses exact identity before minting; no qualified child is silently replaced by its parent.
- RPC integration: 4/4 passed on leehow-pc; log `/home/leehow/leehow/code/wt/codex-tests/.pytest-runs/chatrpgv4-wt-pi-coc-v2/run.elEDqAlk/remote-integration.log`. Earlier failing logs retained.
- Context projection keeps a stable small place entry and removes detailed location grammar from the resident apply declaration. Explicit inspection returns full canonical schemas and locked Mod sections. A request-only projection omits old host inspection detail, preserving raw history and assistant continuations. Native location schema is offered after a relevant place read in the current input, but complete canonical calls still execute without a read prerequisite.
- Concurrent unrelated rendering repairs advanced HEAD through `771fe8c62`; their changes are preserved. Heavy focused regression is running before live acceptance.

## Regression checkpoint and automatic continuation

- Specification commit: `7f412a120`.
- First LAN focused snapshot: 525 extension files, 4,634 passing / 15 failing assertions (plus skipped cases); integration 2,225 passing / 2 failing; routing loop 12/12. Log: `/home/leehow/leehow/code/wt/codex-tests/.pytest-runs/chatrpgv4-wt-pi-coc-v2/run.QcfXjXIq/remote-focused.log`. This is retained diagnostic evidence, not final acceptance.
- New interface expectations and explicit legacy instruction-budget fixture profiles are being updated; original Python/frozen results are untouched. A required `using_skill` annotation is now present in both place variants. Provider system accounting uses the actual projected location declaration.
- The existing `extension-words` unused `turn_unfinished_notice` finding is outside location scope and will be checked against baseline rather than silently altered.
- Current local structural slice: 20/20. Latest LAN targeted batch: 48/49 before the annotation fix; latest code awaits repeat.
- Shared LAN slot became busy. Unified exec session `34507` is an automatic, quiet 30-second retry of the canonical runner; it performs no source/evidence mutation while the runner reports another suite active. It runs the native-result pressure regression, annotation and original full-instruction profile checks when the slot is free. Continue by waiting on that session, then build-fetch the latest runtime and run real play. Do not treat waiting on the other owner as a blocked goal.
- A single bounded local RPC file is being used for fast feedback while heavy work remains queued to LAN. No live campaign has been started yet.
