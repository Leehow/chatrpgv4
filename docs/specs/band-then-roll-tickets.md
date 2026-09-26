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

Status: ready-for-human (implemented 2026-09-26 on `claude/br03-creator-preset-20260926` at `4759ca090`; merged into `0.9.5a` by fast-forward via `claude/integ-band-20260926`; suites recorded under Comments; owner review pending)
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

Status: ready-for-human (implemented 2026-09-26 on `claude/br04-band-shadow-20260926` at `b21497dbf`, review fix `c1966c729`; merged into `0.9.5a` by fast-forward via `claude/integ-band-20260926`; suites recorded under Comments; owner review pending)
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

Status: ready-for-human (implemented 2026-09-26 on `claude/br05-travel-minutes-20260926` at `de2023d3b` — code `dd377c985`, starter data `de2023d3b`; merged into `0.9.5a` by fast-forward via `claude/integ-band-20260926`; suites recorded under Comments; owner review pending)
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

Status: ready-for-human (implemented 2026-09-26 on `claude/br06-band-clerk-20260926`; contract §138.10; see Comments)
Depends on: BR-01 (merged), BR-05 (a move carries its road's time before a time band is offered), BR-04's shadow
rows (the gates are calibrated from them, not guessed).

**What.** The candidate builder issues a `time` band candidate for the player's declared action
(the time-cost categories minus travel) and a `damage` band candidate for a book-stated hazard whose step the
turn reached (§136.20); both bind `banded` and run direct above the gate; below the gate the Keeper's; the
contract amends §135.3's clerk authority list and §136.24 by a new section. If ruled no, close this ticket
`wontfix` and leave the shadow lane running as the measurement.

**Acceptance.**
- The single loop issues one `apply:time:declared` candidate per run outside a session, from the kernel's own
  `rules.bands` rows without the road rows; its route question is a fact about the declaration (does it cost table
  time), its bind is the shadow lane's own time question, and above the table's gate the clerk writes
  `apply time {band, why}`; the receipt lands `basis: banded` with the kernel's roll, the `lane: "run"` bind row
  carries `{path: "banded", table, band, confidence, distribution, roll}`, and the Keeper's note carries the line.
- The kernel issues `table.apply.options.unstated_damage` for a stated step this turn reached whose damage the page
  leaves unstated (the roll's actor, the level, the book line), until harm on that actor lands; the loop turns it into
  a forced `apply:damage:<rule>:<actor>` candidate bound to a severity rung by the shadow's Score.
- Below the table's gate, on `unknown`, without Jev or past the budget the candidate is the Keeper's
  (`left_to_you`), never an `infer(bind)`; a stated dice never reaches the clerk (P6); a road's time never does.
- The gates are `PI_COC_BAND_MIN_CONFIDENCE`'s placeholder (0.5) until the shadow's rows say otherwise; the
  turn-3 replay's LLM step count with and without the branch is recorded under Comments.

## Comments

### 2026-09-26 — BR-06 implemented (`claude/br06-band-clerk-20260926`, `c7116d9e1`)

Contract: `docs/kernel-rpc.md` §138.10 (the amendment of §135.3 and §136.24, `table.apply.options.unstated_damage`, the
two candidates, the banded bind, the engine's roll read-back and note line). Kernel: `unstatedDamage`
(`kernel-ts/read/stated.ts`) issued by `kernel-ts/runtime/apply-operation.ts` beside `obligations`, absent when empty and
folded into `revision`. Runtime: `Unbound.band` / `BandParameter`, `CLERK_AUTHORITY` + `declared_time`, `stated_hazard`,
`TIME_CANDIDATE_KEY`, `PRECEDENCE.time`, the Score bind question and `boundAnswer` (`runtime/jev/step-policy.ts`);
`timeCandidate` / `damageCandidate` and `StateReads.bands` (`runtime/jev/candidates.ts`); `bandReads` (once per engine),
`bandRolls`, `bandedLine` (`runtime/jev/hybrid-engine.ts`); the gate defaults widened to `time` / `damage`
(`runtime/jev/band-recovery-domain.ts`, `extensions/kernel/band-recovery.ts`); `kpi.py`'s `basis` gains `clerk_bands`.

Decisions taken inside the ticket:
- The clerk's questions **are** the shadow lane's (`timeQuestion`, `damageQuestion` of §138.8): one text, so the shadow's
  rows calibrate exactly what the clerk asks. The time candidate's route is a fact about the declaration (`costs` /
  `none` / `unknown`), not now/later: a candidate not selected is the Keeper's for the run and not asked again.
- The band's gate is the table's (`PI_COC_BAND_MIN_CONFIDENCE`, placeholder 0.5), never the run's 0.6 route gate; below it
  the candidate is `keeperOwns` (the contract's one "the Keeper's" mechanism), and the time candidate ranks last so that
  hand-over never precedes the other selected clerk steps.
- Only an **unstated** dice is the clerk's: a stated dice stays P6's (the Keeper applies what it chooses with `stated`);
  `stated` beats `banded` (§138.1) and the projection issues no row for it. A hazard step is reached only by the
  Keeper's own `action.rule` roll (§136.20, ruling Q1): the clerk rolls no hazard, it lands the harm the roll stated.
- "Settled" for the projection is a hit-point delta on the roll's actor after the roll, whoever wrote it; a push replaces
  the roll it continues (the latest roll per node, as `statedCandidates` reads it).
- Time is charged once a turn: no time candidate once the turn holds a `time` receipt (`current_receipts`), a
  model-origin `time` consumes the candidate, and the road rows are never offered (a move carries its road, §138.9).
- No new `createDecisionAdapter` site: the engine's own decision port asks both binds (SL-00 inventory unchanged).

Tests (single files on the Mac): `tests/kernel/test_apply_options_unstated_damage.py` 3 / 3 (seeds 1 / 15 / 0 recorded
for the ledge's failure, pass, and failure-then-passed-push); `tests/extension/single-loop-band-clerk.test.mjs` 6 / 6;
`single-loop-binding` 9 / 9 with two band shapes and three band answers added to the structural test;
`single-loop-run-driver` 4 / 4 (the opening turn now routes the time band's fact beside the exit); `single-loop-candidates`
12, `-domain-policy` 10, `-turn-close` 6, `-turn-budget` 6, `-model-call-diet` 11, `band-shadow` 7,
`jev-band-shadow-domain` 9, `band-recovery` 8, `control-flow-inventory` 4, `test_kpi -k basis` 1: all green.

Mutations (copy-restore, one test file each): runtime 11 / 11 killed -- the run's gate in place of the table's; `jev` in
place of `banded`; a tie to the last rung; the time candidate offered after a time receipt; the damage candidate not
forced; a model-origin time not consuming; the roll not read back; the rows read per read; the fact's `selects` flipped;
the Score asked as a Choice; the road rows offered. Kernel (each rebuilt on leehow-pc, the projection pytest): 5 / 5 killed --
the "settled" filter dropped; a stated dice issuing a row too; the first roll per node instead of the latest; the row left
out of `revision`; and, after the review, an upward hit-point delta counted as harm.

Review (high, in-context), seven findings: two fixed at once -- `unstatedDamage` counted any later hit-point delta on the
actor as the harm (first aid after the roll would have dropped the row; now only a delta downward settles it, with the
pytest case `test_a_hit_point_delta_upward_settles_nothing_only_harm_does`, seed 1), and the engine test's `call_id`
assertion compared the value with itself; one needs no change (a severity ladder past ten rows would fail in packing and
go to the Keeper as `no_answer`, where the shadow says `schema_error`; the ladder has six); four recorded as decisions: a
combined move-plus-activity turn may charge the road and a band (the design accepts it: the bind sees the move under
"done this turn" and the question says unknown when nothing fits); an unavailable `rules.bands` is retried on every read
with a `read_failed` row; the projection's latest-roll-per-node reading is its own beside `statedResult`'s; a refused clerk
write no longer carries a band line (fixed in the same pass).

Replays (`experiments/single-loop-routing/run.mjs --llm replay`, live Jev, the recorded Keeper replayed; the base is a
detached worktree at `0.9.5a@fb7334fcd` with its own build):

| fixture | arm | runs | LLM steps | clerk writes | Jev calls | matches |
| --- | --- | --- | --- | --- | --- | --- |
| turn3 ("先去报馆…翻旧报道") | base | 3 | 5 / 5 / 5 | move | 19 / 10 / 9 | 11 / 11 each |
| turn3 | BR-06 | 3 | 5 / 5 / 5 | move, **time band** | 21 / 11 / 11 | 11 / 11 each |
| fight-round ("继续揍他") | base | 2 | 2 / 2 | two session steps | 9 / 4 | 6 / 6 |
| fight-round | BR-06 | 2 | 2 / 2 | two session steps | 9 / 4 | 6 / 6 |

On turn 3 the route judged the declaration `costs` (the fact question rides on the same route request), the move landed
first, and the bind named `library_research` at 0.93 (distribution: library_research 0.94, single_room_search 0.02, the
rest ≤ 0.01); the kernel rolled 133 minutes inside 60–480, and the replay matched the live Keeper's `time 40` to the
clerk's write (origin `policy`), so the Keeper's own time is the one effect the clerk took off its last batch. The LLM
step count is unchanged: that batch (two clues, a handout, the time) is still one Keeper call, and the four adjudications
are scene craft (staging Arty and Ruth, the Persuade, the reveal). A band saves a parameter, not a call, unless the turn's
only bookkeeping is its time. Calibration note for the owner: the live Keeper's 40 minutes sits one rung below the
argmax (`single_room_search`, 10–45), the case spec D4 says to revisit with the shadow's rows -- one data point, not a
trend. The fight round is untouched (a session offers no time band; its damage is the attack's, not a hazard's).

Suites on leehow-pc: `test:ext` 2895 / 2897 -- the two reds are the box's load pair (`npc-preparation-integration`,
`jev-source-domain`), each 3 / 3 on the Mac; full pytest recorded below once run.

Golden walk (base `0.9.5a@fb7334fcd` kernel + content against this branch, four starters, start and after one move, seed 5,
frozen clock): `table.apply.options` and `table.resolve.options` byte-identical 16 / 16; the eight `table.capsule` reads
differ only in `_context.source_revision` / `task_source_revision`, which fold the content directory's path (the base
kernel on the branch's content directory gives the branch's digests, and the branch kernel on the base's gives the
base's; the two directories are `diff -rq` identical).

### 2026-09-26 — BR-03, BR-04 and BR-05 integrated (`claude/integ-band-20260926`)

Merged in the order BR-04, BR-03, BR-05 (`7916105fc`, `68bc205df`, `3afa4818c`) on `0.9.5a@da64930f5`. Conflicts were
all "appended at the same place": §138.7–§138.9 now sit in order in `docs/kernel-rpc.md`, the three tickets' Comments in
ticket order here, and the SL-00 inventory carries BR-04's askBand note beside BR-05's new travel-fill row.
Integration review (high), seven findings: three fixed in `36f8af8b9` (one `clip`/`digest16` in `runtime/jev/text.ts`
for every Jev domain; the shadow's route rows read from the kernel's `ROUTE_TRAVEL_ROWS` instead of a second list; the
travel build lease's actions sized for the retry each batch may take), four recorded as decisions: the job identity
keeps Jev's confidence in the preset digest (a restart mid-turn may mint a second job; rare and cheap, the worker's
tested choice stands); a deferred weapon define waits for the band question in the foreground (about 0.3 s median,
capped by `PI_COC_BAND_JEV_TIMEOUT_MS`); `kpi.py`'s basis section does not yet count `creator_preset` or `travel-fill`
rows; neither the shadow nor the preset is driven through hybrid-v1.

Decisions the owner should see (taken inside the tickets' scope, reversible):
- BR-05 re-keyed the bundled character guidance of the-haunting and mystery-house (`graph_sha256` and `fingerprint`
  recomputed after the old fingerprint was reproduced; the text is untouched) so a changed graph does not drop it.
- BR-05 left 8 of 141 roads without minutes (answers below the 0.5 gate); the mystery-house Danvers ward is `long`
  from the Costas' rooms and `local` from the North End clinic, as Jev answered.
- BR-03: a Keeper-named `template` that names a weapons row gets no band question (the template stays evidence).
- BR-03: departures are stated in a structured `deviations` list, not in `basis` prose (spec D7's wording amended
  in §138.7).
Not run here: the turn-3 replay (`experiments/single-loop-routing`, live Jev) and a live PDF publication through the
real reader; the band-shadow report has no real rows yet (no table has been played since).

Suites on leehow-pc: `test:ext` at the pre-fix merge `3afa4818c` 2889 / 2891 (two `jev-source-domain` load reds,
5 / 5 on the Mac); at the final `2fe0a1f81` full pytest 1745 passed / 2 skipped / 2 failed (both
`tests/play/test_driver.py`, the box-only pair) and `test:ext` 2890 / 2891 — the one red is
`post-delivery-continuity`'s implicit-narrate case, whose fixed 100 ms wait between the review's `table.warn`
request and its `recorded` telemetry row expired under the 12-way load; the path is untouched by these tickets and
the file is 3 / 3 on the Mac. Merged into `0.9.5a` by fast-forward.

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

### 2026-09-26 — BR-04 implemented (`claude/br04-band-shadow-20260926`, `b21497dbf`)

Contract: `docs/kernel-rpc.md` §138.8 (§138.7 is left free for BR-03 or BR-05, whichever lands first; §-numbers are
stable ids). Code: `runtime/jev/band-shadow-domain.ts` (the two questions over the kernel's rows, pure: the time Choice
without the two road rows and with `unknown`, the damage Score over the ladder in the table's order, the state, the
argmax); `extensions/kernel/band-shadow.ts` (the glue with no Pi types: which effects are shadowed, `inside`, the row,
the gate read for the record, the defensive read of `rules.bands`); `extensions/kernel/band-recovery.ts` (`askBand`
takes the two shadow question kinds under family `band-shadow` and its own lease, so the one inventoried
`createDecisionAdapter` site stays the only one; typed by overload signatures); `extensions/kernel/index.ts`
(`shadowBands`, scheduled in `runTool`'s success path after the tool's own telemetry row, right before the result
returns; `settledBefore` taken before `applyToolSuccess` adds this call's line; `rules.bands` read once per session);
`kernel-ts/read/handlers.ts` + `kernel-ts/handlers.ts` (`rules.bands`, registered among the read handlers and in
`KNOWN_METHODS`); the fake kernel answers `rules.bands` from the shipped rules-json; `tests/play/band_shadow_report.py`
(importable, `main`, `--campaign` repeatable / `--all` / files, `--json`). The SL-00 inventory's note for `askBand`
(JSON and prose) now names the shadow's use of the same site; its key and count are unchanged.

Decisions taken inside the ticket's scope:
- **Where it fires**: in `runTool`'s success path, not in the dispatcher: a host-origin call is excluded by
  `dispatcher.hostOrigin(toolCallId)`, and the verifier lane's `setTimeout(0)` + last-resort catch pattern means no
  failure of the lane can reach the turn. A replayed call (`replayed: true`) is not asked again: it was asked when it
  first landed.
- **State**: `{declaration, settled_this_turn}` — `state.playerText` (clipped at 600 code points) and `state.landed`
  (the admission review's "already settled this turn" lines, e.g. `apply landed: clue:t1-c1`, `resolve settled
  (success)`), snapshotted before this call's own line, the last sixteen. Nothing of the measured call.
- **Unasked rows** carry only `{lane, turn, call_id, index, kind}` plus, for a deliberate skip, `ok: true, skipped`
  (`unconfigured`: no key, nothing is read either; `no_declaration`: a turn without player text, the opening, where a
  question would be noise) and, for a failure, `ok: false, reason` (`rows_unavailable`: the kernel could not list the
  rows, retried on the next effect; `lane_crashed`). Changed in review (`c1966c729`), see below.
- **Answered rows** add `index`, `gate` and, for damage, `score` to the D9 fields; `ok` means a distribution exists.
  The band is the argmax of the distribution (first row on a tie), not Jev's `choice`; an argmax on `unknown` is
  `ok: true`, `band: null`, `reason: "unknown"`. `range` and `inside` are `null` without a band. Damage `inside`
  compares dice with case and whitespace ignored (`1d6` = `1D6`, `1D6 + 1` = `1d6+1`).
- **The damage Score has no exit**: the harm happened (the Keeper wrote it); only its severity is asked. A ladder over
  ten rungs cannot be a Score and is recorded `schema_error` without a request.
- **The road rows** (`local_travel`, `long_travel`) are left out by a closed constant in the domain,
  `ROUTE_TIME_BANDS` (handles of the registry's own table, per §138.2's "the host's per-turn question omits them"),
  not a vocabulary. If BR-05 gives the registry a marker for route rows, the constant should read it.
- **`rules.bands`** answers only the two fields the kernel rolls from (`time.band`, `damage.band`); any other field is
  `invalid_params` with `details.options`. No campaign, no lock, no write.
- **Keyless tables** write one `skipped: "unconfigured"` row per own-number effect with `ok: true` (the admission lane's
  skip convention), so `kpi.py`'s lanes section does not show `band-shadow` failing on every Keeper time write.

Tests (single files, on the Mac, on the tree of `b21497dbf`, kernel rebuilt with `npm run build:runtime`;
`npm run check:kernel` clean):
- New: `tests/extension/band-shadow.test.mjs` 7/7 (six over the fake kernel with a controlled typed endpoint, one over
  the real emitted kernel); `tests/extension/jev-band-shadow-domain.test.mjs` 9/9; `tests/kernel/test_rules_bands.py`
  6 passed; `tests/play/test_band_shadow_report.py` 5 passed.
- Neighbours: `band-recovery` 8/8, `jev-band-recovery-domain` 5/5, `band-operations` 2/2, `stated-operations` 2/2,
  `control-flow-inventory` 4/4, `system-language` 5/5, `ts-kernel-foundation` 11/11 (lists `rules.bands` among the
  current-only methods), `dead-proposal-retires` 5/5, `gates` 9/9, `admission` 15/15, `turn` 32/32, `real-kernel` 5/5,
  `world-state-seams` 3/3, `canonical-operation-dispatcher` 12/12; pytest `test_band_operations.py` 12 passed,
  `test_kpi.py` 47 passed 1 skipped, `test_system_language.py` 5 passed. The full `test:ext` and
  `pytest tests/kernel tests/play` were not run here (the integrator's, on leehow-pc).

The turn is untouched, shown two ways. Over the fake kernel, its request log: the shadow sends only `rules.bands` (a read,
once per field per session) and the writes are exactly the Keeper's, as sent. Over the real kernel — the harness's
`realKernel` mode runs the real extension on the emitted kernel, so this could be driven after all — the same Keeper
turn (`apply time {minutes: 25}` then `narrate`) with the shadow asking and with no key produces the same
`turns/0001.json` once the wall-clock stamps (`at`, `opened_at`, `closed_at`) and the `commit` are removed, and the time
receipt stays `basis: "keeper"`. It is not a byte comparison against the parent commit: a turn record carries
timestamps and a commit hash, so two runs are never byte-identical; the normalized comparison is the claim.

Mutation record (each applied to the named file, the listed test files run, the file restored by copy; the two kernel
mutations rebuilt before and after):

| mutation | caught by |
| --- | --- |
| the row recording removed (`record(shadowRow(…))` dropped); re-run on `c1966c729` | `band-shadow.test.mjs`: 5 of 7 (every case that waits for an asked row) |
| the Keeper's `why` leaked into the question's state (appended to `settled`) | `band-shadow.test.mjs`: the time case and the damage case (exact state, the sentinel `why`) |
| the shadow firing for every `time`/`damage` effect, `stated` and `band` included (selected by kind only) | `band-shadow.test.mjs` "no row for a stated or a banded effect"; the domain test's own-numbers case |
| the stated/band guard alone removed | **survives, equivalent**: a `stated` or `band` effect carries no own number, and one beside `minutes`/`dice` is refused by the kernel (`stated_conflict`, `band_conflict`) before the success path; the guard is defence in depth |
| the shadow awaited inline before the tool result returns | `band-shadow.test.mjs` "the turn never waits for the answer" (the row exists when the turn returns) |
| the host-origin exclusion removed | the domain test's own-numbers case (a clerk write is not driven end to end; see below) |
| the rows re-read for every effect | `band-shadow.test.mjs` time and damage cases (`rules.bands` read once) |
| the two road rows offered | the domain time-question case; `band-shadow.test.mjs` time case and real-kernel case |
| `inside` excluding the row's max | the domain `inside` case |
| `settled` taken after this call's own line | `band-shadow.test.mjs` time and damage cases |
| the Score's levels read in reverse | the domain damage case; `band-shadow.test.mjs` damage case |
| the band taken from `choice`, not the argmax | the domain argmax case |
| `rules.bands` accepting every registry field | `test_rules_bands.py` refusal cases (3) |
| `rules.bands` dropping `default` | `test_rules_bands.py` time-rows case |
| report: hit rate over answered instead of banded | `test_band_shadow_report.py` (4 of 5) |
| report: gate rate counting `unknown`-exit answers | `test_band_shadow_report.py` (4 of 5) |
| report: Jev seconds counting a zero-call row | `test_band_shadow_report.py` (2 of 5) |
| (`c1966c729`) a skip written as a failure (`ok: false, reason`) | the domain row case; `band-shadow.test.mjs` the no-key case and the real-kernel case |
| (`c1966c729`) report: `unasked` reading only `reason` | `test_band_shadow_report.py` (2 of 5) |

Not covered here:
- A clerk (host-origin) `time`/`damage` write is excluded at the pure seam (`shadowTargets` given an origin) and not
  driven through hybrid-v1: no clerk candidate writes either kind until BR-06.
- Live Jev was never called: whether "single room search: 10 to 45 minutes" as a criterion carries enough for the
  model (the skill's structured `what`/`examples` criteria are the alternative) is for the first real rows to show.
- A lane still in flight when the session ends is cut by the table's lane signal and may leave no row.
- **The report over real tables**: the script is ready for the integrator
  (`uv run --frozen python tests/play/band_shadow_report.py --all --workspace <path to .coc> [--json]`, or
  `--campaign <id>` repeated); its output over the next real tables is BR-06's evidence and belongs under this ticket.

### 2026-09-26 — BR-04 review fix (`c1966c729`)

- **Skipped is not failed.** `unconfigured` and `no_declaration` now write `{ok: true, skipped: <reason>}` with no
  `reason` key (`skippedRow` in `extensions/kernel/band-shadow.ts`, the admission lane's convention in
  `extensions/kernel/index.ts`); `rows_unavailable` and `lane_crashed` stay `ok: false` with `reason`. The report's
  `unasked` counts `skipped` or `reason`; §138.8's row paragraph, its reader line and the report's docstring say so.
  Tests on the fix: `band-shadow.test.mjs` 7/7, `jev-band-shadow-domain.test.mjs` 9/9, `band-recovery.test.mjs` 8/8,
  `test_band_shadow_report.py` 5 passed (its fixture now carries two skips and one `rows_unavailable`),
  `test_rules_bands.py` 6 passed, `test_kpi.py` 47 passed 1 skipped. Mutations re-run on this commit: the row
  recording removed (caught, 5 of 7 as before), a skip written as a failure (caught), the report reading only
  `reason` (caught); table above.
- **A Score's `probabilities` are keyed by level index** (`"0"` … `"n-1"`, lowest level first), on the wire and in
  `DecisionAnswer`: verified in `runtime/jev/contracts.ts` `bindDecisionAnswers` (the score branch builds
  `keys = question.criteria.map((_, index) => String(index))` and rejects an answer whose `legend`/`probabilities` keys
  differ — `invalid_answer`), in `runtime/jev/decision-adapter.ts` `answerSchemaDiagnostics` (the same index keys as
  the expected set) and `runtime/jev/question-packing.ts` `responseUpperBound`; the skill's `reference/primitives.md`
  says the same ("`probabilities` keyed "0","1",…"). So `readAnswer`'s `answer.probabilities[String(index)]` is right
  and unchanged.
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
