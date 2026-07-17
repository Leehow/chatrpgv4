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
| Node adapter dependencies | `runtime/adapters/pi/package.json`<br>`runtime/adapters/narrator/package.json` | npm packages, including `@earendil-works/pi-coding-agent` | Installed from npm; dependency code is not vendored | DOCUMENTED | Runtime adapters carry lockfiles whose dependency records include upstream license metadata; dependency code is not committed. |
| Python test dependency | `.github/workflows/tests.yml`<br>`README.md` | PyPI package `pytest` | Installed from PyPI for CI and local development; package code is not vendored | UNVERIFIED | Test-only dependency. Upstream license terms are not copied or independently inventoried in this repository. |

The project source code and documentation are covered by the repository
`LICENSE` (Apache License 2.0), subject to the asset-specific evidence and
unresolved items above. Trademarks and third-party names remain the property of
their respective owners.

User-supplied PDFs and the external host skill's extracted source bundles are
local inputs, not repository content. The repository has no PDF parser, OCR
fallback, or vendored PDF extraction dependency.
