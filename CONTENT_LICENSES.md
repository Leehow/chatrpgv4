# Content and Dependency Inventory

This inventory records the distribution evidence visible in this repository. It
is not a legal opinion. `DOCUMENTED` means the repository contains an explicit
notice or the item is fetched rather than vendored; `UNVERIFIED` means the tree
does not contain enough evidence for a stable-release rights conclusion; and
`EXCLUDED` means generated content is intentionally absent from current HEAD.

| Asset group | Repository path | Source | Distribution basis | Status | Notes |
|---|---|---|---|---|---|
| The White War starter | `plugins/coc-keeper/references/starter-scenarios/the-white-war/` | Cthulhu Reborn OGL package | Bundled OGL and Section 15 notice | DOCUMENTED | No source PDF included. |
| The Haunting starter | `plugins/coc-keeper/references/starter-scenarios/the-haunting/` | Original derivative pack inspired by classic structure | Repository attribution only | UNVERIFIED | Requires external rights review before stable release. |
| Structured rule JSON | `plugins/coc-keeper/references/rules-json/` | Project-authored structured tables; `metadata.json` identifies local Keeper Rulebook PDF summaries, with asset-specific source notes where present | Repository Apache-2.0 claim plus asset-specific notices | UNVERIFIED | Underlying rights for rulebook-derived summaries are not independently documented; no rulebook PDF is included. |
| Plugin logos and images | `plugins/coc-keeper/assets/*.png` | Repository contributor artwork; provenance is not recorded in the tree | Repository Apache-2.0 claim only | UNVERIFIED | External provenance or contributor confirmation is required before stable release. |
| Generated OCR extracts | `checks/ocr-cached/` | Locally generated from a user-supplied Keeper Rulebook PDF | Excluded from current HEAD and ignored | EXCLUDED | Local regeneration only. Historical blobs remain because this initiative does not rewrite Git history. |
| Generated Py4LLM extracts | `checks/py4llm-cached/` | Locally generated from a user-supplied Keeper Rulebook PDF | Excluded from current HEAD and ignored | EXCLUDED | Local regeneration only. Historical blobs remain because this initiative does not rewrite Git history. |
| Node adapter dependencies | `runtime/adapters/pi/package.json`<br>`runtime/adapters/player/package.json`<br>`runtime/adapters/narrator/package.json` | npm packages, including `@earendil-works/pi-coding-agent` | Installed from npm; dependency code is not vendored | DOCUMENTED | `pi` and `player` currently have lockfiles whose dependency records carry upstream license metadata; CI runs `npm ci` for every adapter lockfile present. |
| Python test dependency | `.github/workflows/tests.yml`<br>`README.md` | PyPI package `pytest` | Installed from PyPI for CI and local development; package code is not vendored | UNVERIFIED | Test-only dependency. Upstream license terms are not copied or independently inventoried in this repository. |
| Python runtime PDF dependency | `plugins/coc-keeper/scripts/coc_scenario.py`<br>`.github/workflows/tests.yml`<br>`README.md` | PyPI package `pypdf` | Imported by the shipped scenario PDF cataloger and installed from PyPI; package code is not vendored | UNVERIFIED | Runtime and test dependency, not test-only. Upstream license terms are not copied or independently inventoried in this repository. |
| PDF-ingest parser dependency | `plugins/coc-keeper/skills/trpg-pdf-ingest/SKILL.md`<br>`plugins/coc-keeper/skills/trpg-pdf-ingest/scripts/pdf_cache.py`<br>`plugins/coc-keeper/skills/trpg-pdf-ingest/scripts/probe_pdf.py` | PyPI package `pymupdf4llm`, including its PyMuPDF dependency exposed as `fitz` | Installed by users who invoke the shipped PDF-ingest skill; package code is not vendored | UNVERIFIED | `pdf_cache.py` dynamically loads the default parser and `probe_pdf.py` imports PyMuPDF directly. Upstream license terms are not independently inventoried here. |
| Optional PDF-ingest overlay dependency | `plugins/coc-keeper/skills/trpg-pdf-ingest/SKILL.md`<br>`plugins/coc-keeper/skills/trpg-pdf-ingest/scripts/render_overlay.py`<br>`plugins/coc-keeper/skills/trpg-pdf-ingest/scripts/score_parse_quality.py` | PyPI package `pdfplumber` | Optional user-installed dependency for overlay and parse-quality inspection; package code is not vendored | UNVERIFIED | Not required for ordinary play. Upstream license terms are not copied or independently inventoried in this repository. |

The project source code and documentation are covered by the repository
`LICENSE` (Apache License 2.0), subject to the asset-specific evidence and
unresolved items above. Trademarks and third-party names remain the property of
their respective owners.
