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

Status: ready-for-human (implemented 2026-09-26 on `claude/br04-band-shadow-20260926` at `b21497dbf`, review fix `c1966c729`; awaiting review and merge, see Comments)
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
