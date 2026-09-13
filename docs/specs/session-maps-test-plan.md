# Session Maps Test Plan

Status: implementation regression gates passed; product acceptance remains open.

Implementation commit: `65b127a778daa6ddd59e506e8dce623a3f9ef71e`
Branch: `codex/session-maps`
Specification: `docs/specs/session-maps.md`
Tickets: `docs/specs/session-maps-tickets.md`
Canonical contract: `docs/kernel-rpc.md` §36 and §36.1

This document is an execution plan for follow-up agents. It deliberately separates:

1. **Automated implementation evidence**, which is already green and must not be rerun merely to claim the product is accepted.
2. **Player-facing acceptance gates**, which still require a real Keeper, the main session as the sole player, actual PipiCOC UI observation, and a fresh original-PDF path.

A test count, a generated map file, a green fixture, or a Keeper sentence without the corresponding receipt and player-visible result is not acceptance evidence.

## 1. Current verified baseline

The following commands were executed on the integrated worktree and passed:

```bash
npm run check:kernel
npm run build:runtime
node --test tests/extension/source.test.mjs
node --test tests/extension/map-view.test.mjs
node --test tests/extension/turn.test.mjs
uv run --frozen python -m pytest tests/kernel/test_map.py -q
npm run test:ext
npm run test:electron
git diff --check
```

Observed results:

- `source.test.mjs`: 11 passed.
- `map-view.test.mjs`: 5 passed.
- `turn.test.mjs`: 18 passed.
- `tests/kernel/test_map.py`: 9 passed.
- `npm run test:ext`: 864 passed, 0 failed, 0 cancelled, 0 skipped.
- `npm run test:electron`: exit 0; 196 existing baseline failures, 0 new failures, no baseline changes.
- The current branch contains only the user's pre-existing dirty `tests/extension/no-such-catalog-cache.json` after commit; do not restore, stage, or rewrite it.

These results prove the implementation seams. They do **not** prove fresh-PDF production, real-table behavior, actual UI interaction, or worldline/restart acceptance.

## 2. Non-negotiable execution rules

Read `AGENTS.md` and `docs/acceptance.md` before running a real table.

### Real-table method

- Use `tests/play/driver.py` in RPC mode.
- Use the configured Keeper model from `.pi/coc-agent/settings.json`; record the actual provider/model and lane provenance.
- The main session is the sole player. Send one natural-language player utterance per turn.
- Run from setup/opening through a natural ending or a genuine blocker.
- Let the Keeper choose what to read, reveal, narrate, and ask. Do not script the Keeper's conclusions.
- Use a new campaign/run id for every attempt. Never delete or rewrite an old campaign, transcript, telemetry file, source, failed attempt, or playtest directory.

### Absolute prohibitions

Do not use any of the following as acceptance:

- `kp_settle_turn` or another batch settlement shortcut.
- A fake Keeper, scripted Keeper, keyword intent router, scene-template bank, or second Keeper implementation.
- A fixture that directly inserts map knowledge or map records into the acceptance campaign.
- A scripted player or batch-generated turns.
- A screenshot of an external source viewer instead of the PipiCOC conversation.
- Editing `tests/python-oracle.json`, `.cache/python-oracle/`, or the Electron failure baseline to hide failures.
- Deleting evidence to restart, changing source bytes in place, or reusing a stale campaign for a fresh claim.

If a non-default play method is genuinely necessary, stop and obtain explicit user authorization before using it.

## 3. Test ownership and waves

Independent agents may run in separate worktrees for code/test inspection, but only one agent may operate a given App, campaign, source home, or playtest at a time.

### Wave A — contract and regression audit

Owner: implementation/reviewer agent.

Confirm the integrated commit still has these properties:

- `apply map` requires semantic map/region names, player labels, and a non-empty fictional basis.
- Validation completes before `map_knowledge` mutates.
- Missing map bytes produce `available: false` and do not roll back an independently committed clue/game effect.
- Public projections omit source paths, source URLs, geometry, redactions, and unrevealed regions.
- PDF-derived player assets apply reviewed redactions before publication.
- Source digest mismatch fails closed.
- Historical cards retain their delivery-time bytes.
- Viewer operations are renderer-local reads and do not create model calls, receipts, clock changes, movement, clues, items, or new map knowledge.

Commands:

```bash
npm run check:kernel
npm run build:runtime
node --test tests/extension/source.test.mjs
node --test tests/extension/map-view.test.mjs
node --test tests/extension/turn.test.mjs
uv run --frozen python -m pytest tests/kernel/test_map.py -q
```

This wave is already satisfied by the integrated commit unless a later change modifies the listed paths.

### Wave B — built-in real-table map

Owner: real-table agent; main session is player.

Use The Haunting built-in module and a new campaign. The campaign must demonstrate:

1. Keeper discovers the built-in map through the normal semantic path.
2. A player-established observation reveals only one useful region.
3. A later interaction reveals another authorized region without widening unknown geometry.
4. A room name, generic visit, or physical handout alone does not reveal unrelated layout.
5. A secret/alternate-source region remains concealed until the Keeper establishes its discovery.
6. A displayed map card is visible in the actual conversation.
7. Reopening, zooming, panning, and known-only selection do not spend a fictional turn or call a model.
8. Leaving and returning preserves known regions.
9. Restart/resume preserves knowledge and historical card behavior.

Required evidence:

- `.coc/playtests/<run>/` RPC and turn records.
- `.coc/campaigns/<campaign>/turns/NNNN.json` receipts and mechanics.
- `world.json` before/after relevant reveals.
- public mechanics payload with no private map fields.
- authorized derivative bytes and a pixel inspection proving unknown source pixels are absent.
- actual PipiCOC screenshots/interactions for card open, zoom, pan, known-only selection, reopen.
- model-call/telemetry comparison proving viewer reopen is local-only.

Do not reuse the retained 2026-09-13 evidence as current-revision proof without recording its old revision/digest. That evidence is bounded historical evidence only.

### Wave C — fresh original-PDF production path

Owner: PDF/reader agent plus real-table agent. This is the primary remaining product gate.

Start from a new source home and a fresh original PDF through the normal setup path. Do not manually create map records. The run must:

1. Upload/select the PDF through normal setup.
2. Prepare only the opening and later demanded material through the existing reader queue.
3. Record the actual selected job, purpose, focus, question, checkpoint, source identity, and review generation.
4. Produce at least two independently revealable source-backed map regions when the source geography supports them.
5. Keep uncertain geometry unavailable/preparing; never widen a crop to make a test pass.
6. Validate physical page identity, crop/source coordinate frames, source revision, place correspondence, and annotation exclusion.
7. Publish reviewed assets through the existing publication path.
8. In the same or a later natural play need, show one authorized region in the conversation while another remains unknown.
9. Reveal the later region only after a new in-fiction knowledge basis.
10. Record cold preparation separately from cached/checkpoint reuse.

Required source evidence per published map:

- original page image references and physical page numbers;
- reader `task.json`, `draft.json`, `review.json`, `findings.json`, and observations;
- publication generation and asset manifest;
- independent review paths, verdicts, and negative findings;
- source byte digest and map region geometry;
- authorized derivative bytes and pixel/redaction inspection;
- campaign receipt connecting the map view to the Keeper's action.

A failed read, provider transport failure, rejected review, or unavailable source is an honest bounded result. Preserve it and record the exact failure; it does not become a successful fresh-PDF acceptance.

### Wave D — session viewer/UI acceptance

Owner: UI agent or main session with actual PipiCOC UI access.

Use actual conversation cards, not a source viewer or a unit-test renderer. Verify:

- two maps with similar labels retain distinct map/view/receipt identities;
- historical cards do not change when a current map becomes more revealing;
- current-session map access is discoverable without a synthetic Keeper turn;
- zoom and pointer-drag pan are usable;
- only known maps/floors/regions appear in tabs, thumbnails, tooltips, `alt`, accessibility text, previews, and empty states;
- invalid/missing image bytes show recoverable unavailable/preparing state;
- reopening a prepared map makes no model/RPC/game-state change;
- ordinary non-map handouts remain compatible;
- play-language labels are preserved while authored source pixels remain verbatim.

Record screenshots and, where possible, before/after telemetry counters for model calls, receipts, clock, RNG, movement, clues, items, and map knowledge.

### Wave E — persistence, source compatibility, and worldlines

Owner: state/history agent.

Use current TypeScript RPC/campaign/history interfaces and small controlled fixtures first; then use real UI evidence where available.

Cover:

- normal exit/resume without rereading accepted source material;
- two campaigns sharing prepared module material but not map knowledge or derivatives;
- old saves without map knowledge starting conservatively;
- exactly-once replay of the same map mutation;
- rejected/interrupted batches preserving atomicity;
- historical card bytes and source revision remaining stable;
- same region id with changed source bytes failing closed;
- changed geometry, placement, correspondence, redactions, or safety classification requiring new review;
- label-only compatible correction reusing authorization only when all reviewed geometry/source identity remains unchanged;
- worldline fork, switch, and confluence under existing worldline knowledge policy;
- no foreign-line derivative selected by stale UI cache.

Use the source revision rules in `docs/kernel-rpc.md §36.1`; do not invent a second compatibility rule in a test or a new map store.

### Wave F — final integration/evidence matrix

Owner: integrator.

Run sequentially:

```bash
npm run test:ext
npm run test:electron
uv run --frozen python -m pytest tests/kernel/test_map.py -q
```

Do not run two pytest commands concurrently. Do not add failure-baseline entries. Compare all failures against the recorded Electron baseline and report new versus known failures.

Then build an evidence matrix with one row per requirement family:

| Requirement family | Automated evidence | Real-table evidence | UI evidence | Status | Evidence paths |
| --- | --- | --- | --- | --- | --- |
| Built-in partial reveal |  |  |  |  |  |
| Observation without entry |  |  |  |  |  |
| Limited plan/name-only semantics |  |  |  |  |  |
| Secret/alternate-source reveal |  |  |  |  |  |
| PDF focused preparation |  |  |  |  |  |
| Independent PDF regions |  |  |  |  |  |
| Redaction/public pixels |  |  |  |  |  |
| Viewer read-only behavior |  |  |  |  |  |
| Restart/campaign isolation |  |  |  |  |  |
| Source compatibility/history |  |  |  |  |  |
| Worldline behavior |  |  |  |  |  |
| Fresh-PDF conversation card |  |  |  |  |  |

A row is `pass` only when the evidence type required by the story is present. Automated tests alone cannot mark real-table or UI rows as passed.

## 4. Evidence and timing format

For every run, record:

```text
run_id:
campaign_id:
module_id:
source_id / source_revision:
commit:
keeper_provider/model/thinking:
player: main session:
started_at / ended_at:
cold_preparation_ms:
first_reveal_display_ms:
cached_reopen_ms:
model_calls_for_reopen:
```

Keep preparation, reveal/display, and cached reopen timings separate from driver polling, provider idle time, and supervisor wait time.

Never delete a failed attempt. Add a short `README.md` or JSON summary beside the evidence if a run is blocked, and link the exact failed artifact paths.

## 5. Final acceptance rule

The session-maps implementation is code-complete when the integrated regression suite and contract tests pass. The parent specification is product-accepted only when Waves B–F supply the required real-table, fresh-PDF, UI, persistence, source-compatibility, and worldline evidence.

Do not close the parent spec merely because:

- all six tickets have code changes;
- all automated tests are green;
- a map record exists;
- a derivative image was generated;
- a Keeper claimed that a map was shown;
- a previous campaign already contains a map card.
