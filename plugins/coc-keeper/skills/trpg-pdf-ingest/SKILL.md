---
name: trpg-pdf-ingest
description: Parse TRPG rulebook PDFs (especially 2-column layouts like Call of Cthulhu Keeper Rulebook) into structured data using pymupdf4llm. Use when extracting rules data from a PDF rulebook, verifying data against the source PDF, or checking parse quality. Handles the 2-column reading-order problem with pymupdf4llm (0.4s/page, correct column order, Markdown table output). Also provides bbox overlay visualization and quality scoring. Use when the user says "解析 PDF / 核对规则书 / 双栏排版 / extract from rulebook".
---

# TRPG PDF Ingest — fast PDF extraction with pymupdf4llm

Solves the 2-column reading-order problem for TRPG rulebook PDFs.
Uses **pymupdf4llm** — a lightweight pip-installable parser that correctly
reconstructs 2-column reading order and outputs Markdown tables.

## Why pymupdf4llm

- **0.4s/page** (465-page rulebook in ~3 minutes)
- Correct 2-column reading order (left column finishes before right starts)
- Weapon tables → clean Markdown pipe tables (directly parseable)
- Monster stat blocks → inline text with correct values (`STR 90 (5D6 ×5)`)
- One dependency: `pip install pymupdf4llm` (no GPU, no models, no OCR engine)

## Scripts

```
trpg-pdf-ingest/scripts/
├── pdf_cache.py           # unified entry: extract_markdown() + page-level cache
├── probe_pdf.py           # detect columns/tables/scan per page
├── parse_pymupdf4llm.py   # CLI wrapper around pdf_cache.extract_markdown()
├── score_parse_quality.py # 6-metric quality score per page
└── render_overlay.py      # bbox visualization (pdfplumber)
```

All parsing flows through `pdf_cache.extract_markdown()` — never call
pymupdf4llm (or any backend) directly from other scripts.

### probe_pdf.py
```bash
python3 .../probe_pdf.py pdf/<book>.pdf [--start S] [--end E]
```
Detects: page count, column layout (1/2/mixed), scanned pages, table-heavy
pages. Outputs JSON with per-page metadata.

### parse_pymupdf4llm.py (main parser)
```bash
# default (pymupdf4llm, cached, smart OCR)
python3 .../parse_pymupdf4llm.py pdf/<book>.pdf --pages 294-296 -o output.md
```
Produces Markdown with reading-order reconstruction. Tables become Markdown
pipe tables; stat blocks become inline text. All output is cached: the first
run parses (~0.4s/page), every subsequent run for the same pages is a free
cache hit.

OCR control:
- **Default = smart inference** — OCR runs only on pages the probe flags as
  scanned (extractable text < 50 chars). This avoids Tesseract noise from
  decorative images on text pages.
- `--ocr` — force OCR on (every page goes through Tesseract).
- `--no-ocr` — force OCR off (text extraction only, never Tesseract).

Other flags:
- `--backend external --src path/to/parsed.md` — ingest externally-parsed
  markdown (see [Backends](#backends)).
- `--no-cache` — ignore the cache, re-parse and overwrite.
- `--cache-root <dir>` — override the cache root (default `.coc/pdf-cache`).
- `--json` — write a `<output>.json` sidecar with `cached`, `cache_path`,
  `backend`, `use_ocr`, `char_count`.

### score_parse_quality.py
```bash
python3 .../score_parse_quality.py --pdf pdf/<book>.pdf --page 294
```
Scores 6 dimensions: reading order, table structure, sidebar isolation,
header/footer detection, bbox coverage, entity continuity.

### render_overlay.py
```bash
python3 .../render_overlay.py --pdf pdf/<book>.pdf --page 294 -o overlay.png
```
Draws bbox boxes on the PDF page using pdfplumber. For manual inspection.

## Extracting data from pymupdf4llm output

**Tables** (weapon tables, equipment lists) → Markdown pipe tables:
```markdown
|Name|Skill|Damage|Base Range|...|
|---|---|---|---|---|
|Bow and Arrows|Firearms (Bow)|1D6+half DB|30 yards|...|
```

**Stat blocks** (monster attributes) → inline text:
```
STR 90 (5D6 ×5) CON 50 (3D6 ×5) SIZ 90 (5D6 ×5) DEX 70 ...
```
Parse with regex: `re.findall(r'(STR|CON|SIZ|...)\s+(\d+)', text)`

## Integration with verify scripts

Write output to the verify cache (independent of the pdf-cache):
```bash
python3 .../parse_pymupdf4llm.py pdf/<book>.pdf --pages 287-348 \
    -o checks/ocr-cached/monsters-ch14.md
```
Then run existing `scripts/verify_*_ocr.py` scripts as usual. The pdf-cache
under `.coc/pdf-cache` makes repeated parses of the same pages free, so
re-running a verify script that re-parses is no longer slow.

## Caching

Every parse goes through `pdf_cache.extract_markdown()`, which caches results
under `.coc/pdf-cache/<pdf-slug>/pages-<spec>.md` (plus a `.meta.json`
provenance sidecar). Repeated calls for the same page range are a **cache
hit** — no re-parse, no OCR, ~instant.

Cache layout:
```
.coc/pdf-cache/
└── call-of-cthulhu-keeper-rulebook-.../
    ├── pages-294.md            # single page
    ├── pages-294.md.meta.json  # backend, use_ocr, char_count, parsed_at
    ├── pages-294-296.md        # contiguous range (start-end inclusive)
    └── pages-294_296_301.md    # non-contiguous set (underscore-joined)
```

The cache key is `<pdf-slug>/pages-<spec>` where `<pdf-slug>` is the lowercased
PDF basename with non-alphanumerics collapsed to dashes, and `<spec>` encodes
the page set. Cache hits are reported on stderr: `[cache HIT] <path>`.

To force a re-parse (e.g. after a pymupdf4llm upgrade), pass `--no-cache` or
just delete the relevant `.md` + `.meta.json` pair.

## Backends

pymupdf4llm is the default backend, but the cache accepts externally-parsed
markdown too. This lets you swap in a higher-quality parser (MinerU, cloud
OCR, manual cleanup) for tricky pages without changing any downstream code.

```bash
# default (pymupdf4llm, cached, smart OCR)
python3 .../parse_pymupdf4llm.py pdf/<book>.pdf --pages 294-296

# ingest an externally-parsed markdown (MinerU/cloud/manual) into cache
python3 .../parse_pymupdf4llm.py pdf/<book>.pdf --pages 294-296 \
    --backend external --src path/to/parsed.md

# force re-parse, ignore cache
python3 .../parse_pymupdf4llm.py pdf/<book>.pdf --pages 294-296 --no-cache
```

Once ingested (either backend), the markdown is served identically from the
cache on every subsequent call — downstream consumers don't know or care
which backend produced it.

## Programmatic use

Other scripts (verify scripts, director module compilation, scenario import)
should call `pdf_cache.extract_markdown()` directly rather than shelling out
to the CLI. It returns a dict with the markdown plus cache provenance:

```python
import importlib.util
from pathlib import Path

SCRIPT_DIR = Path("plugins/coc-keeper/skills/trpg-pdf-ingest/scripts")
spec = importlib.util.spec_from_file_location(
    "pdf_cache", SCRIPT_DIR / "pdf_cache.py")
pdf_cache = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pdf_cache)

result = pdf_cache.extract_markdown("pdf/<book>.pdf", [294, 295, 296])
md = result["markdown"]        # the extracted markdown
cached = result["cached"]      # True if served from cache
pages = result["pages"]        # normalized [294, 295, 296]
cache_path = result["cache_path"]  # .coc/pdf-cache/<slug>/pages-294-296.md
```

`pdf_cache` is a plain module (no package), so load it via `importlib` from
its absolute path as shown. `use_ocr=None` (the default) means smart
inference; pass `True`/`False` to force.

## Dependencies

- `pip install pymupdf4llm` — the parser (installs PyMuPDF + layout engine)
- `pip install pdfplumber` — for overlay visualization (optional)
- No GPU, no OCR models, no heavy downloads
