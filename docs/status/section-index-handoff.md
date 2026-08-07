# Handoff — whole-book section index (0.5.1a)

**Written:** 2026-08-05 · **Branch:** `0.5.1a` · **Head at handoff:** `1102576`
(previous handoff head `c7dad0b`)

**Suite at handoff:** `3900 passed, 0 failed` (`uv run --frozen python -m pytest tests/ -q`).
`for f in tests/pi/*.mjs; do node "$f" . ; done` — 7 pre-existing failures, no
new ones (leaf-context-probe, packed-smoke, private-loader-smoke,
private-surface, real-lifecycle-probe, repository-ref-preload,
setup-visible-provenance).

This picks up mid-task. Everything below the "Remaining work" heading is
verified; that section is not.

---

## 1. Why this feature exists

A survey of all 11 scenarios in `~/Documents/TRPG/克苏鲁的呼唤` (plus both
rulebooks) found the parser's demand model structurally incomplete, not merely
thin:

- **9/11** keep NPC stat blocks in a back section or appendix with **no
  location edge pointing at it**. Walking the location graph — the only demand
  signal the old parser had — can never reach them.
- **11/11** open with a Keeper-truth section the location graph never touches.
- **8/11** ship pregens no scene references.
- Read-aloud box text appears in nearly all of them and **never as a titled
  section**, so a section index cannot reach it; it has to be a location-pack
  field.
- Progression structure is formally inconsistent (event timeline / acts / day
  schedule / random events / a state clock), so it must be reduced by a model,
  never by title matching.

The whole-book section index is therefore a prerequisite for on-demand
parsing, not an optimization.

## 2. What was built

| Module | Role |
|---|---|
| `coc_source_outline{,_producers}.py` | Deterministic heading extraction by typography alone |
| `coc_module_sections.py` / `coc_module_section_requests.py` | Whole-book classification: request projection and result validation |
| `coc_module_section_packs.py` | Extraction of one indexed section into `sections/<id>.md` |
| `coc_module_reconcile.py` + `agents/coc-section-secretary.md` | Cross-section reconciliation (id mappings + conflicts only) |
| `coc_module_outline_store.py` | Binds outline production to a module asset root |

Commits, oldest first: `7a45925` (feature) · `8461450` · `2d03687` ·
`b29351a` · `82bc46e` · `b8208db` · `4bba996` · `59d3581` · `05b1df3` ·
`8e62e6c` · `a9101d8` · `2677f21` · `c7dad0b` · `1102576`.

## 3. Rules that must not be broken

- **No keyword lists for open-ended semantics.** Heading selection is pure
  typography (glyph weight vs the document's own body mode; emphasis only when
  emphasis is rare). No title patterns or section vocabulary exist in
  `coc_source_outline*`, and none may be added. Classification is the model's
  job.
- **The repository opens no PDF.** Enforced by
  `tests/test_python_contract.py::test_repository_has_no_builtin_pdf_parser_or_parser_imports`
  (bans `pypdf`/`pdfplumber`/`pymupdf`/`fitz` under `plugins`, `runtime`,
  `scripts`). Exact font metrics arrive as a host-produced line list
  (`host-outline.json`, producer `host_outline`). The offline survey harness
  that does use PyMuPDF lives in the session scratchpad, outside the repo, and
  feeds the plugin through that same contract.
- **Workers have zero tools and never write files.** A leaf returns one bare
  JSON object; the *repository* writes `sections/<id>.md`. That is what keeps
  the evidence chain (page refs → accepted cache → sha256 → provenance)
  checkable.
- **Labels come from the index, never the extractor.** A worker that could
  relabel its own section could move Keeper-only material onto a player-facing
  surface.
- **No fabricated defaults.** `project_skeleton_to_ir` used to stamp every
  scene `horror_stage="wrongness"`, split tension by `is_start`, give every
  threat a 4-segment clock, and ship four fixed English improvisation-boundary
  strings. Unparsed values are now `null` + an explicit `unresolved` state. Do
  not reintroduce plausible-looking defaults: the Keeper reads those files as
  module intent.
- **One page-index base.** `coc_pdf_bundle` enforces
  `0 <= pdf_index < page_count`; both lanes that write `pages/NNNN.md` use it.
  `tests/test_module_page_base.py` pins them together. Do not reintroduce an
  offset (see §6).

## 4. Verified end to end on a real ingest

Real bind of `[COC模组翻译]归于尘埃 -Dust to Dust.pdf`, not a fixture:

```
bind PDF          located
full_parse        complete — 23 pages, indices 0..22, no duplicates
outline           cached_pages / exact — 42 candidates
classify_sections awaiting_host_pack → host-work request open
                  packet 12.9 KB, cached_page_refs []
ready_for_background_count 0 → 1, background_takeover PRESENT
```

The stat blocks that no location edge points at (`人物数据` plus 17 named
NPCs) are addressable index candidates at p20–22.

Evidence snapshot from that run:
`~/leehow/code/.chatrpgv4-handoff/evidence/verified-ingest/` (outside the
repo, preserved from the session scratchpad).

## 5. Opening source review — FIXED and verified on a real ingest

The previous blocker (`coc-pdf-skill-adapter: reusable bound page 0 drift`) is
closed by `1102576`.

**Diagnosis, confirmed by real evidence.** The producer was asked to echo,
byte-for-byte, the manifest rows of pages overlapping the already-bound
bundle, and `_validate_reused_bound_pages` compared them for strict equality.
The failed 11:24 attempt on 2026-08-05 shows exactly what a model does with
that instruction — the retained page-0 row came back with identical
`markdown_path`, `text_sha256` and `grep_anchors`, and one relabelled field:

```
retained : "review_state": "auto_accepted"
producer : "review_state": "manual_accepted"
```

Preserved at
`~/leehow/code/.chatrpgv4-handoff/evidence/opening-review-prefix-echo-manifest.json`.

**Fix.** The repository now authors those rows. `_splice_retained_bound_pages`
reads the producer's manifest, replaces every already-bound page's row with the
retained one, keeps the producer's rows only for pages it newly rendered, and
rewrites `manifest.json` before the bundle validator runs. `_opening_prompt`
now tells the producer to select a retained page by *index only* and never to
restate its row. `_raw_page_for_reuse_equality` is gone;
`_validate_reused_bound_pages` survives as a post-splice repository invariant.
A producer that edits a retained page's bytes still fails closed, now with a
named `reusable bound page N was modified` instead of an anonymous hash
mismatch.

**Real-ingest evidence** (campaign `vfy2`, real `归于尘埃` PDF, live pi-coc RPC
session, Grok producer, 2026-08-05 12:18–12:20 — the fix was committed 12:12):

- `opening_source_review_task.status` → `reviewed` → consumed to `fulfilled`,
  generation 2; `opening_source_provenance` =
  `coordinator_reviewed_playable_opening`; facts adopted (era 1920s from p3).
- Reviewed bundle `.tmp/coc-opening-source-review/vfy2/reviewed-17cxzgdf`
  binds pages `[0, 1, 3]`. Rows 0 and 1 are **byte-identical** to the
  previously bound manifest rows (spliced by the repository); row 3 is the
  producer's new page. Copy at
  `~/leehow/code/.chatrpgv4-handoff/evidence/opening-review-spliced/`.
- The product then reports, in its own gate payload:
  `"opening source review is complete; finish the exact canonical investigator
  link"`, phase `opening_character_setup_required`.
- Snapshot: `~/leehow/code/.chatrpgv4-handoff/evidence/vfy2-scenario-reviewed.json`.

Note the review took two attempts in that session (one earlier failure, then a
success); retries are cheap and expected. Budget 10–20 min per attempt.

**Earlier misattribution, stated so it is not repeated:** this error was first
blamed on the page-index base conflict. That conflict was real and is fixed,
but this failure reproduced on a clean 0-based ingest, so it was independent.

## 5b. Remaining work — NOT verified

`section-index.json` and `sections/` still do not exist. The section lane is
one step further along than before but is now blocked by a **different** gate.

- ~~`classify_sections` is open and unclaimed~~ — it **could not be claimed at
  all** (19569 bytes against a 16384-byte claim budget). Fixed and verified: it
  now reaches `leased`. See §5d. It came back `coordinator_partial`, so the
  section lane is still unverified for a *new* reason — leaf output, not
  transport. See §5g.
- ~~Play never starts~~ — **play now starts.** The character-setup gate (§5c),
  the pending-watch deadlock (§5e), and the dispatch-attempt dead end (§5f) are
  all fixed and verified in live play, with dice on disk. See §5g.

So: item "coordinator claims `classify_sections`" and item
"`section-index.json` / `sections/` land" are **unverified**. Everything
between the bind and the opening-review gate is verified.

## 5c. Character-setup gate — fixed and verified in live play

`ACTIVE_IMPLEMENTATION_TRACK=pi-coc`. Codex-host implementation, adapters,
prompts, launchers, tests, and docs were off-limits for this work.
`plugins/coc-keeper/scripts/coc_mcp_wire.py` is shared kernel and was **not**
authorized, so it is unchanged; both fixes are Pi-side only.

Two systemic gaps, both in `plugins/coc-keeper/pi/extensions/index.ts`:

1. **The gate refused without naming the failing field.** The catch-all
   rejection echoed the retained route for every refusal, so a KP holding a
   near-miss create payload had nothing to converge on. The create branch of
   `canonicalSetupInvokeForOpening` now delegates to
   `investigatorCreatePayloadFailures`, which collects field-name tokens; the
   boolean predicate is `failures.length === 0`, so message and check cannot
   drift. `openingInvestigatorCreateRejection` returns those tokens **plus**
   the retained route (route-after, not route-instead) — every rejection still
   leaves the KP holding the route. Field names and schema-declared literals
   only; supplied values and source text are never echoed.
2. **The KP was told its schema had been truncated when it had not been.**
   `wire.payload_projected` is set from `projector is not None`, so it reads
   `true` even for a no-op projection. Reading that alone, the KP concluded
   `payload_schema` was incomplete and spent the gate trying to re-fetch a
   fuller one (`include_full_schema: true`, `coc_discover`) — both refused,
   closing the loop. `projectPiGuidedCharacterContract` now stamps
   `result.payload_schema_projection` stating truthfully that the schema is
   complete for the selected input mode, listing only the unusable branches it
   dropped, and saying no fuller schema exists.

**Measured, not assumed.** The raw contract for `vfy2` is 15145 bytes against
the 16384 budget and already carried a complete `payload_schema`; the KP always
had `quick_fire_creation`, including `luck_roll_receipt` documented as *"Exact
roll_id returned by the canonical rules.roll_dice receipt."* `rules.roll_dice`
has no wire projector, so its `roll_id` always reached the KP. The receipt was
discoverable the whole time — the misleading flag, not a missing field, is what
deadlocked the opening. After the Pi projection the envelope is 14044 bytes,
1.4 KiB *more* headroom than before.

**Live verification** (`pi --mode rpc`, campaign `vfy2`, Grok-4.5 as KP, one
player line per turn, via `~/leehow/code/.chatrpgv4-handoff/piplay.py`): the KP
cleared the gate on its own inside a single turn, where it previously burned
three turns and ~20 payloads and quit. On disk:

```
.coc/investigators/lin-zhiyuan/creation.json
  input_mode: guided_quick_fire   method: quick_fire_array
  luck_roll_total: 10
  luck_roll_receipt: {campaign_id: vfy2, decision_id: vfy2-linzhiyuan-luck-001,
                      roll_id: toolbox-vfy2-000004}
  assignment_order: [EDU, INT, POW, APP, DEX, CON, SIZ, STR]
.coc/campaigns/vfy2/save/investigator-state/lin-zhiyuan.json   current_luck: 50
.coc/campaigns/vfy2/assets/character-cards/lin-zhiyuan/investigator-character-card.md
```

`create` → `link_investigator` → `render_card` all succeeded, and Luck 50
traces to canonical roll `toolbox-vfy2-000004`. The one create that did fail
failed *downstream* on real rules arithmetic
(`skill_budget.occupation_points ... 250 must equal 320/320`) — a precise,
convergeable message, and the KP fixed it the next turn.

Regression coverage: `tests/pi/auto-dispatch-smoke.mjs` (refusal names the
missing luck receipt and its `rules.roll_dice` source; names every failing
field at once without echoing values) and
`tests/pi/guided-character-contract-smoke.mjs` (completeness marker is present
and truthful for both input modes). `tests/test_pi_package.py`,
`tests/test_plugin_metadata.py`, `tests/test_investigator_contract_discovery.py`
— 121 passed, including the previously flaky
`test_pi_auto_dispatch_uses_named_paths_and_bounded_pending_queues`.

## 5d. Root cause of the section lane — `classify_sections` cannot be claimed

**Corrects an earlier reading in this file.** `job-6f7311bf86d7` is not sitting
"open and unclaimed" waiting for a free coordinator. **It cannot be claimed at
all**, and it never could be. Everything below is from the live `gatefix1`
session audit (`~/.pi/coc-agent/sessions/--Users-haoli-leehow-code-chatrpgv4--/
2026-08-06T01-31-28-004Z_gatefix1.jsonl`) plus direct measurement.

The dispatch **succeeded**:

```
coc-source-coordinator-auto-dispatch  { status: submitted,
                                        dispatch_key: source-coordinator-0ea6571628f1c8e55eef }
```

Then the coordinator ran and failed on the claim:

```
status: failed   failure_class: leaf_result_invalid
claim_calls: 1   claimed_packet_count: 2   leaf_task_count: 2
fulfilled_result_count: 0
diagnostics: 2x { phase: claim_projection,
                  code: claim_wire_projection_failed,
                  validation_path: claim.wire.claim_dispatch_projection_failed }
             job_ids: [job-ccac683bd6e7], [job-6f7311bf86d7]
```

`progressive.claim_host_work` exceeded the 16 KiB `keeper_hot_v1` transport
budget, so `coc_mcp_wire.py:2323-2335` replaced the result with
`_claim_projection_failure` and **both leases were voided**. Measured sizes:

| job | kind | bytes | fits 16384? |
| --- | --- | --- | --- |
| `job-ccac683bd6e7` | `partial_opening` (1 index) | 11820 | yes |
| `job-6f7311bf86d7` | `classify_sections` (23 indices) | **24662** | **no** |

`limit: 2` comes from the repository-produced packet (`max_leaves = 2`), so the
two were claimed together — 36 KiB against a 16 KiB budget. But **lowering the
limit does not fix this**: `classify_sections` alone is already 1.5x the whole
budget. Inside it, `classification_request.candidates` is 42 whole-book section
candidates at 16399 bytes — 74% of the job, and by itself over budget. A
whole-book classification request is inherently too big for the hot claim
envelope. Note `classification_request.chunk` already exists as a field.

**This is why `section-index.json` and `sections/` never appear.** It is not a
coordinator availability problem and not a KP discipline problem.

### What was fixed here, and what was not

Fixed (Pi track, authorized): the **false reason**. `index.ts:5682` returns a
bare `null` when the manager already owns a dispatch key — which is the normal
state on every retry after the first attempt terminates — and the caller mapped
any `null` onto `coordinator_capability_unavailable`, a capability that
`piCoordinatorEnabled()` reports as **true**. New
`coordinatorDispatchNullReason` reads the manager and reports the real terminal
`failure_class` plus its diagnostic codes; only a genuinely unknown dispatch key
is still reported as a capability question. Covered in
`tests/pi/auto-dispatch-smoke.mjs`.

**Not fixed:** the claim budget itself. Every candidate repair lands in
shared-kernel files that were **not authorized** for this work —
`plugins/coc-keeper/scripts/coc_mcp_wire.py` (the claim projector) and/or
`plugins/coc-keeper/scripts/coc_toolbox.py` (what `claim_host_work` inlines and
how `max_leaves` is chosen). The Pi side cannot repair it honestly: the packet
is repository-authored and `validateCoordinatorTask` enforces its exact keys, so
having Pi rewrite it would be exactly the "make the producer reproduce bytes"
mistake recorded in §6. Three directions, all shared-kernel:

1. Project `claim_host_work` so bulk like `classification_request.candidates`
   travels by reference and the worker reads it, instead of voiding the claim.
2. Stop inlining `candidates` in the claim result at the toolbox boundary.
3. Actually use `classification_request.chunk` to split 42 candidates across
   several claimable jobs.

### Direction 1 implemented and verified in live play

`coc_mcp_wire._spill_structure_requests` moves `classification_request` /
`extraction_request` out of an over-budget claim as a workspace-relative path
plus digest; `runtime.inflateSpilledStructureRequests` reads it back and
re-verifies the digest before `validateLeafTask`, so the leaf contract is
unchanged. Fail-closed on digest drift, on a path escaping the workspace, and
on a request carrying both the payload and its ref.

**Live result.** In session `live5`, `job-6f7311bf86d7` (`classify_sections`,
the 19569-byte job that "could never be claimed") reached
`dispatch_state: leased` for the first time, alongside `job-ccac683bd6e7`. The
coordinator recorded `{status: submitted}` with **no**
`claim_dispatch_projection_failed`, **no** `leaf_result_invalid`, and **no**
`capability_unavailable`. The claim lane is fixed.

**Delivery shape, resolved.** The live Pi path uses
`_pi_source_coordinator_dispatch`, which passes
`claim_result_delivery="task_return_to_parent"` and therefore *does* build
`dispatch_tasks` (`coc_toolbox.py:15839`). An earlier probe of mine passed
`return_to_parent` and got bare `packets` — a different, codex-side delivery.
The projector now walks both shapes via `_iter_claim_packets`, so neither can
silently no-op again.

## 5e. Pending opening watch — fixed, with a re-arm card

A watch is persisted in the campaign, but its resolver (the coordinator) is
spawned per session. A session dying between `opening_bootstrap` and pack
fulfilment left `status: pending` and `next_operation: null` forever. Observed
live: the Keeper answered three player turns with empty messages — correctly,
because it had been told to wait.

`_opening_watch_resolver_lost` now reports a watch whose resolver is gone —
older than `_OPENING_WATCH_RESOLVER_GRACE_SECONDS` (900s) **and** no host work
leased for the root — and the gate emits `source_lifecycle_status:
resolver_lost` carrying an exact `progressive.opening_bootstrap` re-arm card
instead of null. Pi forwards it (`projectStartupSourceMaterialization`,
`canonicalMaterializationProbe`, `recoveredSourceMaterializationRoute`); the
re-arm route deliberately does **not** set `source_materialization_wait_only`,
which would block the very call that recovers the campaign.

The card carries the **whole** `start_location` object, looked up from the
skeleton. This matters: with only the retained id exposed, a live KP sent the
bare string `"martins-beach"` to a contract requiring `{location_id, title}`
**55 times in one turn**. The repository owns that shape and now supplies it;
`missing_arguments` is empty.

**Live result.** The deadlock is gone — the Keeper went from 0 bootstrap calls
(pure empty turns) to invoking the card and driving the coordinator to
`submitted`.

## 5f. Dispatch attempts, and the third form of the same bug

**Dispatch attempts were a one-way door.** `dispatch_attempts` increments on
*claim*, not on failure, and `_PI_SOURCE_COORDINATOR_MAX_ATTEMPTS = 2`. So a
projection bug or a killed session — neither of which says anything about the
work — burned a campaign's only retries, after which `opening_bootstrap` failed
with a vague `opening_host_work_takeover_unavailable` and no way out.

Fixed in two parts:

- `release_host_work_leases` now **refunds** the attempt when the release
  reason is host-side (`_HOST_SIDE_RELEASE_REASONS`: `claim_projection_invalid`,
  `coordinator_shutdown`, `coordinator_aborted`,
  `turn_pending_finalization`) and reports
  `dispatch_attempt_refunded_job_ids`. Content failures (`leaf_result_invalid`,
  `coordinator_failed`, `coordinator_partial`) still spend the attempt, and a
  lease lost to an abrupt crash never reaches this path, so TTL recovery still
  costs one. The ceiling keeps protecting against genuinely bad work.
- When every candidate is exhausted the error is now
  `opening_host_work_dispatch_attempts_exhausted`, naming the ceiling and the
  exact `job_ids`, instead of "no canonical takeover".

**The same swallow-the-card bug, third form.** With the opening finally
succeeding, the gate moved to `source_lifecycle_status: complete` and handed
back a `progressive.project_opening` refresh card — and
`projectStartupSourceMaterialization` dropped it, because it whitelisted only
`pending` and (newly) `resolver_lost`. That `complete` branch is **pre-existing
code**; nobody had hit it because the opening had never succeeded before. The
projector now forwards any non-`pending` state carrying one of the exact
recovery operations, and passes the canonical `instruction` through rather than
rewording it — so a fourth state cannot silently reintroduce this.

## 5g. Play actually starts — verified

Session `play2`, campaign `vfy2`, Grok-4.5 as KP, one player line per turn:

```
【开场时间】1925-01-15 20:00
林致远站在马丁滩的碎石岸边。
冷风从大西洋面上刮来，带着盐腥与腐藻气味 ...
```

and on the next player line, a real adjudicated check:

```
【明骰】侦查｜掷骰：62；基础值：50；门槛：普通（≤50）；达到：失败；未通过
```

Evidence on disk: `opening_projection_watch.status: complete`;
`job-ccac683bd6e7` (`partial_opening`) `status: fulfilled`; scene
`martins-beach` upgraded `toc_only` → `partial`;
`.coc/campaigns/vfy2/logs/rolls.jsonl` holds the Spot Hidden failure and the
Quick-Fire Luck 3D6. Operations exercised include `scene.context`,
`state.move_scene`, `rules.roll`, `state.journal`, `turn.finalize`.

The chain that was dead end-to-end now runs: re-arm card → bootstrap → claim
(with the structure payload spilled) → leaf fulfilment → watch complete →
opening projection → live play with dice.

**Still open:**

- `campaign.status` stays `setup` and `active_scene_id` stays `None` even
  though `active-scene.json` names `martins-beach` and narration and checks are
  flowing. Not diagnosed; it did not block play.
- `section-index.json` / `sections/` still do not exist. `job-6f7311bf86d7`
  (`classify_sections`) was claimed — the thing it could never do before — but
  came back `coordinator_partial`. The whole-book section lane therefore
  remains **unverified**, and the next attempt should start from why that leaf
  returns partial, not from the claim transport.

## 6. Landmines

- **Interpreter.** Repository code refuses to run on anything but the pinned
  CPython. Always `uv run --frozen python ...`. A bare `python3` picks up conda
  3.13 and fails with `unsupported Python interpreter`. Adapters spawned by
  the Pi extension inherit `PATH` with `.venv/bin` prepended by `pi-coc`; if
  you reproduce an adapter by hand you must prepend it yourself or you will
  chase a phantom interpreter error.
- **Baseline failures were environmental.** Two contract scans reached into
  `runtime/adapters/*/node_modules.noindex/`. They skipped `node_modules` by
  exact name; macOS installs them with the `.noindex` suffix. Fixed in
  `c7dad0b` by prefix match.
- **`zsh` does not word-split unquoted parameters.** `for n in $LIST` runs
  once with the whole string. This silently no-oped a cleanup and left the
  registry pruned while directories survived.
- **Synthetic fixtures squat on real PDFs' sha256.** Eight
  `not_product_parse=true` roots were deleted 2026-08-04 with the user's
  approval. If a bind fails with an asset-root collision, check
  `.coc/module-assets/` for synthetic roots first, and prune
  `registry.json` to match whatever you remove.
- **Transient provider errors used to be terminal.** A dropped connection made
  a PDF unbindable for the rest of a session (terminal states are cached per
  dispatch key). Fixed in `a9101d8`; only preflight rejections stay terminal.
  If you see a bind fail once and refuse to retry, check that first.
- **`"Connection error."` is exactly 18 bytes.** Failures that used to read
  `stderr redacted (18 bytes)` were that string. Short child stderr is now
  surfaced (`59d3581`); long stderr stays redacted because a producer that got
  far enough to read the book can echo source text into it.
- **One flaky test, unexplained.**
  `tests/test_pi_package.py::test_pi_auto_dispatch_uses_named_paths_and_bounded_pending_queues`
  failed once in a full run and never reproduced (alone, or paired with
  `test_toolbox.py`, or in later full runs). `pytest-randomly` is enabled. Not
  known to be fixed — if it reappears, chase the ordering interaction.
- **Do not ask a producer to reproduce bytes.** This path has now been fixed
  three times the same way: state the contract instead of making the producer
  guess (`b29351a`), let the repository write the document and the worker
  return JSON (`b8208db`), let the repository author the retained manifest rows
  (`1102576`). If a new check compares producer output for strict equality
  against something the repository already holds, the repository should supply
  it instead.
- **`scenario.bind_pdf` will not take a raw PDF path.** A live KP asked to
  "bind this PDF" burns a whole turn discovering that it needs a directory
  containing `manifest.json`, tries `coc_progressive_ocr export` output
  (rejected: `external_manifest_required`), and eventually collides with the
  content-addressed asset root (`cached page 0 content drift ... refused
  because campaign(s) still reference asset root 'dust-to-dust'`). To exercise
  the section lane, **resume the existing `vfy2` campaign** rather than binding
  a fresh one; a new campaign for the same PDF cannot get its own root while
  `vfy2` holds it.
- **The workspace is not stable under you.** Two module roots vanished
  mid-session without any delete being issued, and the cause was never
  established. Snapshot artifacts you rely on rather than re-reading them
  later.

## 7. Driving a real ingest

Playtests must be real: a live KP in one process and single-line player input,
one turn at a time. Fake-KP shortcut scripts (`kp_settle_turn`, batch settle,
keyword routing, scene-template banks) are banned — see `Agents.md`
§*Absolute Ban: Fake-KP Shortcut Scripts* and
§*Standing Memory: Never Self-Authorize a Different Playtest Method*. Any
non-default method needs the user's explicit permission in the current turn.

The session harness used here is a thin `pi --mode rpc` driver preserved at
`~/leehow/code/.chatrpgv4-handoff/piplay.py`: `start <id>`,
`say <id> "<text>" --timeout N`, `stop <id>`. It drives the real product; it
does not stand in for it.

Useful probes:

```bash
# module root state
uv run --frozen python -m pytest tests/test_section_lane.py -q

# is a request claimable, and what does the packet carry
uv run --frozen python -c "..."   # see §4 numbers for what to expect
```

## 8. Design decisions the user made

- Module-local rules (轴D) are **KP hint text only**; the engine does not
  change.
- The director layer is **parsed, not generated**.
- Maps are **out of scope**.
- Content warnings are parsed and stored, with **no player confirmation step**
  (deferred).
- Section classification runs on a **whole-book low-resolution lane**, not the
  1–3 page leaf lane, because section identity is a global judgement: the same
  appendix title means player handout cards in one module and an NPC roster in
  another.

## 9. Known-deferred

- The Pi `CoordinatorDispatchManager` still serializes to one active
  coordinator (`pi/lib/runtime.ts`, `private active` is a single value; leaves
  cap at 4 via `max_leaves = min(4, ...)` in `coc_toolbox.py`). Batch section
  work therefore runs slower than designed. Changing it touches lease, wake and
  dedupe invariants across ~8k lines and was judged too risky without a live
  playtest.
- The secretary agent (`coc-section-secretary`) is contract-complete and
  unit-tested but has never run against a live model.
- `extract_section` (section body → `sections/<id>.md`) is contract-complete
  and unit-tested; it has not run end to end, because it depends on the index
  that §5 blocks.
