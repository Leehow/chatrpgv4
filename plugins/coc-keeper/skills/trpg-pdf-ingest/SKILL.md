---
name: trpg-pdf-ingest
description: Prepare TRPG PDF source evidence with an external host PDF skill, then validate and deterministically reformat the host-produced bundle for the COC scenario compiler.
---

# TRPG PDF source handoff

This repository does not parse PDFs. It has no OCR, layout, table, rendering,
or PDF text-extraction backend. An **external PDF skill** on the host inspects
and extracts the source, then hands a versioned source bundle to the repository
formatter. Never add a local repository parser fallback.

## Progressive parse note (Tier 0–2 host workflow)

For large or multi-location modules, do **not** extract the whole PDF before
play. Follow `docs/active-plans/coc-on-demand-module-skeleton.md`.

### Tier 0 — Identity

Host PDF skill: cover + title page only. Record `module_identity` +
`file_sha256` + `page_count`.

```bash
uv run --frozen python plugins/coc-keeper/scripts/coc_module_assets.py \
  --workspace . init \
  --asset-root-id <canonical_or_pdf-hash16> \
  --file-sha256 <sha256> \
  --identity-json '<module_identity json>'
```

### Tier 1A — Play bootstrap skeleton (blocking minimum)

Read only enough cover/TOC/front matter to establish the source-bound start
candidate, a valid sparse topology, and exact opening-page locator. Store a
valid skeleton immediately; empty or unresolved roster/index collections are
legal when explicitly represented. Tier 1A plus the Tier 2 opening deep pack
is the first-play readiness boundary. Do not hold the player for appendix,
finale, or remote-region enrichment.

### Tier 1B — Skeleton enrichment (background bounded windows)

Host extracts **selected** TOC + keeper-background headings + dramatis personae
titles + resolution/timeline titles (still ≤32 pages per source-bundle window).
Tier 1 also emits a lightweight `mechanics_index`: stable NPC/item identities,
`status` (`located`, `unresolved`, or reviewed `not_authored`), and exact
`source_page_indices`. Inspect appendix headings, character-roster pages, and
chapter-end stat/special-item sections as bounded locator windows; do not
deep-extract every block yet. Several subjects on one page share the same page
locator so a later host pass can resolve them together.
Validate with `coc_pdf_bundle.py` if using a formal handoff window, then emit
structured `skeleton.json` (locations, provisional edges, npc_roster names,
handout index, threat stubs, start_candidates). **No full handout bodies.**
Independent roster/mechanics-locator, handout/threat/finale, and remote-region
index windows may run concurrently after Tier 1A. Each accepted result updates
the same canonical skeleton; this is bounded index enrichment, never an
unbounded deep crawl of the whole PDF.
When the source establishes a calendar opening whose daylight differs from the
default 06:00/12:00/18:00/21:00 phases, include a top-level `start_clock` with
the exact `local_datetime`, `timezone`, `display`, and optional
`day_phase_boundaries` (`morning_start`, `afternoon_start`, `evening_start`,
`night_start`, each `HH:MM`). Declare only source- or setting-grounded values;
do not infer a printed-page offset or silently guess seasonal sunrise.

```bash
uv run --frozen python plugins/coc-keeper/scripts/coc_module_assets.py \
  --workspace . put-skeleton \
  --asset-root-id <id> --skeleton-json /path/to/skeleton.json

# Project topology into an existing campaign (sparse IR, not full green compile)
uv run --frozen python plugins/coc-keeper/scripts/coc_module_project.py \
  --workspace . skeleton --campaign <campaign-id> --asset-root-id <id>
```

### Tier 2 — Opening deep

Host deep-extracts **start location pages only**, builds a deep location pack
(`parse_state: deep` with clues/NPCs/affordances), stores it, projects:

```bash
uv run --frozen python plugins/coc-keeper/scripts/coc_module_assets.py \
  --workspace . put-page --asset-root-id <id> --pdf-index N --text-file page.md
uv run --frozen python plugins/coc-keeper/scripts/coc_module_assets.py \
  --workspace . put-entity --asset-root-id <id> --kind location \
  --entity-id <start> --entity-json /path/to/opening-deep-pack.json

uv run --frozen python plugins/coc-keeper/scripts/coc_module_project.py \
  --workspace . opening-deep --campaign <campaign-id> --asset-root-id <id> \
  --pack-json /path/to/opening-deep-pack.json
```

Table delivery still uses campaign `play_language`. Source-language page text
stays in the asset store as evidence.

This skill still owns only the **per-window source-bundle** contract for host
extracts (`MAX_PAGES` per window).

## Host PDF skill priority

What matters is the **source-bundle contract** below, not which brand of PDF
tool produced it. Choose the producer in this order:

1. **Prefer the current host's existing PDF capability** when it can fulfill
   the contract — for example Claude Code's document `pdf` skill, Codex's
   built-in `pdf` skill, or any other host-native render/extract/review path
   the user already uses successfully.
2. **If the host has no suitable PDF skill**, recommend the open-source Codex
   workflow published as
   [`openai/skills` → `skills/.curated/pdf`](https://github.com/openai/skills/tree/main/skills/.curated/pdf)
   (render with Poppler/`pdftoppm`, multimodal visual review, optional
   text-layer extract with `pdfplumber`/`pypdf`). Install or mirror that skill
   on the host and use it.
3. A user-supplied third-party PDF pipeline is fine **only when** it still
   emits the same bundle schema, review evidence, and hashes. Do not invent a
   second in-repo parser to paper over a missing host skill.

`manifest.producer` stays the contract identity `codex-pdf-skill` even when a
non-Codex host or Claude/Grok-side install of that workflow produced the
bundle. It names the **handoff contract**, not a hard requirement that the
session must run inside Codex.

Preferred host workflow (any producer that reaches the same quality):

- Prefer page rendering + visual verification over whole-document OCR.
- Use text-layer extraction when exact strings, anchors, or tables are needed.
- Multimodal page review is the default understanding path; OCR is optional
  and only for scans or hosts without adequate page vision.

### Cold-start locator order

For a newly attached large PDF, locate before rendering. Inspect document
outline/bookmarks first; if absent or insufficient, inspect the smallest
plausible TOC/front-matter window, then use a text-layer title lookup only as a
locator. Do not raster-render speculative 20–32-page ranges to discover where a
named scenario starts, and do not rasterize a sequence of guessed ranges. Once
the scenario start is located but the outline has no explicit playable-opening
bookmark, inspect one smallest text-layer locator window from the scenario
start through its first scene heading. Use it only to identify the first
player-facing situation; background, timeline, motivation, and recent-events
pages may support concepts but are not themselves a playable opening.
On Codex when `coc_opening_source_coordinator_v1=true`, the main KP creates the
empty campaign and dispatches one context-free
`coc-opening-source-coordinator` immediately after source identity and the
user's requested scenario title is accepted as the named target—without main-KP
outline/text verification and before the main KP performs a title crawl,
page render, visual review, locator selection, or concept drafting. The task may
carry zero to four locator candidates; an empty list delegates the cold locator
order above to that same child. After its premise page passes visual review, the
child's first task turn naturally returns one bare spoiler-free
`coc.opening-character-concepts.v1` result and stops; it does not rely on an
in-turn callback. The main KP forwards those concepts and exact-forwards the
result's `continue_task` via `followup_task` to the same idle child. That
source-build follow-up continues without player context. The child—not the main
KP—selects and visually accepts the whole final cold-start opening page set,
normally one or two pages and never more than three. "Sufficient" means the
complete current player-facing beat, not merely its heading or first boxed-text
paragraph: include authored date/time, every NPC materially present in that
beat, the full briefing/commission/pressure, and at least one actionable route
when those elements exist. If a sentence, boxed passage, briefing, or
immediately actionable choice continues across a page boundary, the
continuation page is part of the minimum. An adjacent later encounter, travel
beat, overnight scene, or appendix is not opening evidence merely because it
is contiguous. The child renders the bounded locator candidates in one batch,
extracts the selected text layer in one batch, and visually inspects every
selected page. The main KP immediately continues character work and must not
duplicate the child lane. Locator metadata and text search are not accepted
source evidence by themselves; every selected page still requires the child's
normal visual review and hashes below.

On a host without that capability, the main KP retains the same bounded final
page selection, one-batch rendering/extraction, visual review, and bundle
assembly before using the legacy warm-start path. Do not serialize one render
command and one extraction command per page.

If the current window-equivalent acceptance uses a protocol-isolated player
agent, spawn that one player and deliver the concept choice at this early
boundary before writing the bundle manifest, binding the scenario, or building
the opening skeleton. A human player receives the same concepts directly. This
is only who supplies the player line; it never creates a parallel Keeper.

For a cold campaign start, accepted identity/introduction evidence that already
establishes premise, setting, and investigator fit is an **early player-response
boundary**. If a player is waiting for character concepts, deliver those
source-grounded concepts immediately before assembling or validating the
bundle, binding the scenario, reading a generated briefing, or preparing the
opening pack. Treat that delivery as an intermediate player-visible update,
not the end of the host turn. With the Codex opening coordinator, natural task
completion delivers this boundary to the parent; the main KP forwards it,
starts the exact same-child source-build follow-up, and begins characteristic
rolls, sheet creation, and character confirmation while that document lane
continues. On the fallback path, continue the
remaining source setup until the minimum opening request is dispatched before
switching to character mechanics. The first useful player choice is itself the
milestone; the work behind it must be genuinely concurrent where the host
advertises the coordinator, not merely reordered inside one main-KP turn.

## Two-stage workflow

1. Invoke the chosen host PDF skill (priority above). It owns page rendering,
   visual verification, reading order, tables/images as needed, and optional
   text-layer extraction.
2. Visually verify every selected page against the rendered PDF. Write one
   UTF-8 Markdown file per page plus `manifest.json`. For each page, record the
   host's accepted review state, a realistic confidence (never manufacture
   `1.0`), and exact grep anchors checked during review. Copy every anchor
   directly from the finished page Markdown; never retype, normalize,
   paraphrase, or reconstruct it from the PDF image. After writing the
   manifest, reopen the exact Markdown substring and run the validator below
   before any campaign or bind call. The latency-bounded Codex opening
   coordinator is the sole exception: its `scenario.bind_pdf` performs the
   same deterministic validation before hydration or state mutation, and any
   validation failure terminates that coordinator without retry. In all other
   paths a bind attempt is not the bundle author's first validator. In an installed plugin workspace, resolve the known sibling
   `scripts/coc_pdf_bundle.py` from this skill's plugin root directly; do not
   search the user's workspace for a repository-relative copy.
3. Validate and normalize the bundle:

```bash
uv run --frozen python plugins/coc-keeper/scripts/coc_pdf_bundle.py \
  /absolute/path/to/source-bundle \
  --output /absolute/path/to/normalized-source.json
```

4. Bind the scenario with `scenario.bind_pdf`, passing
   `source_bundle_path`. The operation validates the bundle again before any
   scenario hydration or semantic compilation. Binding also registers every
   selected page in the content-addressed progressive module cache and returns
   `result.source_cache.asset_root_id`; it does **not** by itself activate the
   progressive play path.

For a later on-demand page window from the same PDF, validate it with the same
bundle contract and register only that window. The existing asset root and
unchanged pages are reused by `file_sha256`:

```bash
uv run --frozen python plugins/coc-keeper/scripts/coc_module_assets.py \
  --workspace . register-bundle \
  --source-bundle /absolute/path/to/later-source-bundle
```

Deep/partial entity packs produced from a registered bundle must include exact
`source_page_indices` (or `source_refs` / `source_span`) and should include
the request's `host_work_job_id` plus
`host_timing: {started_at, completed_at, duration_ms, producer}`. The asset
boundary enriches those references from cached page hashes and rejects missing
or drifted evidence. A host-work request with `cached_scope_complete: true`
must be fulfilled from `cached_page_refs` without reopening the PDF.
Mechanics packs additionally carry `mechanics.status=authored`, a normalized
actor/weapon/artifact/tome/gear profile and exact `mechanics.source_refs`; or
`mechanics.status=not_authored` with an accepted visual-review absence receipt.
One mechanics request may return `related_packs` only for subjects listed in
that request's `batch_subjects`. This is the reuse boundary: later attacks,
checks, or item uses consume the durable profile instead of asking the PDF the
same question again.
Runtime actor characteristics are always percentile-scale. For pre-7e modules
whose appendix uses 3–18 values, preserve `source_characteristics`, declare
`source_characteristic_scale: coc_3_18`, and provide a host-reviewed
`normalization_note`; never pass the printed 3–18 number off as a percentile.
Special weapon rules use typed `effects[]` with stable IDs, structured
`applicability`, and either `combat_damage_multiplier` or `keeper_advisory`
resolution. Preserve unsupported prose effects as advisory data rather than
silently pretending the combat engine applied them.
Landing the pack closes that exact host-work request; an idempotent re-put
reuses the original timing receipt instead of manufacturing a new delay.
Structured `mentions[]` inherit the exact source scope of the enclosing pack
or clue. Preserve that scope on the mention/stub so the follow-up host-work
request reads only those cached pages instead of broad-scanning the cache.

## Source bundle schema v1

Directory layout:

```text
source-bundle/
  manifest.json
  pages/0000.md
  pages/0001.md
  assets/...              # optional
```

Minimal manifest:

```json
{
  "schema_version": 1,
  "producer": "codex-pdf-skill",
  "source": {
    "source_id": "pdf:my-module",
    "title": "My Module",
    "path": "/absolute/path/to/my-module.pdf",
    "file_sha256": "<lowercase sha256>",
    "page_count": 120
  },
  "pages": [
    {
      "pdf_index": 0,
      "printed_page": 1,
      "printed_label": "1",
      "markdown_path": "pages/0000.md",
      "text_sha256": "<sha256 of exact Markdown bytes>",
      "review_state": "manual_accepted",
      "parse_confidence": 0.93,
      "grep_anchors": ["an exact phrase visually checked on this page"]
    }
  ],
  "assets": [
    {"path": "assets/map.png", "sha256": "<lowercase sha256>"}
  ]
}
```

`pdf_index` is always explicit and zero-based. `printed_page` and
`printed_label` are optional declarations from the host extraction. Never infer
a printed/PDF offset. Every page and asset path is relative to the bundle and
must stay inside it. The formatter checks producer, schema, source PDF suffix
and hash, page bounds, unique page indices, path containment, UTF-8, non-empty
Markdown, all declared hashes, and host review evidence. A compilable handoff
requires `review_state` to be `manual_accepted` or `auto_accepted`, a numeric
`parse_confidence` from 0 through 1, and a string-list `grep_anchors` (which may
be empty only when there is no reliable textual anchor). The formatter passes
these values through; it never upgrades confidence or acceptance. Every
non-empty grep anchor must occur verbatim in that page's normalized Markdown,
and the formatter rejects the bundle when an anchor is absent.

The formatter computes a canonical `bundle_sha256` from source identity,
selected-page raw hashes and review evidence, and asset hashes. JSON whitespace
and object-key order do not affect it. `scenario.bind_pdf` persists this digest;
hydration rejects any later valid-but-different bundle at the same path.

Formatting is mechanical only: newline normalization, trailing-whitespace
removal, stable page ordering, and deterministic hashes. It never classifies
the meaning of source prose.

## Boundary

The original PDF may be opened only by the external host PDF skill. Repository
code may check that the declared source exists, has a `.pdf` suffix, and
matches its SHA-256 digest. Repository code must not inspect its page tree,
metadata, layout, images, or text.
