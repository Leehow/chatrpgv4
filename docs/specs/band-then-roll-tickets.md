# Band then roll — tickets

Spec: [band-then-roll.md](band-then-roll.md) (`Status: ready-for-agent`, BR-06 `ready-for-human`).
Parent: [pi-native-single-loop.md](pi-native-single-loop.md) (ruling **Parameter binding never goes to the LLM**,
contract §135.28); [rules-as-data.md](rules-as-data.md) (§136.22 `stated`).

State: **BR-01 first; BR-02, BR-03, BR-04 and BR-05 in parallel after it; BR-06 blocked on the owner's ruling and
BR-04's report.**

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

Status: ready-for-agent
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

Status: ready-for-human
Depends on: the owner's ruling (spec Further Notes: *may the clerk land the banded time of the player's own
declared action, and the banded damage of a book-stated hazard, when the rung clears its gate?*), BR-04's report,
BR-01, BR-05.

**What, if ruled yes.** The candidate builder issues a `time` band candidate for the player's declared action
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
