Status: ready-for-human (fixed 2026-09-25, branch claude/sl65-20260925)
Stage: SL-67 (P2, admission / entities; follows SL-62 and SL-64)
Spec: docs/kernel-rpc.md §11.5.6 (SL-62), §11.5.7 (SL-64), §87 (table persons)

# SL-67 — A shortened name of a person the campaign already holds resolves to them, wherever the party is

## Evidence (ticket 29 batch-10 entry: t14)
- Three shortened names (拉斯 / 内特 / 史蒂夫, the surnames dropped) of three persons the campaign had established at t1 (拉斯·威廉姆斯 / 内特·帕特森 / 史蒂夫·布朗, `from_passage`) were refused `unknown_entity` instead of resolving. SL-62's candidates are the scene's present people; these three were established but not present in the scene the party had moved to, so no candidate row was asked.

## Ruling (owner, 2026-09-25)
SL-62's candidate rows include every person the campaign holds (the module's people of the scene, the present, and the campaign's established table persons and `from_passage` persons), asked with the same per-row Jev question; presence decides what the check can target, not whether the name resolves.

## Scope
1. Contract: §11.5.6 addendum (the candidate set).
2. Host (`extensions/kernel/index.ts` / `runtime/jev/person-resolution-domain.ts`): candidates from the campaign's roster as well as the scene; the receipt's `resolved_from` unchanged.
3. Tests, mutation-killable: a shortened name of an established person resolves when the party is elsewhere; an unknown name still refuses; the b10 t14 replay lands the batch.

## Comments

### 2026-09-25 (worker, branch `claude/sl65-20260925`)

**Where the gap was.** `scenePersonCandidates` (`extensions/kernel/index.ts`) only ever read `table.look
{focus:"scene"}`'s `present` reduction. §87.4/`ModuleGraph.tableNames` already holds every established
table/`from_passage` person, and `candidates()`'s default (`{roster:true}`) already surfaces them in a plain
`unknown_entity` refusal's `details.candidates` for a name close enough to rank — but SL-62's own host-side fan-out
never consulted either the roster or that refusal's own candidate list, so a person established elsewhere had no
candidate row to ask about once the party moved on.

**Fix.** `ModuleGraph.establishedPeople()` (`kernel-ts/read/module-graph.ts`) describes every person in
`tableNames`, unconditioned by scene or presence. `sceneView()`
(`kernel-ts/read/handlers.ts`) adds it as `roster` beside `where`/`present` on `table.look {focus:"scene"}`.
`scenePersonCandidates` now merges `present` and `roster`, deduplicated by handle, still capped at
`PERSON_RESOLUTION_MAX_CANDIDATES` (12) and asked with the exact same per-row Jev question as before — presence
decides what the check can target (`present`), not whether the name resolves (`roster` fills the rest). Full text:
docs/kernel-rpc.md §11.5.7 (the SL-67 text sits under that heading, amending §11.5.6; following this doc's own convention of amending a
numbered `11.5.x` section with the next one rather than nesting an "addendum" inside it).

**Tests, mutation-killed.** `tests/extension/name-resolution.test.mjs` (host + fake kernel + stubbed Jev, new
`FAKE_KERNEL_ROSTER` env on the fixture, `tests/extension/fixtures/fake-kernel.mjs`): a shortened name of a person
established elsewhere (present: `[]`, roster: the one established person) resolves; an unrelated name still refuses
even with a roster to ask; a person in both `present` and `roster` is one candidate row, not two. Kernel-level:
`tests/extension/a-person-this-table-has.test.mjs` (real kernel, not the fake one): `table.look {focus:"scene"}`
carries `roster` and it lists a person `apply npc` just established, independent of presence. Two mutations applied
by copy-revert (never `git checkout --`), rebuilt on leehow-pc, both killed, then restored byte-identical (`diff`
confirmed): (1) hardcoding `roster: []` in `sceneView` — killed the kernel-level test; (2) turning the host's
roster-merge loop into a no-op — killed both new `name-resolution.test.mjs` roster cases.

**Fallout fixed.** `tests/kernel/test_capsule.py::test_look_focus_variants` asserted the exact key set of
`table.look`'s scene focus (`{"where", "present"}`); updated to `{"where", "present", "roster"}` with
`roster == []` on that fixture (nobody established there). This was the only baseline break from adding the field;
`py` suite is 1730 passed / 2 skipped after the fix.

**Live-Jev check (the b10 t14 replay).** A full literal replay of turn 14's recorded session was not run (that
needs the actual driver/session infrastructure, out of scope for a single ticket's own verification and adjacent to
the ban on fake-KP shortcuts). Instead, the exact three shortened names from t14's evidence were asked, as candidate
rows, against the **real** `person-name-resolution` typed endpoint (live Jev, `EXT_JEV_APIKEY` read only via the
vault helper the marker names, never printed or committed) with the same three established persons as candidates —
this exercises the identical code path (`resolvePersonName`/`personResolutionBatch`) `resolveScenePerson` calls,
just invoked directly rather than through a live table. Run three times for stability:

- `内特` → resolved to `内特·帕特森` every time (confidence 0.86/0.86/0.89).
- `史蒂夫` → resolved to `史蒂夫·布朗` every time (confidence 0.81/0.85/0.83).
- `拉斯` → `unresolved (no_row_cleared)` every time, **not** `no_candidates`: the candidate row for `拉斯·威廉姆斯` was
  asked about (this ticket's fix is doing its job), but live Jev consistently judged the two-character fragment
  `拉斯` too ambiguous to clear on its own (a transliteration fragment shared by many Western names, unlike `内特`/
  `史蒂夫`) under the existing conservative row criteria. This is a model-judgment outcome the ticket's ruling
  explicitly leaves alone ("presence decides what the check can target, not whether the name resolves" — i.e. this
  ticket's job is making the row available, not making Jev clear it), and it matches SL-62's own established
  behavior that a name clearing no row still refuses `unknown_entity`. **Reported honestly rather than overclaimed:
  a literal replay of t14's exact three-name batch would land 2 of 3, not the whole batch**, under the live model as
  it judges today; the fix under test here (candidate availability) is proven working for all three names alike.

**Suites (leehow-pc).**
- `on leehow-pc @ 4ec88b7269ddb6fd8442afc2d8d0820241cbe629`: `ext` — 3169 pass, 0 fail (`wall=177s`).
- `on leehow-pc @ 4ec88b7269ddb6fd8442afc2d8d0820241cbe629`: `py` — 1730 passed, 2 skipped (after the
  `test_look_focus_variants` fix above).
- `on leehow-pc @ 4ec88b7269ddb6fd8442afc2d8d0820241cbe629`: `loop` — 196/196 clean on the clean re-run (one
  unrelated pre-existing flake on the first run, `single-loop-turn-budget.test.mjs`, nothing this ticket touches).
