# Reading serves the table — tickets

Spec: `docs/specs/reading-delivery.md`. Contract: §187. Integration branch: `claude/reading-delivery-20261006` (base `0.9.7a`@`9431c8d48` + `claude/reading-cost-20261006`).

Every ticket: contract first (already written; a shape that does not fit is reported back, not improvised); system
language English; no semantic lists, name tables or regex classification (a place-name judgement is Jev's or the
Keeper's, never a list); single test files locally, full suites only on the LAN box and only by the lead; every product
change has a test that a mutation of the change makes fail; tests travel the real entry (`table.apply` through the host
tool path, `module.read.claim` / `module.read.finish`, the reader context hook through a real `pi` child or its hook
harness, the capsule through `table.capsule`), never hand-built normalized dictionaries. Worker branches
`claude/reading-delivery-20261006-<topic>` in their own worktrees; a worker never edits another worker's files.

## RD-01 A minted place sits in the book (§187.2)

Status: ready-for-agent

- Kernel (`kernel-ts/apply/move.ts`, `kernel-ts/read/table-entities.ts`, `kernel-ts/read/module-graph.ts`
  `addTableEntity`): `establish` accepts `{summary, within?}`; a mint always writes `route-to` minted → departed scene;
  `within` (a book scene or location handle, `invalid_params` otherwise) writes `located-in` minted → within. The
  `table_entities` record carries `from` and `within`; `withTableEntities` restores both edges at load.
- Capsule (`kernel-ts/read/capsule.ts` `whereSection`): `where.within` as §187.2.2 states it; `sceneExits` of a
  minted scene includes the `route-to` back edge (it does already once the edge exists: test it).
- Read-ahead and candidates (`kernel-ts/modules/reading.ts` `queueAdjacentReading`, the §182.3 anchor,
  `kernel-ts/runtime/apply-operation.ts`): a minted scene anchors on its `within` place, else on the departed scene.
- Host placement (`extensions/table/`, the §12.5 lane pattern, family `scene-placement` in `runtime/jev/`): before a
  `move` effect with `establish` reaches the kernel, the host asks Jev §187.2.3's questions over the host-enumerated
  candidates; `same` above its bar rewrites the effect to a move to that place (no mint, `establish` dropped, `via`
  kept); `inside` above its bar adds `within`; else the effect goes through unchanged. Bars in `host-budgets.json`
  `scene_placement`; one telemetry row per placement with question, distribution, confidence, outcome.
- Tests: kernel (`tests/kernel/`): mint writes the back edge, `within` writes `located-in`, load restores both,
  `where.within` shape, read-ahead anchor; host (`tests/extension/`): the lane's three outcomes through the real
  apply tool path with a fake Jev adapter; mutation: drop the back edge → exits empty test fails.

## RD-02 Who the book puts here follows publication, the table says who stayed (§187.3)

Status: ready-for-agent

- `kernel-ts/runtime/apply-operation.ts`: `source_presence` candidates from the active scene **and** its `within`
  place; a candidate the ledger excludes (§187.3.2: dead, or moved out of this scene by a receipt) is not offered.
  Find the ledger's actual fields (`npc-ledger.json`, the death/departure receipts) and cite them in the test; do not
  invent a state.
- `kernel-ts/write/index.ts` `initialWorld` unchanged; a `source_reference` book keeps deferring (the offer is its
  path).
- Capsule: `present` stays `npc_presence`; `where.within.people` lists the within place's people with `seated:
  true|false`.
- Tests: a graph generation that adds a person with `present-in` the active scene yields an offer on the next
  `apply` candidates; the same for the `within` place of a minted scene; a dead person yields none; mutation: remove
  the exclusion → the dead-person test fails.

## RD-03 The brief's rosters follow the reading window (§187.4)

Status: ready-for-agent

- `kernel-ts/read/capsule.ts` `moduleSection` / `fittedModuleSection`: order `people`, `places`, `creatures` by
  §187.4 (window entries first, then book order), then the existing fit; add `more: {people, places, creatures}`
  counts when the fit cut lines. The window comes from `kernel-ts/modules/chapters.ts` for the active scene (or its
  `within` place); a book without a window keeps today's order.
- `extensions/table/context-runtime.ts`: the brief is already rebuilt on a source revision change; add the active
  scene's chapter to `briefingKey` so a window change rebuilds it.
- Tests: ordering with a window, `more` counts, no window = today's order; brief key changes with the chapter.

## RD-04 The author's task is cut to the job (§187.5)

Status: ready-for-agent

- `kernel-ts/modules/reading.ts` (claim packet): `known_nodes` and `known_claims` scoped by §187.5.1;
  `field_spans` removed from the packet (the checker takes them from the graph: `kernel-ts/modules/visual.ts`
  `checkDraft` callers pass the graph's spans; `coc-read-check` too); `vocabulary` scoped by purpose (§187.5.2).
- `extensions/module/reader.ts` / `reading-service.ts`: instructions assembled per purpose from
  `content/setup/visual-reader/` split files (§187.5.3); `readerInput` unchanged; telemetry `packet_bytes`,
  `inlined`, `known_nodes`, `known_claims`.
- Tests: packet of a detail job for pages 40–41 of a graph with nodes on pages 3, 40, 41, 70 carries 40/41's nodes
  and their one-hop neighbours and not page 3's; `field_spans` absent from `task.json` and the checker still
  rejects a same-span re-transcription; the detail instructions do not contain the index phase; mutation: unscope
  → the page-3 test fails.

## RD-05 A coverage `missing` inside the job's pages is an append repair (§187.6)

Status: ready-for-agent

- `extensions/module/targeted-repair.ts` `repairDecision` → `{kind: "append", missing, pages}` under §187.6.1;
  `extensions/module/reading-service.ts` runs the append brief; the host checks every existing record byte-identical
  and refuses a repair that edited or removed one (`reason: append_changed_existing`); review runs the new records'
  units plus coverage (`coverageCarry` of §186.4 does not apply: coverage is re-asked).
- Tests: in-page missing → append, out-of-page → full, unbound → full; an append that edits an existing record is
  refused; accounting row `repair: append`.

## RD-06 A need read's candidates are the need's pages (§187.7)

Status: ready-for-agent

- `runtime/jev/source-reader-driver.ts` (candidate union) and `runtime/jev/source-need-reads.ts`: for a need task
  the candidates are §187.7.1's; native text complete for lead pages, a title line for the rest; images for lead
  pages first; `need_read.lead_pages` in `host-budgets.json` (shipped 5), `need_read.min_lead_pages` (shipped 2).
- Tests: a need whose leads are pages 50, 52 and whose entity cites 12 gets candidates {50, 52, 12} and not the
  structural pages; text lengths; the author can still `pdf` another page; mutation: restore the union → test fails.

## RD-07 One independent reviewer per page set (§187.8)

Status: ready-for-agent

- `extensions/module/reader-review.ts` `batchGroups`: merge by page-set overlap up to `reading_review.images`
  (`host-budgets.json`, shipped 12) distinct pages and `reading_review.max_records` (shipped 32), not 8 / 24 KB;
  the coverage pointers join the unit whose page set equals the job's pages (a job with no such unit keeps a
  `/coverage` unit). Reuse (§151.2.1) keys stay per record, so a merged unit still reuses retained verdicts.
- Brief wording (`REVIEW_UNIT`, `content/setup/visual-reader.md` Verify phase): §187.8.2's sentence replaces "using
  pdf"; line 72 and line 169 no longer contradict.
- Tests: a two-page job's 12 records in one unit; a record citing a third page outside the budget starts a second
  unit; coverage rides in the first; the brief contains the delivered-images sentence; reuse still hits; mutation:
  restore the 8-record bound → the one-unit test fails.

## RD-08 Product-path acceptance

Status: ready-for-human (the lead runs it; workers do not)

- Fresh home, Blood Road PDF, `flapcode/gpt-6-luna` low, `tests/play/driver.py start --launcher
  bin/pi-coc-setup`, 20 turns as the spec's "Success" section scripts them; measures read from `turns.jsonl`,
  the request log, `reading-telemetry.jsonl` and the work directories; compared against `rc-accept-blood-01`.
- Outcome recorded under `## Comments` of the spec, pass or fail, before any merge or packaging question.

## Comments
