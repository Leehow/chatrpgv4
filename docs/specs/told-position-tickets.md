# The table stands where the story is — tickets

Spec: `docs/specs/told-position.md`. Contract: §190. Implementation waits for the owner's word.

Same rules as every ticket: contract first; English system language; no prose patterns, place-name lists or regex
classification (every semantic judgement is a Jev question over host-enumerated candidates); single files locally, full
suites on the box by the lead; a mutation-killed test per product change; tests through the real entry (the host tool
path with a fake Jev adapter, `table.owe`, `table.capsule`, `table.apply.options`).

## TP-01 The window's places exist before they are read (§190.1)

Status: needs-triage

- `runtime/jev/` new family `window-places` (one Noul per flattened bookmark entry in the window; state: heading, page,
  first lines of the page's native text; bar `window_places.place_min` in `host-budgets.json`).
- `extensions/module/reading-service.ts`: run it at table open and on a `read_window` change (once per window per campaign);
  mint each cleared entry with the existing `publishReferencePlace` path; telemetry row per entry.
- Tests: a window of five headings, three cleared, mints three identity scenes that are referenced move candidates; a
  second open does not re-ask; Jev unavailable mints nothing and does not block the table.

## TP-02 The ledger follows the told position (§190.2)

Status: needs-triage

- `runtime/jev/told-position.ts` (questions, candidates, bars `told_position.{moved_min, place_min, sentence_min, mode}`;
  `mode` ships `shadow`), the host hook after each delivery in `extensions/kernel/index.ts` beside `afterDeliveryFirstSight`,
  never blocking the next turn (§158.4's watch is reused: the next run's first read watches it).
- Kernel `table.owe {campaign, turn, effect: {kind: "move", to}, quote, source: "told-position"}` writing through
  `kernel-ts/owed/` (anchor, resolve, record, warnings, supersede); `ts-kernel-foundation` method list.
- Tests: a delivery that tells arrival at a window place with no move receipt owes the move and the next run's clerk lands
  it first; a delivery whose move landed owes nothing; a refused-then-narrated move (TP-03's record) is owed; `shadow`
  writes the row only; mutation: drop the "no move landed" guard → the landed-move test fails.

## TP-03 One retry for a transient provider failure; the cause is recorded (§190.3)

Status: needs-triage

- `extensions/kernel/admission.ts` `reviewAdmission`: the lane result's provider status (from `runLane`'s failure detail)
  decides transient; one retry after `admission.transient_retry_ms` inside the deadline; the admission row gains `detail`.
- `refused_moves` on the turn record for a refused batch that carried a move.
- Tests: a 503 then a verdict admits; a 401 refuses at once; a timeout is not retried; the row carries the detail.

## TP-04 Owner switch (lead)

Status: ready-for-human (after TP-01..03)

- Read the `told-position` shadow rows of one real table; the owner decides `on`.

## TP-05 Pre-registered acceptance (lead)

Status: ready-for-human

- As the spec's "Success" section states, with the RD-08 transcript labelled first as the control.
