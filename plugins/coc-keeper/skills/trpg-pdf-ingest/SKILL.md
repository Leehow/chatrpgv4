---
name: trpg-pdf-ingest
description: Prepare TRPG PDF source evidence by using Codex's pdf skill, then validate and deterministically reformat the host-produced bundle for the COC scenario compiler.
---

# TRPG PDF source handoff

This repository does not parse PDFs. It has no OCR, layout, table, rendering,
or PDF text-extraction backend. Use the Codex `pdf` skill to inspect and extract
the source, then hand its output to the repository formatter. A non-Codex host
must supply the same bundle contract; it must not fall back to a local parser.

## Two-stage workflow

1. Invoke the Codex `pdf` skill. It owns PDF rendering, OCR, reading order,
   tables, images, and visual verification.
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

The original PDF may be opened only by the host `pdf` skill. Repository code
may check that the declared source exists, has a `.pdf` suffix, and matches its
SHA-256 digest. Repository code must not inspect its page tree, metadata,
layout, images, or text.
