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

- `classify_sections` request `job-6f7311bf86d7` is **open and unclaimed**
  under `.coc/module-assets/dust-to-dust/host-work/` (`dispatch_state: ready`,
  `dispatch_attempts: 0`, 23 requested indices).
  `progressive.status --campaign vfy2` reports `awaiting_host_count: 1` and a
  present `background_takeover` (`direct_single_leaf`,
  agent `coc-source-pack-worker`). The coordinator claims it during play.
- Play never starts. The next hard gate, `opening_character_setup_required`,
  lists `investigator.create` as an allowed action but rejected roughly twenty
  live payloads across three turns, each time returning the route again with
  no validation reason. The acceptance predicate is
  `plugins/coc-keeper/pi/extensions/index.ts:852` — it demands
  `creation.method === "quick_fire_array"`, an 8-long
  `characteristic_assignment_order`, an integer `luck_roll_total`, and a
  `creation.luck_roll_receipt` whose keys are exactly
  `campaign_id`/`decision_id`/`roll_id`. The KP never produced the receipt, and
  `setup.investigator_contract` kept returning a projected payload
  (`payload_projected: true`) it could not expand while the gate was active.
  This is a separate systemic gap (a hard gate that rejects without telling the
  KP which field failed), not a section-index problem.

So: item "coordinator claims `classify_sections`" and item
"`section-index.json` / `sections/` land" are **unverified**. Everything
between the bind and the opening-review gate is verified.

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
