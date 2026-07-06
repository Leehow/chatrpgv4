---
name: trpg-pdf-ingest
description: Parse TRPG rulebook PDFs (especially 2-column layouts like Call of Cthulhu Keeper Rulebook) into structured data using pymupdf4llm. Use when extracting rules data from a PDF rulebook, verifying data against the source PDF, or doing OCR cross-verification. Handles the 2-column reading-order problem with pymupdf4llm (0.4s/page, correct column order, Markdown table output). Also provides bbox overlay visualization and quality scoring for manual inspection. MinerU is available as a slow fallback for scanned pages only. Use when the user says "解析 PDF / 核对规则书 / 双栏排版 / OCR 交叉验证 / extract from rulebook".
---

# TRPG PDF Ingest — fast pymupdf4llm extraction with quality scoring

Solves the 2-column reading-order problem for TRPG rulebook PDFs.
**pymupdf4llm** is the primary parser — it's fast (0.4s/page vs MinerU's
10s/page), correctly reconstructs 2-column reading order, and outputs
Markdown tables for structured data (weapon tables, stat blocks).

MinerU is kept as an optional fallback for scanned/image-heavy pages only.

## Why pymupdf4llm is the default

Benchmarked on the CoC 40th Anniversary rulebook:

| Metric | pymupdf4llm | MinerU |
|---|---|---|
| Speed | **0.4s/page** | 10s/page |
| 2-column order | ✅ correct | ✅ correct |
| Weapon table (Table XVII) | ✅ **Markdown table** | HTML `<table>` |
| Monster stat block | inline text (regex-parsable) | HTML `<table>` |
| Prose readability | ✅ clean Markdown | clean Markdown |
| Scanned pages | ❌ needs OCR fallback | ✅ built-in OCR |
| Dependencies | pip install (lightweight) | GPU models (~2GB) |

For 465-page rulebook: pymupdf4llm = ~3 min, MinerU = ~80 min.

## Parser selection

| Page type | Parser | Why |
|---|---|---|
| All text pages (prose + tables) | **pymupdf4llm** | Fast, correct order, Markdown tables |
| Scanned/image pages only | **MinerU** | Built-in OCR (rare for digital rulebooks) |

## Workflow

```
probe_pdf.py  →  detect columns/tables/scan
       ↓
parse_pymupdf4llm.py  →  markdown output (default for all pages)
       ↓ (optional, for scanned pages only)
parse_mineru.sh  →  OCR fallback
       ↓
score_parse_quality.py  →  6-metric quality score
       ↓ (optional)
render_overlay.py  →  bbox visualization
```

## Scripts

### probe_pdf.py
```bash
python3 .../probe_pdf.py pdf/<book>.pdf [--start S] [--end E]
```
Detects: page count, column layout (1/2/mixed), scanned pages, table-heavy
pages. Outputs JSON with parser recommendation per page.

### parse_pymupdf4llm.py (primary)
```bash
python3 .../parse_pymupdf4llm.py pdf/<book>.pdf --pages 294-296 -o output.md
```
Fast parser (0.4s/page). Produces Markdown with reading-order reconstruction.
Weapon tables become Markdown pipe tables. Stat blocks become inline text
(regex-parsable: `STR 90 (5D6 ×5) CON 50...`).

### parse_mineru.sh (fallback, scanned pages only)
```bash
bash .../parse_mineru.sh pdf/<book>.pdf --slug monsters-ch14 --pages 287-348
```
MinerU wrapper with OCR caching. Only use for scanned/image pages where
pymupdf4llm fails. ~10x slower.

### score_parse_quality.py
```bash
python3 .../score_parse_quality.py --pdf pdf/<book>.pdf --page 294
```
Scores 6 dimensions: reading order, table structure, sidebar isolation,
header/footer removal, bbox coverage, entity continuity.

### render_overlay.py
```bash
python3 .../render_overlay.py --pdf pdf/<book>.pdf --page 294 -o overlay.png
```
Draws bbox boxes on the PDF page using pdfplumber. For manual inspection.

## Extracting data from pymupdf4llm output

 pymupdf4llm outputs two formats depending on content:

**Tables** (weapon tables, equipment lists) → Markdown pipe tables:
```markdown
|Name|Skill|Damage|Base Range|...|
|---|---|---|---|---|
|Bow and Arrows|Firearms (Bow)|1D6+half DB|30 yards|...|
```
Parse with standard Markdown table parsers.

**Stat blocks** (monster attributes) → inline text:
```
STR 90 (5D6 ×5) CON 50 (3D6 ×5) SIZ 90 (5D6 ×5) ...
```
Parse with regex: `re.findall(r'(STR|CON|SIZ|...)\s+(\d+)', text)`

## Integration with existing verify scripts

The `scripts/verify_*_ocr.py` family reads from `checks/ocr-cached/`.
Use `parse_pymupdf4llm.py -o checks/ocr-cached/<slug>.md` to write directly
to the cache, then run verify scripts as usual.

For migrating existing MinerU-cached data to pymupdf4llm:
```bash
python3 .../parse_pymupdf4llm.py pdf/<book>.pdf --pages 287-348 -o checks/ocr-cached/monsters-ch14-py4llm.md
```

## Dependencies

- **pymupdf4llm**: `pip install pymupdf4llm` (PyMuPDF + layout engine, lightweight)
- **pdfplumber**: `pip install pdfplumber` (for overlay, already installed)
- **MinerU**: only if you need OCR fallback for scanned pages
