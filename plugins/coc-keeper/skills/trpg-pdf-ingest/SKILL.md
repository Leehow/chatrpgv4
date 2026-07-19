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

### Tier 1 — Skeleton (TOC / front matter window)

Host extracts **selected** TOC + keeper-background headings + dramatis personae
titles + resolution/timeline titles (still ≤32 pages per source-bundle window).
Validate with `coc_pdf_bundle.py` if using a formal handoff window, then emit
structured `skeleton.json` (locations, provisional edges, npc_roster names,
handout index, threat stubs, start_candidates). **No full handout bodies.**

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
# host writes entities/location-<start>.json via put_entity API / CLI later

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

## Two-stage workflow

1. Invoke the chosen host PDF skill (priority above). It owns page rendering,
   visual verification, reading order, tables/images as needed, and optional
   text-layer extraction.
2. Visually verify every selected page against the rendered PDF. Write one
   UTF-8 Markdown file per page plus `manifest.json`. For each page, record the
   host's accepted review state, a realistic confidence (never manufacture
   `1.0`), and exact grep anchors checked during review.
3. Validate and normalize the bundle:

```bash
uv run --frozen python plugins/coc-keeper/scripts/coc_pdf_bundle.py \
  /absolute/path/to/source-bundle \
  --output /absolute/path/to/normalized-source.json
```

4. Bind the scenario with `scenario.bind_pdf`, passing
   `source_bundle_path`. The operation validates the bundle again before any
   scenario hydration or semantic compilation.

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
