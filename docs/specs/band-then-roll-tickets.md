# Band then roll — tickets

Spec: [band-then-roll.md](band-then-roll.md) (`Status: ready-for-agent`, BR-06 `ready-for-human`).
Parent: [pi-native-single-loop.md](pi-native-single-loop.md) (ruling **Parameter binding never goes to the LLM**,
contract §135.28); [rules-as-data.md](rules-as-data.md) (§136.22 `stated`).

State: **BR-01 merged into `0.9.5a` (2026-09-26); BR-02, BR-03, BR-04 and BR-05 in parallel; BR-06 unblocked by the
owner's ruling the same day and waits only on BR-04's rows and BR-05.**

Common constraints for every ticket (from `Agents.md`): contract first (`docs/kernel-rpc.md`, a new section at
the next free number, amending the sections the spec names; §-numbers are stable ids, never renumber);
`kernel-ts/` is the only kernel; system language English, no CJK in code; no hard-coded semantic lists (a band
table's rows are the only vocabulary, read from rules-json); a kernel field and its tool-schema field ship
together and the kernel is restarted with the rebuild (a schema without the kernel refuses every retry); build
before pytest, one pytest at a time, on the ticket's own worktree; stage only the ticket's paths; report the
commit hash; no packaging. Implementation workers run on `opus`; measurement and test-only workers on `sonnet`;
no worker on Fable. Every product-behaviour test must be killable by a mutation, recorded in the ticket's
Comments.

## Dependency graph

```
BR-01 contract + schema + kernel band + registry ─┬─ BR-02 archetype/weapon recovery in the dispatcher
                                                  ├─ BR-03 creator preset (enhanced-items new version)
                                                  ├─ BR-04 shadow lane + report ──┐
                                                  └─ BR-05 travel minutes as data  │
                                                     owner ruling ─────────────────┴─ BR-06 execute time/damage bands
```

---

## BR-01 — The band registry, `band` on `time` and `damage`, and the kernel's roll

Status: ready-for-human (implemented 2026-09-26 on `claude/br01-band-then-roll-20260926`, merged into `0.9.5a` by fast-forward at `667d64507`; suites recorded under Comments; owner review of the merged section pending)
Depends on: nothing open.

**What.** Write the contract section (spec D1–D4, D10): the fifth binding path, the closed band registry (the
four tables and the field each binds, spec D2 table), `band` on the `time` and `damage` effects, the three
refusals (`band_unknown`, `band_conflict`, `band_none`) with `fix` texts naming their `details` keys, the
receipt fields (`basis: "banded"`, `band`, `band_roll` / the damage roll), and what is never a band (D10).
Implement: the registry beside the §136 catalog; `band` resolution and the seeded roll inside the apply
transaction (uniform integer in `[min, max]` for time with `kernel.rng`; the rung's `damage_expr` for damage
where `dice` is rolled today); `stampBasis` gains `banded`; the tool schema offers `band` on `time` and `damage`
only; the fake kernel answers `band` and refuses `band_conflict`; `time-costs.json` `source_note` rewritten to
say what the table is now (no row changes). `BindingPath` gains `'banded'` and the bind row gains `table`,
`band`, and the roll (spec D8); no consumer binds it yet in this ticket.

**Acceptance** (spec Testing Decisions, kernel and schema rows).
- Kernel over RPC on a derived haunting: banded time inside the range with basis, band and roll; same seed same
  total; banded damage rolls the rung's dice; every refusal by its reason with nothing written; replay returns
  the journaled total; rest and MP recovery fire on a banded time as on a Keeper's.
- Schema test: `band` on `time` and `damage` and nowhere else; every old shape valid; fake kernel behaviour.
- Every starter's capsule, `table.apply.options` and `table.resolve.options` byte-identical to the parent
  commit (no read changes here).
- `npm run test:ext` and `uv run --frozen python -m pytest tests/kernel tests/play` green on the rebuilt kernel.
- Mutation record: the roll replaced by `min`; the basis stamped `keeper`; `band_conflict` removed; each caught.

---

## BR-02 — The dispatcher pins a tier or a profile on the kernel's `needs`

Status: ready-for-human (implemented 2026-09-26 on `claude/br02-band-needs-recovery-20260926`, merged into `0.9.5a` by fast-forward; suites recorded under Comments; owner review of §138.6 pending)
Depends on: BR-01 merged.

**What.** Spec D5. In the kernel extension's canonical operation dispatcher: on a `needs` refusal whose `field`
is in the band registry (`archetype`, `weapon`), ask Jev the band question (archetype: Choice over the tiers,
criteria from the table's fix text per tier, state = the person's `present[]` dossier and the declaration that
needed the numbers; weapon: two-level Choice, skill family then profile, beam 3, `none` exit, state = the
thing's name and `why` and any definition description); above the table's gate, write the pin as a host
operation with a call id minted from the one ordinal, through admission, then retry the refused call once; the
Keeper's tool result is the retried result plus the `clerk_did` band line (spec D8); below the gate, on a spent
budget, or with Jev unavailable, the original refusal unchanged. Guards: once per person or thing per turn;
one retry. Both engines take this path; on hybrid-v1 the bind row of a clerk candidate refused `needs` reads
`path: "banded"`. Gates are code constants, initial values documented as placeholders. `kpi.py` counts
receipts by basis per kind (spec D8).

**Acceptance** (spec Testing Decisions, dispatcher rows): every case listed there through the vendored driver
with stub decision ports, on both engines; the Keeper's tool result text asserted, the refusal byte-identical
below the gate; the anti-repeat guard asserted with a Jev call count of one; `test:ext` and pytest green.
Mutation record: the retry loop unbounded; the minted id replaced by a self-made one (must be refused
upstream); the guard removed; each caught.

---

## BR-03 — The item creator copies a host-chosen preset

Status: ready-for-human (implemented 2026-09-26 on `claude/br03-creator-preset-20260926` at `4759ca090`; awaiting review and merge, see Comments)
Depends on: BR-01 merged (the registry and the weapon band question shape); independent of BR-02.

**What.** Spec D7. The kernel's definition and usage job packet gains `request.preset` (the weapon profile the
host chose by the two-level band question, with confidence) when the answer clears the gate; the enhanced-items
package at a new version: the creator copies the preset's weapon parameters field for field and departs only
where the description states a physical contradiction, saying so in `basis`; the auditor refuses a departure
without such a statement. Without a preset the package behaves as today. Spell and item categories unchanged.
The package's digest is re-registered for the new version; the old version keeps its bytes and digest.

**Acceptance** (spec Testing Decisions, creator row): the packet carries `preset` only above the gate; the
auditor's refusal and acceptance cases; a packet without a preset accepted as today; both package versions
load at their digests; the existing enhanced-items tests green. Mutation record: the auditor's preset check
removed; the preset dropped from the packet; each caught.

---

## BR-04 — The shadow lane for the Keeper's `time` and `damage`, and its report

Status: ready-for-agent
Depends on: BR-01 merged (the registry and question shapes). Worker model: `sonnet` (measurement).

**What.** Spec D9. After a model-origin `apply time {minutes}` or `apply damage {dice}` succeeds, ask the band
question in the background from the player's declaration and the receipts settled before that call (never
the Keeper's `why` or number) and write one `lane: "band-shadow"` row with every D9 field; execute nothing,
change nothing, hold nothing. A report script over the rows (per table, per kind): hit rate of the Keeper's
number inside the argmax band, rate above each candidate gate, Jev seconds. Run it over the next real tables
and file the report under this ticket's Comments; that report is BR-06's evidence.

**Acceptance.** The shadow row for a model-origin write with every field; none for a clerk or `stated` write;
the turn record byte-identical to the parent's; the tool result not delayed (timestamps asserted); the report
script's numbers reproduced from a fixture of rows; `test:ext` green. Mutation record: the recording removed;
the Keeper's `why` leaked into the state; each caught.

---

## BR-05 — Travel minutes are data, filled once at build

Status: ready-for-agent
Depends on: BR-01 merged (the registry). Independent of BR-02–BR-04.

**What.** Spec D6. Module registration fills `travel_minutes` on every `route-to` relation that lacks it:
from a stated travel time when the reader extracted one, else by one Jev Choice over the travel categories of
`time-costs` per edge in the build (state = the two scenes' names, summaries, places), taking the category's
`default`, never rolled; the edge records `travel: {basis, band?, confidence?}`; an edge with minutes is
untouched. Regenerate the shipped starters once and review the diff (only `route-to` relations change). The
contract section records the fill and its provenance; the capsule's `exits[].travel_minutes` is unchanged as a
projection. No prompt change.

**Acceptance.** Registration of a starter with an unfilled route fills it with provenance; a stated route
untouched; every capsule and options golden unchanged except `exits[].travel_minutes`; the turn-3 replay's
clerk move carries the edge's minutes and the Keeper's recorded travel `time` is reported as redundant (not
scored); `test:ext` and pytest green. Mutation record: the fill skipped for a stated edge (must not
overwrite); the default replaced by a roll; each caught.

---

## BR-06 — Execute time and damage bands as clerk writes

Status: ready-for-agent (the owner lifted the three rulings on 2026-09-26, recorded in the spec's Further Notes)
Depends on: BR-01 (merged), BR-05 (a move carries its road's time before a time band is offered), BR-04's shadow
rows (the gates are calibrated from them, not guessed).

**What.** The candidate builder issues a `time` band candidate for the player's declared action
(the time-cost categories minus travel) and a `damage` band candidate for a book-stated hazard whose step the
turn reached (§136.20); both bind `banded` and run direct above the gate; below the gate the Keeper's; the
contract amends §135.3's clerk authority list and §136.24 by a new section. If ruled no, close this ticket
`wontfix` and leave the shadow lane running as the measurement.

**Acceptance (to be written with the ruling).** The loop's bind rows and receipts; the turn-3 and fight
replays' LLM step counts before and after; a live gate.

## Comments

### 2026-09-26 — BR-01 implemented (`claude/br01-band-then-roll-20260926`, `a8999b981` + review fixes `5b8ef9a6b`)

Contract: `docs/kernel-rpc.md` §138 (138.1 the fifth binding path, 138.2 the registry, 138.3 `band` on `time` and
`damage` with the three refusals and the receipt basis, 138.4 tools and fake kernel, 138.5 tests). Code:
`kernel-ts/rules/bands.ts` (registry, `bandRows`), `kernel-ts/apply/band.ts` (`bindBand`, after `bindStated` in the
apply loop), `stampBasis` gains `banded` / `band` / `band_roll`, `extensions/kernel/tools.ts` offers `band` on the two
effects, the fake kernel answers it, `BindingPath` gains `'banded'` and `BindRecord` its `table` / `band` / `roll`,
`time-costs.json` keeps every row and gets a true `source_note`, `test_rules_tables_register.py` drops `time-costs` from
the unread list (it now has a reader).

Tests: `tests/kernel/test_band_operations.py` (12 cases: inside the row with basis/band/band_roll; same seed same
total; the roll is the seeded dice and not the row's min/default/max, pinned as forced values 242 / 363 for seeds
11 / 12; banded damage on both receipts; the Keeper's own amount stays `keeper`; `band_conflict` beside `minutes`,
`dice` and `stated`, nothing written; `band_unknown` listing the rows; `band_none` on cash; handle folding; a
malformed table is `campaign_not_ready` and writes nothing; replay returns the journaled total; a banded night returns
the hit point a banded scratch took) and `tests/extension/band-operations.test.mjs` (schema on exactly the two kinds,
old shapes valid, pass-through, refusals reach the Keeper).

Mutation record (each run over the kernel test file, restored by copy afterwards):

| mutation | caught by |
| --- | --- |
| the roll replaced by the row's `min` | `test_the_roll_is_the_seeded_dice_and_not_a_fixed_figure_of_the_row` |
| `basis` stamped `keeper` for a banded effect | the banded-time and banded-damage cases |
| the `band_conflict` refusal beside the amount removed | `test_band_beside_the_amount_it_fills_is_a_conflict_and_nothing_is_written` |
| the roll taken from `Math.random` instead of the seeded dice | the same-seed case and the forced-seed case (the replay case still passes: the journal, not the dice, is what makes a replay identical) |

Golden walk (every shipped starter — the-haunting, mystery-house, voice-bench, the-haunting-rulebook — capsule,
`table.apply.options`, `table.resolve.options` at the start scene and after one move, frozen clock, seed 5): 24 of 24
reads byte-identical between the parent commit's kernel (`dbc502675`) and this branch's.

Code review (high): seven findings, five fixed in `5b8ef9a6b` (the handle now folds with `tableSlug`; refusals throw
at the site, no non-null assertions; the fake kernel's `band_conflict` mirrors the real shapes; one shared
`refusalOf(field)` factory for `stated` and `band`; the malformed-table refusal has its test), one recorded as a
documented boundary (a row with `min` 0 may roll 0 minutes, §138.3), one skipped (per-effect `RuleTables`
construction; the same pattern as `apply/archetype.ts`).

Suites on leehow-pc at the merged commit `667d64507` (the box at load 60 with two other sessions' suites in flight):
`test:ext` 2839 / 2842, the three reds being 3–16 s process tests (continuity audit's stalled preparation, NPC
preparation overlap, the TS RPC close) that pass 56 / 56 when their three files run alone on the Mac; `pytest
tests/kernel tests/play` 1722 passed, 2 skipped, 2 failed, both `tests/play/test_driver.py` (status after stop on the
loaded Linux box) and 63 / 63 on the Mac, where the driver runs. Nothing in either set touches a band.
Merged into `0.9.5a` by fast-forward (the shared checkout was clean and its tip was still the branch point).

### 2026-09-26 — BR-02 implemented (`claude/br02-band-needs-recovery-20260926`, `77210fc41`)

Contract: `docs/kernel-rpc.md` §138.6. Where it lives: the recovery sits in the kernel extension's execute stage
(`runTool`'s catch, beside the source-preparation retry), not in the dispatcher's `dispatch` — that is the one
function every Keeper call and every clerk call passes through on both engines, and it already owns the retry of a
refused identity. Code: `runtime/jev/band-recovery-domain.ts` (the two questions, pure), `extensions/kernel/band-recovery.ts`
(needs detection, gates `PI_COC_BAND_MIN_CONFIDENCE` / `PI_COC_BAND_JEV_TIMEOUT_MS`, the dossier projection, the composed
`why`, the note, the lease and budget), `extensions/kernel/index.ts` (`recoverBandNeeds`: look the person up, ask, pin
under a minted call id through admission and the Mod gates, retry once; the note kept in front of the defence's),
`kernel-ts/apply/inventory.ts` (the weapon refusal carries `needs.profiles` as host-only detail), `runtime/jev/hybrid-engine.ts`
(the clerk note's band line), `tests/play/kpi.py` (`basis`: receipts by basis, pins by banded/keeper).

Decisions taken inside the ticket's scope: a profile is set only on a model-origin apply (a tracked clerk request may
not change after preparation, `operation_prepared_request_changed`); a tier is pinned for the `target` of a `resolve`
only; the tier descriptors are the kernel's own refusal wording, held as descriptors of a closed enum in the domain
(the `DEFENSE_OPTIONS` precedent), not read from prose; the gates default to 0.5 for both tables as placeholders.

Tests: `tests/extension/jev-band-recovery-domain.test.mjs` (5), `tests/extension/band-recovery.test.mjs` (8, the
extension over the fake kernel with a controlled typed endpoint, including a retry refused after a landed pin and a
pin the kernel refuses), `tests/play/test_kpi.py` (+1); the kernel's `test_apply_item_cash.py` still green on the
rebuilt kernel with `needs.profiles` added.

Mutation record (each run over the extension test file, restored by copy afterwards):

| mutation | caught by |
| --- | --- |
| the once-per-person guard removed | "the same person is not asked twice in a turn" |
| the confidence gate removed from the tier question | "below the gate the refusal reaches the Keeper unchanged" |
| the retry doubled | the pin case and the profile case (the write sequence) |
| the note dropped from the retried result | the pin case and the profile case (the Keeper's text) |

Not covered by a test here: a self-made call id on the pin (the fake kernel does not validate ids; the real kernel
refuses one, §135.4), and a hybrid-v1 clerk call recovered through the same path (the recovery is in the one execute
stage both engines use; the clerk note's band line is asserted by shape, not driven).

Code review (high): seven findings, five fixed in the follow-up commit (the real provider budget passed as the band
lease's parent; the catalog fallback capped at the kernel's 50; a retry refused after a landed pin carries the
recovery note and `band_recovery` in its refusal; no kernel read before the key check; the pin-refused branch tested),
one skipped (a third `clip`/`digest` copy), one recorded as a documented trace (the transcript keeps the Keeper's
pre-correction profile; the note and the receipt carry the truth).

Suites on leehow-pc at `ca6120cb5` (box load 9): `test:ext` 2853 / 2855 — one real red, the SL-00 control-flow
inventory not yet listing the new Jev call site (`askBand`), registered in `inventory-SL-00.json` / `.md` in the
follow-up commit and green; the other, `workspace-lifecycle`'s one-lock case, a 12-way parallel lock race that passes
3 / 3 alone on the Mac. `pytest tests/kernel tests/play` 1721 passed, 2 skipped, 4 failed: two kernel cases that
timed out waiting 30 s for a JSON line under `-n 12` (`test_table_branch` dormant line, `test_transactions`
idempotent replay) and pass 2 / 2 on the Mac, and the two `test_driver.py` cases the box always fails (63 / 63 on
the Mac, where the driver runs). Nothing red touches the recovery.

### 2026-09-26 — BR-03 implemented (`claude/br03-creator-preset-20260926`, `4759ca090`)

Contract: `docs/kernel-rpc.md` §138.7, plus one pointer line in the Enhanced Items "Packages, activation and upgrade"
paragraph. Code: `kernel-ts/mods/preset.ts` (new: the row projected onto the definition's parameters, the offer, the
packet block, the gate), `kernel-ts/mods/jobs.ts` (`jobPreset`: offer, choice, a queued registration's retained preset;
the preset block's digest in `identity.request`; the gate and the provenance in `acceptJob`), `kernel-ts/check.ts` (the
definition and usage checker runs the same gate from the draft's sibling `request.json`), `kernel-ts/rules/bands.ts`
(`weaponBandOptions` / `weaponRowNamed`, now shared by the kernel's `needs weapon` refusal and the offer),
`kernel-ts/apply/inventory.ts` (uses them), `kernel-ts/read/mods.ts` (capability `weapons.preset.v1`),
`extensions/mods/creator-preset.ts` (new: offer parsing, `askBand`, the rows), `extensions/mods/index.ts` (`mintJob` in
`task` and `defer`), `mods/enhanced-items` 1.3.0 (`mod.json`, `creator.md`, `CHANGELOG.md`),
`tests/fixtures/mods/enhanced-items-v122/` (the 1.2.2 package bytes; its digest equals the frozen copy retained under
the pi-coc-v2 checkout's `.coc/mods/packages/enhanced-items/1.2.2`).

Decisions taken inside the ticket's scope:
- **Where the question runs and how the preset reaches the packet.** The kernel mints `request.json` and the job id in
  one call, so the host could not add a field afterwards without breaking the retained-job key. `mods.job` takes an
  opt-in `offer_preset: true`: for a job that takes a preset the kernel answers `preset_offer` (the era's rows, the
  thing, the declaration) and mints nothing; the host asks and calls again with `preset` or without it. The kernel,
  not the host, knows the package capability, the era, a reuse, a queued marker and the object's recorded facts, so no
  extra host read exists. With neither parameter every job is minted exactly as before, so every direct `mods.job`
  caller and test is untouched; the host sends `offer_preset` only for a weapon `create` or an action `usage`.
- **Identity.** `identity.request.preset` is a digest of the whole `request.preset` block, not the id: the child can
  write its own directory, and an id-only key let an edited `preset.parameters` pass the key check and redefine what the
  gate compares against (caught by the forged-packet case below). Consequence: the same row with a different confidence
  is a different job; the host's per-process memo keeps one answer per offered job identity.
- **A queued registration keeps its preset (§129).** A later `create` whose input equals the marker's `define` reads the
  preset back from the marker's retained packet, otherwise the resume would mint a job the marker never looks at.
- **`deviations` is a structured result field**, as the lead's brief asked, rather than the spec D7 wording "saying so in
  `basis`": the gate counts statements and cannot read prose. It lives in the accepted provenance (`preset: {table, id,
  confidence}`, `deviations`), never in the definition, so `validateDefinition` and its 148-case fixture are unchanged.
- **Projection.** `uses_per_round` is the combat engine's own `parseUsesPerRound` shots when the row allows a positive
  number every round; a full-auto-only row or one use every few rounds (the Molotov's `1/2`) states none, and the creator
  decides it as before. A field the preset does not state cannot be listed as a deviation.
- **Who is offered nothing:** items, spells, audits, prefetched proposals, a reused definition or usage, a campaign
  locked to 1.2.2, and a `create` whose `template` names a weapons row (the Keeper named its evidence; it stays evidence
  as in 1.2.2). Whether a Keeper-named template should itself become the gated preset is left to the owner.
- **Era** is the first party sheet's `era`, else the module's (the inventory refusal reads one sheet; a definition has
  no owner).
- **Cost on the deferral path.** A deferred weapon definition now waits in the foreground for one band question before
  its marker lands (median about 0.3 s, capped by `PI_COC_BAND_JEV_TIMEOUT_MS`); items are unaffected.
- **`mintJob` is not async on the non-offerable path**, so every other job keeps the exact promise it had.
  `tests/extension/mods.test.mjs` "a definition child gets no shell" asserts background work immediately after
  `prepare` returns, and one extra `await` level made it read before the child ran; it is a timing-sensitive test
  (it does not wait on the condition it asserts, contrary to `tests/extension/wait.mjs`) and is left as it was.

Tests (single files, on the Mac, this worktree; the full suites are the integrator's):
- `tests/extension/creator-preset.test.mjs`: 12 / 12 (9 tests, one with three subtests) — the offer mints nothing and
  names the era's rows, the thing and the declaration; no preset without one; the projected row with one, the whole
  block as identity, `uses_per_round` unstated for `1/2`, `preset_unknown`; a queued registration keeps its preset a
  turn later; items, spells and a weapons-row template are not offered; the gate refuses an unstated departure at
  acceptance and in the checker, a forged packet, an unfounded and a malformed statement, accepts a copied and a stated
  one with provenance, and gates nothing without a preset; a usage is offered the object and gated; 1.3.0 at
  `681d03dd…` and 1.2.2 at `7714ce10…`, a 1.2.2 campaign offered nothing and a stray preset ignored; the real Mods
  extension over the kernel with a stub typed endpoint: above the gate one question (two requests) for the deferral and
  the generation beside it, bind and `band-recovery` rows naming the job; below the gate, `none` and no key minted
  without a preset with the rows saying why; a usage batch waits for its preset.
- `tests/extension/object-usages-host.test.mjs` 34 / 34 (the usage job's expected params now include
  `offer_preset: true`), `mods` 14 / 14, `mods-prefetch` 25 / 25, `mods-progress` 5 / 5, `apply-defer-any-batch`
  4 / 4, `foreground-item-core` 2 / 2, `object-usages-rpc` 2 / 2, `-stateful` 5 / 5, `-public` 1 / 1, `-scene` 4 / 4,
  `-compat` 4 / 4, `band-recovery` 8 / 8, `jev-band-recovery-domain` 5 / 5, `band-operations` 2 / 2,
  `mod-package-boundary` 4 / 4, `ts-kernel-mods` 1 / 1, `ts-kernel-mod-catalog` 5 / 5, `mod-build-skew` 6 / 6,
  `control-flow-inventory` 4 / 4 (no new Jev call site: `askBand` is reused), `system-language` 5 / 5,
  `world-state-seams` 3 / 3, `mechanics-shape` 52 / 52, `continuity-adaptation` 43 / 43, `runtime-host` 8 / 8,
  `runtime-reader` 22 / 22.
- pytest over the rebuilt emitted kernel, one file at a time: `test_mods` 42, `test_mod_checker` 1,
  `test_apply_item_cash` 11, `test_mod_order` 4, `test_mod_documents` 11, `test_band_operations` 12,
  `test_mod_director_text` 13 — all passed. `npm run check:kernel` clean.
- Golden walk (the-haunting, mystery-house, voice-bench, the-haunting-rulebook; capsule, `table.apply.options`,
  `table.resolve.options` at the start scene and after one move; frozen clock, seed 5; parent `da64930f5`): with the
  package held at 1.2.2 the branch's 24 reads are byte-identical to the parent's; as shipped, the only differences are
  the enhanced-items version (`1.2.2` → `1.3.0`) in the capsule's `mods.active` and `mods.instructions` and the
  world/source revision digests that hash the package lock. The `needs weapon` refusal is byte-identical for an exact
  id, a near name and a non-weapon name.

Mutation record (each run over `tests/extension/creator-preset.test.mjs`, restored by copy afterwards):

| mutation | caught by |
| --- | --- |
| the gate removed (no findings refused) | the gate case; the usage case |
| the preset dropped from the packet | six cases: the offer, the queued, the gate, the usage, and both host cases that copy it |
| the stated deviations ignored | the gate case (a stated departure refused) |
| identity ignores the preset | the offer case (same key for different presets); the gate case (forged packet) |
| identity binds only the preset id | the offer case (confidence); the gate case (forged packet accepted) |
| a queued registration does not keep its preset | the queued case |
| the capability check removed | the versions case (1.2.2 offered a preset) |
| the host asks again for the same job | the above-gate case and all three below-gate subtests |
| the checker ignores the packet's preset | the gate case; the usage case |

Not covered: a live Jev and a live creator child (the child here copies whatever its packet names); `kpi.py` does not
count `creator_preset` rows; a usage over a preview-staged object with a preset is exercised only by the preview
parameter reaching the same `mintJob`; the heavy suites (`npm run test:ext`, full pytest) were not run here.

