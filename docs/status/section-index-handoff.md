# Handoff — whole-book section index (0.5.1a)

**Written:** 2026-08-05 · **Branch:** `0.5.1a` · **Head at handoff:** `c7dad0b`

**Suite at handoff:** `3893 passed, 0 failed` (`uv run --frozen python -m pytest tests/ -q`)

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
`8e62e6c` · `a9101d8` · `2677f21` · `c7dad0b`.

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
`scratchpad/evidence/verified-ingest/` (session scratchpad, may be gone).

## 5. Remaining work — NOT verified

**One blocker.** The opening source review never completes, so its hard gate
never opens, so the coordinator never claims the `classify_sections` request
and `section-index.json` never lands. Everything upstream is done.

Latest failure, with the diagnostic chain now intact:

```
producer_error: coc-pdf-skill-adapter: reusable bound page 0 drift
```

**Cause.** The producer (a Grok child) is asked to echo, byte-for-byte, the
manifest rows of pages that overlap the already-bound bundle. It
re-serialized page 0's row. `_validate_reused_bound_pages` compares for strict
equality and fails the whole review.

**Entry points.**

- `plugins/coc-keeper/pi/bin/coc-pdf-skill-adapter.py` ~940–990
  (`_validate_reused_bound_pages`, `_raw_page_for_reuse_equality`,
  `_reusable_page_row`)
- the "keep overlapping manifest pages" requirement inside `_opening_prompt`
  (same file, ~640)

**Suggested fix, matching what already worked twice on this path:** do not ask
a producer to reproduce bytes it must not change. The repository already holds
those rows; splice them into the final manifest and let the producer supply
only the pages it genuinely adds. Compare `b29351a` (state the bundle contract
instead of making the producer guess) and `b8208db` (repository writes the
document, worker returns JSON).

**Verification loop.** Fix → `uv run --frozen python -m pytest tests/ -q` →
drive one real ingest (§7) → confirm `opening_source_review_task.status`
flips to `reviewed` in `.coc/campaigns/<id>/scenario/scenario.json` → confirm
`section-index.json` and `sections/` appear under the module root. Budget
10–20 min per review attempt.

**Earlier misattribution, stated so it is not repeated:** this error was first
blamed on the page-index base conflict. That conflict was real and is fixed,
but this failure reproduces on a clean 0-based ingest, so it is independent.

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

The session harness used here (`piplay.py` in the session scratchpad) is a
thin `pi --mode rpc` driver: `start <id>`, `say <id> "<text>" --timeout N`,
`stop <id>`. It drives the real product; it does not stand in for it. Rebuild
an equivalent if the scratchpad is gone.

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
