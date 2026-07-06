---
name: trpg-pdf-ingest
description: Parse TRPG rulebook PDFs (especially 2-column layouts like Call of Cthulhu Keeper Rulebook) into structured data using a multi-parser approach. Use when extracting rules data from a PDF rulebook, verifying data against the source PDF, doing OCR cross-verification, or comparing parser outputs. Handles the notorious 2-column reading-order problem by running pymupdf4llm (fast, good for prose) and MinerU (accurate, good for tables/stat blocks) side by side, then scoring which output is better for each page type. Also provides bbox overlay visualization for manual inspection of layout detection. Use when the user says "解析 PDF / 核对规则书 / 双栏排版 / parser 对比 / OCR 交叉验证 / extract from rulebook".
---

# TRPG PDF Ingest — multi-parser extraction with quality scoring

Solves the 2-column reading-order problem that plagues PDF text extraction
from TRPG rulebooks. Instead of trusting a single parser, this skill runs
**pymupdf4llm** (fast, built on PyMuPDF) and **MinerU** (layout-aware, with
table reconstruction) on the same pages, compares outputs, and scores which
parser wins for each page type.

## When to use which parser

| Page type | Primary | Why |
|---|---|---|
| Prose (single/double column text) | **pymupdf4llm** | Fast (seconds), good reading order |
| Tables (weapon tables, stat blocks) | **MinerU** | HTML table reconstruction, structure preserved |
| Mixed (stat block + description) | **Both + compare** | Compare to catch errors |
| Scanned/image pages | **MinerU** | Built-in OCR fallback |
| Quick spot-check (1-2 pages) | **pymupdf4llm** | Instant results |

## Workflow

```
probe_pdf.py  →  detect columns/tables/scan
       ↓
parse_pymupdf4llm.py  +  parse_mineru.sh  →  dual output
       ↓
compare_parsers.py  →  diff + agreement score
       ↓
score_parse_quality.py  →  6-metric quality score
       ↓
render_overlay.py  →  bbox visualization (if needed)
```

## Scripts

All scripts live in `scripts/` under this skill directory. They are
designed to be run from the project root.

### probe_pdf.py
```bash
python3 plugins/coc-keeper-zcode/skills/trpg-pdf-ingest/scripts/probe_pdf.py pdf/<book>.pdf
```
Detects: page count, column layout (1/2/mixed), scanned pages, table-heavy
pages. Outputs JSON with per-page metadata + a parser recommendation matrix.

### parse_pymupdf4llm.py
```bash
python3 .../parse_pymupdf4llm.py pdf/<book>.pdf --pages 294-296 -o output.md
```
Fast parser. Produces markdown with reading-order reconstruction. Best for
prose pages. Stat blocks become inline text (not tables).

### parse_mineru.sh
```bash
bash .../parse_mineru.sh pdf/<book>.pdf --slug monsters-ch14 --pages 287-348
```
Thin wrapper over the MinerU skill. Caches output to `checks/ocr-cached/`.
Best for table-heavy pages and complex layouts.

### compare_parsers.py
```bash
python3 .../compare_parsers.py --pymupdf4llm output.md --mineru checks/ocr-cached/<slug>.md
```
Diffs the two outputs line-by-line. Reports agreement percentage, table row
counts, and key discrepancies (numbers that differ, missing stat blocks).

### score_parse_quality.py
```bash
python3 .../score_parse_quality.py --pdf pdf/<book>.pdf --page 294 --output checks/quality/
```
Scores 6 dimensions: reading order, table structure, sidebar isolation,
header/footer removal, bbox coverage, entity continuity.

### render_overlay.py
```bash
python3 .../render_overlay.py --pdf pdf/<book>.pdf --page 294 -o overlay.png
```
Draws bbox boxes on the PDF page using pdfplumber. Red = tables, blue =
text blocks, green = images. For manual inspection of layout detection.

## Integration with existing verify scripts

The `scripts/verify_*_ocr.py` family reads from `checks/ocr-cached/`. This
skill's `parse_mineru.sh` writes to that same directory, so verified data
flows seamlessly into the existing verification pipeline.

For dual-parser confirmation, run `compare_parsers.py` to check that both
pymupdf4llm and MinerU agree on key values (stat numbers, weapon damage,
spell costs) before trusting the data.

## Dependencies

- **pymupdf4llm**: `pip install pymupdf4llm` (installs PyMuPDF + layout engine)
- **MinerU**: via the mineru skill at `~/.zcode/cli/plugins/local/mineru/`
- **pdfplumber**: already installed (`pip install pdfplumber`)
- No GPU required (MinerU uses MPS on Apple Silicon)

## Key facts

- pymupdf4llm is ~10x faster than MinerU (seconds vs ~10s/page)
- MinerU produces HTML `<table>` output (better for structured extraction);
  pymupdf4llm produces inline text (better for prose readability)
- Both correctly reconstruct 2-column reading order for the CoC rulebook
- The 2-column problem is NOT solved by any single parser perfectly —
  comparison + scoring is the reliable approach (OmniDocBench CVPR 2025)
