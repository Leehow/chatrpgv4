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

Status: ready-for-agent
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

Status: ready-for-human (implemented 2026-09-26 on `claude/br05-travel-minutes-20260926` at `de2023d3b` — code `dd377c985`, starter data `de2023d3b`; awaiting review and merge, see Comments)
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

### 2026-09-26 — BR-05 implemented (`claude/br05-travel-minutes-20260926`, code `dd377c985`, starter data `de2023d3b`)

Contract: `docs/kernel-rpc.md` §138.9. What and where:
- **Registry.** `kernel-ts/rules/bands.ts` gains `route-to.travel_minutes` → `time-costs` · `categories`, `supplies:
  "default"`, rows restricted to `local_travel` / `long_travel`; `bandRows` refuses a default outside its range and a
  registry row the table lacks.
- **The one writer.** `kernel-ts/modules/route-travel.ts` (no imports; the kernel and the host load it):
  `applyTravelFill` writes the row's `default` (or 0 for `adjacent`) and `travel: {basis: "banded", band, confidence}`
  on every untimed `route-to` between the two scenes of an entry; `sameRoad` first times the other direction of a road
  already timed one way (`{basis: "stated"}` when the source has no provenance); a relation with minutes is never
  touched; an entry that does not fit is skipped with its reason. `preserveTravel` keeps a road's minutes when
  `assembleVisual` rebuilds relations from claims at the next publication.
- **The question.** `runtime/jev/travel-band-domain.ts` (family `travel-fill` v1): one Choice per road (an unordered
  scene pair), criteria = `adjacent` + each travel row by its own name and range, state = the two scenes' name, summary,
  places and place words (no ids), at most 12 roads per request, requests in parallel, gate `PI_COC_BAND_MIN_CONFIDENCE`
  (default 0.5). Host glue `extensions/module/travel-fill.ts` (`askTravel`, the one new `createDecisionAdapter` site,
  registered in the SL-00 inventory as an app-play-gated leaf; `createTravelFill`, `unfilledRoads`, `newRoads`).
- **Seam (a), PDF books:** the reading service asks the roads a draft adds just before `module.read.finish`, which gains
  `travel?: [{from, to, band, confidence}]` and applies it inside the same publication (result `travel: {filled,
  skipped}`); wired in `extensions/module/index.ts` and `pipicoc/onboarding-worker.ts`. Not the registration fallback:
  the pipeline has a host step after the reader, and Jev is there.
- **Seam (b), starters:** `scripts/fill-starter-travel.ts`, run once with live Jev (key from the App vault through a
  scratch preload, never written anywhere).

Decisions taken inside the ticket's scope:
- **One question per road, not per relation.** A road is an unordered scene pair; both directions (and duplicate
  relations) take the one answer, so "the same road is the same length" holds in both directions. 141 relations were
  asked as 89 roads.
- **Inside the publication, not a second generation.** `module.read.finish` is the one publication entry (§22); a
  separate generation would move the source revision under a turn's own source preparation (§122) between its advance
  and its validation. The step never fails a reading: a throw leaves the publication as before, a bad entry is skipped,
  a broken table is `table_unavailable`.
- **`stated` today.** The reader emits no time on a road (claims carry no properties; `time_cost` is catalogued for
  `rule` / `hazard` only, and reading a rule's time as a road's is a semantic judgement). So `stated` is minutes the
  graph already carries, left alone and never asked, and the other direction of such a road (`sameRoad`).
- **12 roads per request**, below the packing limit, because every question reads the shared state (the skill's "large
  irrelevant state" failure). **Only new roads are asked at a publication** (a restated `known_claims` claim is not);
  a road published while Jev was down stays at 0 until the book is rebuilt.
- **Starter bytes and what is bound to them.** The script edits relation properties in place (the reviewed diff is the
  roads only; it refuses to write if anything else in the parsed graph would change), updates mystery-house's manifest
  digest, and re-keys the bundled character guidance of the-haunting and mystery-house (`graph_sha256`, `fingerprint`)
  after reproducing each old fingerprint with the App's `guidanceFingerprint` — without that, both starters would
  silently drop their reviewed guidance and regenerate it per install. The guidance text is untouched. **Owner to
  confirm this re-keying is acceptable.**
- `tests/play/fixtures/voice-bench/build.mjs` emits no minutes; rerunning it requires rerunning the fill.

Per-starter fill (live Jev, `jev-1.13.0`, gate 0.5; 9 requests, ≈ $0.0019, 0.4–0.7 s per starter):

| starter | `route-to` relations | roads asked | relations filled | `adjacent` (0) | `local_travel` (30) | `long_travel` (360) | left open |
| --- | --- | --- | --- | --- | --- | --- | --- |
| the-haunting | 56 | 36 | 54 | 6 (4 roads: house floors, basement, confrontation) | 48 | 0 | 2 — corbitt house ground ↔ previous tenants, 0.43 (adjacent 0.61 / local 0.38) |
| mystery-house | 77 | 47 | 71 | 14 (8 roads) | 55 | 2 (the Costas' rooms ↔ Danvers visiting ward, 0.58) | 6 — Crane's Office ↔ the Costas' rooms 0.48, Crane's Office ↔ Crowe House ground floor 0.49, alley gossip ↔ the Costas' rooms 0.42, open street ↔ rotten wharf 0.32 |
| voice-bench | 2 | 1 | 2 | 2 (teahouse ↔ dock, 0.75) | 0 | 0 | 0 |
| the-haunting-rulebook | 6 | 5 | 6 | 4 (3 roads) | 2 | 0 | 0 |

Every left-open road is below the gate (none unanswered, none unconfigured). One judgement worth a look: mystery-house's
Danvers ward is `long_travel` (360 min) from the Costas' rooms but `local_travel` from the North End clinic (0.71) —
Jev's answers as given; the band is data, correctable by a later run with a better state or by hand review.

Tests (single files on the Mac; kernel rebuilt before each pytest; nothing run in parallel):
- New: `tests/kernel/test_route_travel.py` 11/11 (every shipped road's minutes a banded default or absent, both
  directions agreeing, ×4 starters; a move to a filled exit lands with the road's minutes and moves the clock in the one
  call; `local_travel` 30 / `long_travel` 360 / `adjacent` 0 through `module.read.finish`; no `travel` leaves `{}`; five
  bad entries skipped by reason while the reading publishes; a filled road survives the next publication and is never
  overwritten). `tests/extension/travel-fill.test.mjs` 8/8.
- Adjusted for the data (expectation only where travel is not the subject, or reading the edge where it is):
  `test_starters.py` 8/8 (reprojection diff with the road keys stripped, asserting they sit on `route-to` only;
  pre-RD-04 diff = RD04_CHANGES + exactly the filled roads' two keys), `test_apply.py` 20/20 (the default move now
  asserts the edge's minutes), `test_narrate.py` 9/9 (the scene card's minutes read from the edge),
  `test_rules_families.py` 16/16 and `test_worldline_due.py` 8/8 (the confrontation walk passes `travel_minutes: 0`, as
  the parent's walk effectively was), `ts-kernel-read.test.mjs` 111/111 (the captured oracle outcomes answered the
  graph before the data change, so the roads are read as they were; captures untouched).
- Re-run green: 38 kernel files, 580 passed / 0 failed (including `test_worldline*`, `test_corpus`, `test_capsule*`,
  `test_visual_reading`, `test_band_operations`, `test_system_language`, `test_rules_tables_register`); 44 extension
  files, 652 passed / 0 failed (including `reading-service` 27, `band-recovery` 8, `control-flow-inventory` 4,
  `system-language` 5, `turn` 32, `ts-kernel-modules` 78, `continuity-adaptation` 43). `npm run check:kernel` clean.
- Golden walk (parent kernel `da64930f5` + parent content vs this branch, each starter, frozen clock, seed 5, the move
  with `travel_minutes: 0`): 24/24 reads of `table.capsule`, `table.apply.options`, `table.resolve.options` at the start
  scene and after one move identical except the exits' travel minutes in their two projections (`where.exits[]`, the
  move candidates' `description.travel_minutes`) and the three digests that fold the graph's bytes
  (`_context.source_revision`, `_context.task_source_revision`, `table.apply.options.revision`); 10/24 byte-identical
  raw (all `resolve.options`, and the rulebook's `apply.options`, whose start scene has no `route-to`).

Mutation record (each restored by copy afterwards):

| mutation | caught by |
| --- | --- |
| the stated-minutes guard dropped (`unfilledRoad` true for any `route-to`: overwrite) | kernel `test_a_filled_road_survives_the_next_publication_and_is_never_overwritten`; node "the writer", "the roads asked", the gate test, the failed-request test |
| the default replaced by a roll inside `[min, max]` | kernel `test_a_publication_lands_the_hosts_band_as_the_rows_default[local/long]` and the survive test; node "the writer" |
| `adjacent` writes the category default instead of 0 | kernel `…rows_default[adjacent-0]`; node "the writer" |
| the gate removed (below-gate answers written) | node "above the gate…" and "below the gate, without a key, or when the step throws…" |
| the re-assembly drops the minutes (`preserveTravel` removed from `assembleVisual`) | kernel survive test |
| `module.read.finish` ignores `travel` | kernel `…rows_default` ×3, the skipped test, the survive test |
| the reading service does not send the bands | node "the reading service sends the named band…" |
| `sameRoad` removed | node "the writer" |
| the move ignores the edge (`minutes = 0`) | kernel `test_a_move_to_a_filled_exit_lands_with_the_roads_minutes` |

Not covered here: the turn-3 replay (`experiments/single-loop-routing`: the clerk's move to the morgue carrying the edge's
minutes, the recorded Keeper `time 25` reported as redundant) is the integrator's; the full `test:ext` and `pytest
tests/kernel tests/play`; a live PDF book publication through the real reader (the reading-service seam is covered by the
scripted-reader test and the kernel publication tests); whether the Keeper stops writing a road's `time` (no prompt
change; the kpi and offer ledger will say).
