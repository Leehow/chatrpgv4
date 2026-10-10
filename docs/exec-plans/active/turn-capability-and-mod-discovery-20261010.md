# Turn Capability and Mod Discovery — Execution Plan (20261010)

Status: approved for implementation of #112, solo. No acceptance gate is checked.

## Approval

- Approved spec: `docs/specs/turn-capability-and-mod-discovery.md`, tracking issue #112.
- Approval: the current user explicitly authorized implementing #112, working solo.
- Scope of this plan is limited to the work recorded here.

## Objective

Replace the all-tools and whole-instruction default with turn-scoped capability and schema discovery, integrated into the existing hybrid RunDriver, context assembly, Jev decision port, Mod catalogue and section read, and canonical dispatcher, per the approved spec.

## Baseline

- Initial HEAD: `4ccc69e45`, on latest 0.9.7a.
- The spec's baseline reference is ca51d7dfc; migration impact is reported against it separately.

## Foreign dirty files (not owned by this plan)

These belong to the active pytest optimization thread. They must not be staged, committed, adopted or reverted by this work:

- `README.md`
- `docs/kernel-rpc.md`
- `kernel-ts/json.ts`
- `scripts/select-tests.mjs`
- `tests/extension/ts-kernel-foundation.test.mjs`
- untracked `tests/extension/test-selection.test.mjs`

## Acceptance (all unchecked)

- [ ] Contract amendment applied after the shared contract file is clean.
- [ ] Pure schema and capability view parity verified at the public `context_with_system` seam.
- [ ] Versioned Mod index and detail selection implemented.
- [ ] Expansion, readiness and telemetry implemented.
- [ ] Focused and full LAN gates pass.
- [ ] Held-out semantic matching meets pre-registered gates.
- [ ] True GUI or canonical driver acceptance passes.
- [ ] SQLite compatibility regression requirements (spec section) pass.

## Scope

- Capability split of the apply definition into semantic fragments, including npc and object subvariants, with unchanged validation.
- Versioned capability and Mod catalogues with index cards and immutable detail references.
- Two-stage selection (batched Jev relevance, then per-candidate detail questions) with deterministic host prerequisites.
- Lookup kind for read-only capability discovery and expansion.
- Readiness gate holding all effects before mutation when required material is missing.
- Index-first loading for new Mod versions only, with explicit bounded fallback.
- Public request projection and active tool declarations, without vendor patches.
- Telemetry separating request bytes from provider tokens.
- SQLite compatibility per the approved spec: source metadata through ModuleStore/sourceMetadata; no stale JSON fallback; snapshot binding; no DB transaction held across model work.

## Non-goals

- No change to the seven-verb canonical surface or to canonical apply atomicity.
- No relaxation of field shapes or constraints; selector never authorizes actions.
- No re-enabling or silent upgrade of existing legacy or locked Mod versions; legacy-full remains.
- No Python restoration.
- No Historical Reference timeout fix, no provider or model default change, no RunDriver replacement.
- No package, restart, push, delete or publish.
- No new chats, subagents or model switches.
- No Internet downloads.
- No copying or adoption of the SQLite migration branch's work; it is consumed through its published interface when integrated.

## Infrastructure

- SQLite worktree is separately owned and not integrated.
- LAN probe selected `amax` for source tests and builds. Keep one heavy task per box.
- Live models and the GUI stay on the Mac.
- Preserve all evidence, campaign data and logs.

## Ordering

1. Contract amendment after shared file is clean.
2. Pure schema and capability view parity at the public seam.
3. Versioned Mod index/detail selection.
4. Expansion, readiness and telemetry.
5. Focused and full LAN gates.
6. Held-out semantic matching and true GUI/driver acceptance.

## 2026-10-10 initial implementation checkpoint

- Owned pure capability catalogue and schema projection are drafted in extensions/table/capability-catalogue.ts. They are not wired into production. Canonical validators remain unchanged.
- Four focused local Node 24 tests pass: mixed temporal schema constraints, whole-batch missing-view detection, new-field ownership refusal, and public system projection preserving original evidence. The first run exposed a stale test-only TypeBox import; corrected to the existing typebox/value package, with no dependency change.
- A read-only experiment on retained genuine GUI session declarations measured apply 58,139 bytes to 11,647 bytes for a temporal subset; no semantic or live speed claim.
- SQLite compatibility clauses were added to the spec. A proposed contract 209 is retained in the implementation report directory; canonical docs/kernel-rpc.md is still owned by the active test optimization task. Do not stage its foreign edits.
- Next: land the contract when shared file is clean, then catalogue decision runtime and actual request/dispatcher hooks. All end-to-end and release gates remain unchecked.
