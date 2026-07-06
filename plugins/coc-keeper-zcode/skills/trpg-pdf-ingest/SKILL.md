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
├── probe_pdf.py           # detect columns/tables/scan per page
├── parse_pymupdf4llm.py   # main parser → markdown
├── score_parse_quality.py # 6-metric quality score per page
└── render_overlay.py      # bbox visualization (pdfplumber)
```

### probe_pdf.py
```bash
python3 .../probe_pdf.py pdf/<book>.pdf [--start S] [--end E]
```
Detects: page count, column layout (1/2/mixed), scanned pages, table-heavy
pages. Outputs JSON with per-page metadata.

### parse_pymupdf4llm.py (main parser)
```bash
python3 .../parse_pymupdf4llm.py pdf/<book>.pdf --pages 294-296 -o output.md
```
Produces Markdown with reading-order reconstruction. Tables become Markdown
pipe tables; stat blocks become inline text.

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

Write output directly to the OCR cache:
```bash
python3 .../parse_pymupdf4llm.py pdf/<book>.pdf --pages 287-348 \
    -o checks/ocr-cached/monsters-ch14.md
```
Then run existing `scripts/verify_*_ocr.py` scripts as usual.

## Dependencies

- `pip install pymupdf4llm` — the parser (installs PyMuPDF + layout engine)
- `pip install pdfplumber` — for overlay visualization (optional)
- No GPU, no OCR models, no heavy downloads
