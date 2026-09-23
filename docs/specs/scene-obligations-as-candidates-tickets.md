# Scene obligations as candidates — tickets

Spec: [scene-obligations-as-candidates.md](scene-obligations-as-candidates.md) (`Status: ready-for-human`).
Parent plan: [pi-native-single-loop.md](pi-native-single-loop.md) and its tickets under `pi-native-single-loop-tickets/`.

State: **scheduled under the single-loop plan's SL-02 stage (owner, 2026-09-23; rulings Q1–Q7 recorded in the spec).** SO-01, SO-02 and SO-03 are `ready-for-agent` in that order of dependency and may run while SL-01 is still open (they do not touch the loop); SO-04 waits for SL-02's driver and is part of SL-02's acceptance; SO-05 is the remaining data rows.

Common constraints for every ticket (from `Agents.md`): contract first (`docs/kernel-rpc.md`, a new section at the next free number, amending the sections the spec names); `kernel-ts/` is the only kernel; system language English, no CJK in code; no hard-coded semantic lists; build before pytest, one pytest at a time, on the ticket's own worktree; stage only the ticket's paths; no packaging unless the ticket says so; never modify playtest evidence or the original replay fixture.

## Dependency graph

```
SO-01 data schema + validator + morgue pair ─┬─ SO-02 kernel issuance + settlement ─┬─ SO-04 loop consumption (inside SL-02) ── SO-05 remaining rows
                                             └─ SO-03 reader extraction + validator   │
                                                             SL-02 driver in place ────┘
```

SO-02 and SO-03 can run in parallel after SO-01. SO-04 needs SO-02 and the single-loop plan's SL-02 accepted (including SL-02's §32 admission research result).

---

## SO-01 — The obligation shape, its validator, and the haunting's morgue pair

Status: ready-for-agent
Depends on: nothing open (rulings Q2, Q3, Q7 recorded in the spec).

**What.** Write the contract section for the `requirement` node's `properties.obligation` (spec D3), the settlement flag convention (D4), and the Mod `checks[]` extensions (`selection: approach`, `values[].minimum`, `trigger` validated as a closed enum). Include the optional `reaction: "preordained"` key (spec D3, ruling Q2). Implement one validator function (spec D7's refusal list) shared by starter registration and the Mod manifest check (`kernel-ts/read/mods.ts`, the `checks` loop). Author the haunting's first-cut obligations in `content/starters/the-haunting/module-graph.json` as `requirement` nodes with `has-requirement` claims, citing the pages actually checked.

**Authoring scope** (ruling Q7: the morgue pair only; the other rows are SO-05):
- morgue: clippings access (`attempt`, meet Arty with `reaction: "preordained"`, check approach ×4 regular) and the archivist (`after`, meet Ruth).

**Migration in the same change:** move `persuade-arty.roll_gate` into the morgue requirement and delete it; replace the morgue's `requires_completed_route_ids` and `npc_presence_requirements` by the requirements' `guards`/`after`; remove `befriend-ruth.roll_gate` (ruling Q3). `clue-police-raid-chapel`'s `Law` gate stays until SO-05 authors the police row. `mystery-house` is not touched.

**Acceptance.**
- Validator tests through the real entries (starter registration, Mod manifest check), each refusal case in spec D7 present and each shown to fail when its rule is removed; the minimal valid node and a `difficulty_unstated` node accepted.
- `natural-npc` still loads at its current version and digest.
- The haunting registers; `tests/kernel/test_starters.py` digest/manifest checks updated only for the haunting; `mystery-house`, `voice-bench` and `the-haunting-rulebook` unchanged byte for byte.
- No kernel read changes in this ticket: every capsule and options golden for every starter is unchanged (the nodes are data nobody reads yet). That is the check that SO-02 is where behaviour moves.

---

## SO-02 — Kernel issuance and settlement

Status: ready-for-human (implemented 2026-09-23 on `claude/so02-kernel-obligations-20260923`; awaiting review and merge, see Comments)
Depends on: SO-01 merged.

**What.** `sceneObligations(graph, world, scene)` beside `whereSection` in `kernel-ts/read/` (spec D5): state (`open`/`blocked`/`settled`/`waived`), next step, guards, Keeper-only book lines, source. Seats: `table.apply.options.obligations` (complete, same `revision`/`world_revision`), `guarded_by` on guarded effect candidates, capsule `obligations[kind: "scene"]` within the existing 1 KB budget, the obligation's name appended to a guarded clue's gate in `clueGate`. `resolve` accepts `action.obligation` and settles through the ordinary check (spec D4): validation of openness, scene, step, approach, difficulty, presence; the flag in the same transaction; `obligation: {handle, settled, book?}` on the receipt/result; no consequence applied. A result that crosses an open guard carries `obligation_open` and the capsule's clerk list shows it as one line (ruling Q5); the kernel never refuses. Costs are never applied by the kernel on an obligation's behalf (ruling Q4). An obligation with `reaction: "preordained"` marks the Mod contact check for that pair as not clerk-settleable in the issued row (ruling Q2). The Mod-recipe identity rule (spec D9): an obligation check with the same recipe as an active Mod check for the same pair is served by the Mod's frozen result. Offer ledger: `obligation:<handle>`, taken when the flag is set. Tool description for `resolve` gains the optional field; the base Keeper prompt gains the one sentence in spec D6 (English).

**Acceptance** (spec Testing Decisions, kernel and control rows):
- The morgue sequence on a fresh haunting campaign (open → meet → check; forced pass sets the flag and opens the archivist and the clippings; forced fail leaves it open with the book line; a same-skill `resolve` without `action.obligation` settles nothing; `apply flag` waives and reopens with receipts; a guarded `apply clue` succeeds and reports `obligation_open`).
- Capsule rows and options rows agree for the same state.
- `mystery-house`, `voice-bench` and the committed `the-haunting-rulebook`: capsule, `table.apply.options` and `table.resolve.options` byte-identical to goldens recorded on the parent commit.
- The haunting's start-scene capsule unchanged; existing capsule-budget and Director tests move only for scenes that carry obligations.
- `npm run test:ext` and `uv run --frozen python -m pytest tests/kernel tests/play` green against the rebuilt emitted kernel; the §31 world-state seam test still passes (no new world key).

---

## SO-03 — Reader extraction and review

Status: ready-for-human (implemented 2026-09-23 on `claude/so03-reader-obligations-20260923`; awaiting review and merge, see Comments)
Depends on: SO-01 merged.

**What.** One paragraph in `content/setup/visual-reader.md` (spec D7): when the page states that a place demands a meeting or a check before the investigators get something there, write a `requirement` node in the D3 shape with a `has-requirement` claim from the scene and a `calls-for-check` claim to the rule node holding the book's wording; list every obligation field in `critical`; record `difficulty_unstated` / `approaches_unstated` instead of filling a value. The draft checker in `kernel-ts/modules/visual.ts` runs the SO-01 validator; numeric fields keep entering `required_review` through `numericPaths`. The review prompt names obligation fields as mechanical statements to check against the page image. No parsing of rule prose, no count gate, no automatic backfill.

**Acceptance.**
- Checker tests: a draft with an obligation missing `source_refs`, citing an unviewed page, with a prose skill string, or with a person not seated in the scene is refused with the path; a draft with a valid obligation whose fields are not all in `critical` gets them required for review; a draft with no obligations passes unchanged.
- A detail read on a scratch copy of a book that states a gate (the owner chooses the book and pages; no committed source text) produces a reviewed `requirement` node; the evidence stays in the scratch workspace. The committed twin is not rebuilt.
- The reader prompt change is English and carries no language- or book-specific wording.

---

## SO-04 — Loop consumption (inside SL-02)

Status: ready-for-agent once SL-02's policy migration is on the branch
Depends on: SO-02 merged; SL-02's RunPolicy and candidate builder in place (the §32 admission research result may still be open; then the obligation `resolve` goes through admission like any policy-origin operation until the measurement says otherwise).

**What.** In the product RunPolicy's candidate builder (spec D6): an open obligation's `meet` step becomes the stated person candidate (replacing, not duplicating, the roster candidate), its `check` step an `obligation_check` candidate with the closed approach binder (one approach → bound; several → `decide(bind)`; below the gates → `infer(bind)`); `guarded_by` candidates withheld; `blocked` obligations issue nothing; precedence `person → mod_check → obligation_check → core-check → clue/handout → move`; the operation carries `basis: obligation <handle>` for admission; "clerk did" lines name the obligation step, receipt and page; clerk-origin refusals drop the candidate for the run and stay off the Keeper's refusal budget. Labels carry the demand and what it guards, never the page, kernel tags or `authority` strings.

**Acceptance.**
- Policy tests with stub ports: an open gate yields the stated meeting then the obligation check; a guarded reveal is withheld until the flag is set and returns after; `blocked` issues nothing; one approach binds directly, several go to `decide(bind)`, low confidence goes to `infer(bind)`; the Mod-served recipe issues no second candidate; a `reaction: "preordained"` pair issues no Mod contact-check candidate for the clerk; hazard checks (`on_enter` data) never become candidates (ruling Q1); a clerk refusal does not change the Keeper's refusal counters.
- The turn-3 replay on the new fixture variant (derived from `experiments/single-loop-routing/fixtures/turn3` with only the module slice re-registered from the SO-01 starter; the original fixture untouched; kernel seeded, seed recorded), outcomes as pre-registered in the spec: the meeting and the gatekeeper's check selected `now` in 3/3; on a passing roll ≤ 3 LLM steps (target 2), down from 5; on a failing roll, reported as the Keeper improvising past an open obligation; 8/8 live actions by kind, family, skill and target. Every route distribution retained.
- The report separates what was verified (the replay's traces) from what was assumed, and names the live-table gate as still owed.

**Not in this ticket:** the live table at the SL-02/SL-05 gates (real Keeper, the main session as the one player, one sentence a turn). It is the acceptance of the whole change and is not delegable.

---

## SO-05 — The remaining haunting rows

Status: needs-triage
Depends on: SO-04's replay meeting the Q6 line.

**What.** Author the rows deferred by ruling Q7, each cited to the page checked: higher courts / police raid-file access (approach ×5, Credit Rating with its stated minimum; replaces `clue-police-raid-chapel`'s narrower `Law` gate, one owner); the neighbourhood's Dooley (meet, then `selection: maximum` over APP and Credit Rating, regular; served by `natural-npc`'s frozen result under spec D9); the basement stairs (`attempt` guarding the move to `basement-rites`, `selection: maximum` over DEX and Climb, difficulty as the page states or `difficulty_unstated`); the Hall of Records' Law route settling `records-serious-crime-destination-known`, only if the page states a difficulty. No hazards (ruling Q1), no costs (ruling Q4).

**Acceptance.** SO-01's validator cases and goldens; the police and neighbourhood scenes' capsule and options rows; every other starter byte-identical; `test:ext` and pytest green.

## Comments

### 2026-09-23 — SO-02 implemented (kernel issuance and settlement)

Branch `claude/so02-kernel-obligations-20260923`, built on SO-01's `64f486601`. Contract §134.9–§134.15 written first
(`2e7a44004`), then the kernel (`457433a0c`, `e86219534`), the tool field and the prompt sentence (`d7708a79c`), the
tests (`5f28ac325`). `8a9340d0e` (test-only repair of the three `test_mods.py` failures, from 0.9.5a) is cherry-picked.

- Where it lives: `sceneObligations`, `openGuards`, `clueGuards`, `capsuleRow` in `kernel-ts/read/obligations.ts`;
  the options seat in `kernel-ts/runtime/apply-operation.ts`; the capsule rows in `kernel-ts/read/assemble.ts`; the
  gate string in `clueGate` (`kernel-ts/read/director.ts`); the `resolve` binding in `kernel-ts/resolve/obligation.ts`
  wired from `kernel-ts/resolve/index.ts`; crossing on `apply` in `kernel-ts/apply/index.ts`; the offer ledger in
  `offerLedger` (`kernel-ts/write/text.ts`, fed the closing world from `kernel-ts/write/index.ts`).
- Decisions the spec left open, recorded in §134: a meeting is met when the person sits in the scene and
  `world.person_labels` holds them (what `apply person` writes; the loop prototype's "introduced"); an obligation made only
  of meetings (the archivist) reads `settled` once they are met, with no flag written (nothing can claim it); a push or
  Luck spend continues the claim of the check receipt it continues; `guarded_by` and the gate string hold for `open` and
  `blocked` alike; `page` is the 1-based PDF page. The capsule's "clerk did" line for a crossing is SO-04's (the kernel
  carries `obligation_open` on the receipt and the result).
- Verified: the morgue sequence (`tests/kernel/test_scene_obligations.py`, 11 cases, seeded); the Mod-recipe identity and
  preordained reaction over a derived content root (`tests/extension/scene-obligations.test.mjs`, 4 cases); 16 mutations
  of the settlement, guards, state, claim, push, waiver, crossing, meeting, ledger, capsule, refusal and Mod identity, each
  killed. `mystery-house`, `voice-bench` and `the-haunting-rulebook`: capsule, `table.apply.options` and
  `table.resolve.options`, walked scene by scene, byte-identical to goldens recorded on `64f486601` (same content path);
  the haunting differs only at the morgue. `npm run test:ext` 2606/2606; pytest `tests/kernel tests/play` 1622 passed,
  1 skipped, 3 failed (the three `test_mods.py` cases, pre-existing), and after the cherry-pick `test_mods.py` 42/42.
- Not verified: any live table (the SL-02/SL-05 gate) and the loop's consumption (SO-04).

### 2026-09-23 — SO-03 implemented (reader extraction and review)

Branch `claude/so03-reader-obligations-20260923`, built on `cafd5fbaa` (0.9.5a + SO-01 + SO-02). Contract §134.16
written first (`c12cb908d`), then the reader paragraph, the review paragraph, the draft check and the reviewer units
(`a7f770e14`), then the tests (`52acf0aa6`).

- Where it lives: `checkDraft` in `kernel-ts/modules/visual.ts` (the source law `obligationSourceLaw` before the
  generic `references`, then `checkObligations` running `obligationRefusals` over the known graph overlaid by the
  draft); the ruleset names on `ModuleContract.rules`, loaded by `loadModuleContract` through `RuleTables`;
  `obligationReviewPaths` in `kernel-ts/modules/obligation-review.ts`, called by the draft check and by `reviewUnits`
  (`extensions/module/reader-review.ts`); the Read-phase and Verify-phase paragraphs in `content/setup/visual-reader.md`.
- Decisions the spec left open, recorded in §134.16: the unviewed-page law has its own rule
  (`obligation_unviewed_page`) and runs where the generic law runs (publication; the reader's `submit_reading` enforces it
  through `required_view_pages`); a `check_unknown_skill` refusal carries `details.ruleset` so a reader of a book in another
  language can name the ruleset's skill without a hand-written mapping; every obligation field enters `required_review`
  whether or not `critical` lists it, and the reviewer units assign the same pointers from the same function.
- Verified: `tests/extension/obligation-reader.test.mjs` (10 cases, through `checkDraft` with the loaded contract and
  through `checkSourceDraft`); 9 mutations (each refusal rule, the validator call, the review paths in the kernel and in
  `reviewUnits`, the ruleset details), each killed. A draft without an obligation returns the parent's bytes (golden
  recorded on `cafd5fbaa`, `tests/extension/fixtures/obligation-reader-parent.json`). One real detail read (the product's
  `ReadingService`, grok-build/grok-4.7-build-fast low, reader + checker + independent reviewers + publication) on a scratch
  copy of the Keeper Rulebook with focus "The Boston Globe newspaper morgue" published a reviewed
  `requirement-get-past-arty-wilmot` (pages 448–449; Charm/Intimidate/Persuade/Fast Talk, `approach`, regular,
  `reaction: preordained`, `has-requirement` from the Globe scene, `calls-for-check` to the rule node). The first review
  round contradicted the obligation's `push` line against page 449 (a pointer the reader had not listed in `critical`);
  the repair round published. Evidence stays in the scratch workspace, not the repository. `npm run test:ext` 2636/2636
  (parent 2626/2626); pytest `tests/kernel tests/play` 1625 passed, 1 skipped.
- Not verified: an owner-chosen book and pages (the haunting's own pages were used); the Keeper or clerk consuming a
  PDF-published obligation at a table (SO-04 and the live gate); the reader's guards chose the Globe-to-morgue exit rather
  than the clippings clues the starter guards, which is the reader's reading of the page, not checked against the starter.
