Status: ready-for-human
Spec: docs/specs/jev-decides-llm-writes.md D-B B5 · Contract §151.4
Load the `typesafe-jev` skill first.

# 04 — Need reads locate first

Measured waste (Blood05): need-driven detail reads outnumbered fragments 8:5, re-located identical page sets, ran twice for one person under different wording, and spent full author+review on speculative deferred questions.

Scope: `source-need-answered` v1 before any reader; unlocated retention when located pages add nothing new; carrying a need on unread source units; deferred needs after frontier units; disposition recorded (`answered | unlocated | carried | read`); inventory entry.

Tests (kernel module tests + source driver with a fake adapter): an answered need resolves with no reader job; a need whose leads are only already-read pages retains `unlocated` and queues nothing, then becomes eligible after a new unit publishes; a need located inside an unread unit rides on that unit's task; a need with new located pages reads as today; a Jev outage reads as today.

## Comments

### 2026-09-28 implementation (worker, branch `claude/jev-reach-20260928-04-need-locate`)

**Contract first.** §151.4 gained five "Implementation decision" paragraphs (where each step runs, the locate's page leads for a need, eligibility, frontier order, `source-need-answered` v1) plus an accounting line. The one new host->kernel verb is a fourth attempt outcome on the existing leased method, `module.read.finish {outcome: "settled", need}`, not a new RPC method (no routing, vocabulary or `KNOWN_METHODS` change).

**What changed.**
- Kernel (`kernel-ts/modules/need-reads.ts`, new; `kernel-ts/modules/reading.ts`): `module.read.ahead` asks need reads after the pass's streamed units, with `source_need: <need key>`; a `deferred` need waits until no streamed unit is unqueued; settled needs wait for eligibility. `module.read.request` validates the key against the retained need (same focus and question) and marks the job `source_need: {key, kind, node_id}` without changing its identity. `module.read.claim` gives a *background* marked job `source_need` (need, `accepted_pages`, `material_digest`, `unread_units`) and a unit job `carried_needs`. `finish {outcome: "settled"}` validates the host's report (unlocated: no lead outside accepted pages; carried: units this module streams and every new lead inside them; answered: Noul at or above its gate), records `reading.source_need_dispositions[key]`, and for `answered` removes the need in a new generation and appends it to `resolved_source_needs` with `resolved_by: "accepted_material"`. A settled attempt never satisfies a request without the marker; a normal publication of a marked job records `read`.
- Host, native child (`runtime/jev/source-need-reads.ts`, new; `runtime/jev/source-reader-driver.ts`): before the catalog, one `source-need-answered` Noul over the code-rendered entity material; after the locate, a `source_need` facet's leads (one Noul per page, plus the section Choice/exists) decide unlocated/carried/read by page arithmetic, and the cached navigation keeps those leads. A non-`read` disposition writes `need-disposition.json` and finishes without inference. The driver takes an injected decision port for tests.
- Host, reading service (`extensions/module/reading-service.ts`): copies `source_need`/`carried_needs` into task.json; reads the receipt only from a native child run for this exact task; writes `need_disposition` on the read row and one `event: "source_need"` row; settles non-`read` dispositions and runs `module.read.ahead`; a unit reader with carried needs gets `CARRIED_NEEDS_ASK` in its brief.
- Data: `source_need_answered {min_noul: 0.85, timeout_ms: 20000}` in `content/rulesets/coc7/host-budgets.json`. Inventory: the SL-00 entry of `createSourceReaderDriver` (json + md) names the new family, owner, gate, lease and fallback (no new call site).

**Decisions recorded in §151.4.** Eligibility of `unlocated` is a change of the entity's material digest (refines "a later unit publication": an untouched entity reproduces the same cached decision). `carried` re-opens when every carrying unit completed or failed, and the next pass's answered check closes it; the kernel never assumes the unit answered. A read a Keeper promoted to foreground before its claim reads as today.

**Tests (single files on the Mac).**
- `tests/extension/ts-kernel-modules.test.mjs` +4 (`§151.4` cases: answered closes with no reader and a waiting Keeper still gets a fresh read; unlocated queues nothing until the entity material changes; a deferred need waits for the unit frontier, rides on the unread unit's task and re-opens once it settles; a promoted read reads as today and records `read`): 97/98 pass, the one failure is the pre-existing "real source checker" case that needs the emitted runtime under `build/`.
- `tests/extension/source-reader-driver.test.mjs` +6 (real four-page PDF, fake decision port: answered before catalog; unlocated plus the cached decision; carried; read on a new page; Jev outage reads; review child / no need never decides): 16/16.
- `tests/extension/reading-service.test.mjs` +2 (settled attempt finishes `settled` with no review/publication; `read` and a foreign receipt never settle): 37/38, the one failure is the pre-existing "reviewed selected entrance" case that needs `build/`.
- Also green: `system-language`, `control-flow-inventory`, `source-reference`, `consequence-host-budgets`.
- Mutation checks (file copied aside, mutated, test run, copied back): 19/19 killed -- frontier wait, eligibility, answered graph removal, foreground packet, settled-request handling, carried packet, claims in the material digest, unlocated validation, `read` record; driver answered step, settle after locate, need facet, complete-pass rule, cached leads, gate, carried rule; service settle, settle-on-read, task copy.

**Not done / open.**
- The Keeper still sees an unlocated need as an ordinary open `source_need` (never "absent"); the `unlocated` label itself lives in `reading.source_need_dispositions` and telemetry, not in the capsule (user story 24 is only partly met).
- `min_noul` 0.85 is not calibrated; no live Jev call was made (not in this ticket's scope). Acceptance 08(a) should report the answered distributions.
- In reference mode a deferred need now waits for the whole unit stream; on-demand Keeper reads are unaffected.
- The two-per-pass bound still lets a need whose ordinary read failed hold a slot (pre-existing behaviour, unchanged).
- Suites that need the emitted runtime (`reader-submit`, `reading-priority`, `prefetch-scheduling`, and one case each in `ts-kernel-modules` / `reading-service`) could not run in this worktree (no `build/`).
