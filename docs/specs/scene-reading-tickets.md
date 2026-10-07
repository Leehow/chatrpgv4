# Reading by the book's sections — tickets

Spec: `docs/specs/scene-reading.md`. Contract: §189. Implementation waits for the owner's word; branch names below are
proposals.

Every ticket: contract first (a shape that does not fit is reported back, not improvised); system language English; no
semantic lists, heading tables or regex classification (whether a heading is a place is the Jev family of §190.1); single
test files locally, full suites only on the LAN box and only by the lead; every product change has a test that a mutation
of the change makes fail; tests travel the real entry (`module.read.ahead`, `module.read.claim`, `module.read.finish`, the
reader context hook, `table.capsule`).

## SR-01 Section units from the book's structure (§189.1)

Status: needs-triage

- `kernel-ts/modules/background-source.ts`: a `sectionSourceUnits(outline, pageCount, maxPages)` beside the two existing
  generators; flattened bookmarks (all levels) → ranges, merge short neighbours, split long ones at `maxPages`.
- `kernel-ts/modules/reading.ts` `streamedUnits`, the unit validator (`request` accepts only generated units), `JOB_MARKERS`/
  `STREAMED_MARKERS`, the material and `scene_index` rows; `need-reads.ts` unit lookups; `kernel-ts/check.ts` and
  `kernel-ts/modules/visual.ts` unit checks keep working for the new ranges.
- `content/rulesets/coc7/host-budgets.json` `reading.unit` (`two_page` shipped) and `reading.section_unit_max_pages` (6).
- Tests: Blood Road's 21 bookmarks give the expected ranges; merge and split bounds; `two_page` keeps today's units;
  mutation: drop the split → the long-section test fails.

## SR-02 A place section is read as its scene (§189.2)

Status: needs-triage

- The unit carries `focus` = the place scene §190.1 minted for its heading; `unitQuestion` gains the playbook ask for a
  place unit; `content/setup/visual-reader/detail.md` gets the playbook field list (words that name the fields §187.1's
  consumers read, not a new artifact); `review.md`'s coverage unit asks "can this scene be run" over the same list.
- Completion writes the scene's material row (the scene becomes `ready`) and its `scene_index` row with `scene:<id>`.
- Tests: a place unit's finish makes the scene `material: ready` and writes the row; a non-place unit is unchanged; the
  reviewer brief of a place unit contains the playbook list; mutation: skip the material row → the ready test fails.

## SR-03 A scene read has pages (§189.3)

Status: needs-triage

- `kernel-ts/modules/reading.ts` `request`/`claim`: a `detail` read focused on a scene with a section unit or `scene_index`
  row gets those pages as `pages`; `packet-scope.ts` then scopes its packet; `runtime/jev/source-reader-driver.ts` starts
  its locate from them.
- Tests: an adjacent scene read's packet holds only the scene's pages' nodes and neighbours; with no row it is unchanged.

## SR-04 Play-order read-ahead (§189.4)

Status: needs-triage

- `queueAheadReading`: inside the window, the current scene's section, then reachable places' sections in book order,
  then the rest. Tests on a fixture with three place sections and a non-place section.

## SR-05 Telemetry and the switch (§189.5)

Status: needs-triage

- Each reading row names `unit_kind: two_page | section | scene | index` and, for a place unit, the scene; `job_accounting`
  likewise. The SR-06 measurement script reads only these rows and the work directories.

## SR-06 Pre-registered comparison (lead)

Status: ready-for-human (after SR-01..05)

- As the spec's "Success" section states; results under the spec's Comments, pass or fail, before the default changes.
