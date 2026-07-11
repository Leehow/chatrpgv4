# Source Evidence Bridge v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PDF extraction, page identity, parse quality, and critical source use content-addressed, auditable, and deterministic.

**Architecture:** Keep `pdf_cache.extract_markdown()` as the extraction entry point. Add `coc_pdf_source.py` as the source-bundle boundary, scaffold its index files from `coc_scenario.py`, and let `coc_scenario_compile.py` validate opted-in source refs and critical confidence without requiring live PDF access.

**Tech Stack:** Python 3.11, stdlib hashing/JSON/pathlib, existing `pymupdf4llm` adapter, pytest, existing atomic JSON writer.

## Global Constraints

- No new runtime dependency.
- Legacy cache entries and scenarios remain readable.
- Existing real PDFs invalidate stale cache by content hash and pipeline version.
- Printed-page and PDF-index identities are never guessed once a source has a page map.
- Local evidence text is never copied into module-library artifacts.
- Critical source threshold defaults to `0.80`.

---

### Task 1: Cache metadata v2 and invalidation

**Files:**
- Modify: `plugins/coc-keeper/skills/trpg-pdf-ingest/scripts/pdf_cache.py`
- Modify: `tests/test_pdf_cache.py`

**Interfaces:**
- Produces `sha256_file(path) -> str | None`.
- Produces `read_cache_meta(md_path) -> dict`.
- Extends `extract_markdown(..., pipeline_version=2, backend_version=None)`.

- [ ] **Step 1: Write failing tests**

```python
def test_meta_v2_records_file_and_text_hash(tmp_path, monkeypatch):
    pdf = tmp_path / "book.pdf"
    pdf.write_bytes(b"first")
    monkeypatch.setattr(pdf_cache, "_parse_with_pymupdf4llm", lambda *a, **k: "# text")
    result = pdf_cache.extract_markdown(pdf, [0], use_ocr=False, cache_root=tmp_path / "cache")
    meta = json.loads(Path(result["cache_path"]).with_suffix(".meta.json").read_text())
    assert meta["schema_version"] == 2
    assert len(meta["file_sha256"]) == 64
    assert len(meta["text_sha256"]) == 64
    assert meta["pipeline_version"] == 2


def test_changed_pdf_hash_forces_reparse(tmp_path, monkeypatch):
    pdf = tmp_path / "book.pdf"
    pdf.write_bytes(b"first")
    calls = {"n": 0}
    def parse(*args, **kwargs):
        calls["n"] += 1
        return f"parse-{calls['n']}"
    monkeypatch.setattr(pdf_cache, "_parse_with_pymupdf4llm", parse)
    pdf_cache.extract_markdown(pdf, [0], use_ocr=False, cache_root=tmp_path / "cache")
    pdf.write_bytes(b"second")
    result = pdf_cache.extract_markdown(pdf, [0], use_ocr=False, cache_root=tmp_path / "cache")
    assert result["cached"] is False
    assert calls["n"] == 2


def test_pipeline_version_change_forces_reparse(tmp_path, monkeypatch): ...
def test_missing_synthetic_pdf_keeps_legacy_cache_hit(tmp_path): ...
def test_external_source_hash_change_forces_reingest(tmp_path): ...
```

- [ ] **Step 2: Run RED**

```bash
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_pdf_cache.py -q -p no:cacheprovider
```

Expected: new metadata and invalidation assertions fail.

- [ ] **Step 3: Implement minimal metadata v2**

```python
PIPELINE_VERSION = 2

def sha256_file(path: str | Path) -> str | None:
    source = Path(path)
    if not source.is_file():
        return None
    digest = hashlib.sha256()
    with source.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
```

Cache validity compares source hash when available, backend, pipeline version, and optional external text hash. Write `text_sha256` from the emitted markdown.

- [ ] **Step 4: Run GREEN**

Run Task 1 tests. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/coc-keeper/skills/trpg-pdf-ingest/scripts/pdf_cache.py tests/test_pdf_cache.py
git commit -m "feat(pdf): add content-aware cache metadata"
```

---

### Task 2: Source bundle module

**Files:**
- Create: `plugins/coc-keeper/scripts/coc_pdf_source.py`
- Create: `tests/test_pdf_source.py`

**Interfaces:**
- `initialize_source_indexes(campaign_dir, scenario_id, sources=None) -> dict`
- `normalize_source_ref(ref, page_map) -> dict`
- `resolve_locator(ref, page_map) -> dict | None`
- `effective_source_confidence(ref, parse_manifest, evidence_segments) -> float | None`
- `critical_source_allowed(refs, parse_manifest, evidence_segments, threshold=0.8) -> dict`
- `load_source_bundle(campaign_dir) -> dict`
- `write_source_bundle(campaign_dir, page_map, parse_manifest, evidence_segments) -> None`
- `strip_local_evidence_text(bundle) -> dict`

- [ ] **Step 1: Write failing tests**

```python
def test_initialize_source_indexes_writes_three_files(tmp_path): ...
def test_printed_page_resolves_to_pdf_index(): ...
def test_pdf_index_resolves_to_printed_page(): ...
def test_ambiguous_legacy_page_is_normalized_from_page_kind(): ...
def test_missing_mapping_returns_none(): ...
def test_critical_source_gate_accepts_reviewed_high_confidence(): ...
def test_critical_source_gate_rejects_needs_review(): ...
def test_anchor_must_exist_in_matching_segment(): ...
def test_strip_local_evidence_text_removes_text_only(): ...
```

Canonical acceptance assertion:

```python
result = coc_pdf_source.critical_source_allowed(
    [{"source_id": "pdf:x", "printed_page": 12, "grep_anchor": "Corbitt"}],
    manifest,
    segments,
    page_map=page_map,
)
assert result == {"allowed": True, "confidence": 0.91, "findings": []}
```

- [ ] **Step 2: Run RED**

```bash
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_pdf_source.py -q -p no:cacheprovider
```

Expected: module import fails.

- [ ] **Step 3: Implement source bundle**

Use only structured IDs and locators. JSON writes use `coc_fileio.write_json_atomic`; JSONL writes are newline-delimited UTF-8. Review states are exactly:

```python
VALID_REVIEW_STATES = frozenset({
    "auto_accepted", "manual_accepted", "needs_review", "rejected"
})
```

- [ ] **Step 4: Run GREEN**

Run Task 2 tests. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/coc-keeper/scripts/coc_pdf_source.py tests/test_pdf_source.py
git commit -m "feat(source): add page map and evidence bundle"
```

---

### Task 3: Scenario skeleton and source registration

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_scenario.py`
- Modify: `tests/test_scenario.py`

**Interfaces:**
- `create_scenario_skeleton` initializes source indexes.
- `catalog_pdfs` adds `file_sha256` and stable `source_id`.

- [ ] **Step 1: Write failing tests**

```python
def test_create_scenario_skeleton_initializes_source_evidence_indexes(tmp_path):
    campaign = tmp_path / "campaign"
    coc_scenario.create_scenario_skeleton(
        campaign, "scenario-x", "Scenario X",
        {"source_id": "pdf:x", "path": "pdf/x.pdf"},
    )
    assert (campaign / "index" / "page-map.json").exists()
    assert (campaign / "index" / "parse-manifest.json").exists()
    assert (campaign / "index" / "evidence-segments.jsonl").exists()


def test_catalog_pdfs_records_hash_and_source_id(tmp_path): ...
```

- [ ] **Step 2: Run RED**

```bash
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_scenario.py -q -p no:cacheprovider
```

Expected: index files and hash fields absent.

- [ ] **Step 3: Integrate `coc_pdf_source`**

Import the sibling module and call `initialize_source_indexes` after `source-map.json` creation. Preserve all existing scaffold files and return shape.

- [ ] **Step 4: Run GREEN**

Run Task 3 tests. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/coc-keeper/scripts/coc_scenario.py tests/test_scenario.py
git commit -m "feat(scenario): scaffold source evidence indexes"
```

---

### Task 4: Compiler source-confidence validation

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_scenario_compile.py`
- Create: `tests/test_source_evidence_compile.py`

**Interfaces:**
- `validate_compiled_scenario(..., source_bundle=None, strict_sources=False)`.
- `validate_scenario` automatically loads the campaign index when present.
- Findings: `unresolved_source_locator`, `low_source_confidence`, `source_needs_review`, `missing_source_anchor`, `stale_source_hash`.

- [ ] **Step 1: Write failing tests**

```python
def test_opted_in_critical_question_requires_resolved_page_map(tmp_path): ...
def test_low_confidence_critical_question_errors(tmp_path): ...
def test_manual_accepted_critical_source_passes(tmp_path): ...
def test_noncritical_low_confidence_source_warns(tmp_path): ...
def test_legacy_scenario_without_bundle_remains_valid(tmp_path): ...
def test_strict_sources_requires_bundle_for_source_refs(tmp_path): ...
```

- [ ] **Step 2: Run RED**

```bash
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_source_evidence_compile.py -q -p no:cacheprovider
```

Expected: new argument/findings absent.

- [ ] **Step 3: Implement validation adapter**

Load the source module lazily so compiler doctor remains stdlib-oriented. For critical epistemic questions and reframe contracts, source-gate failures are errors; for ordinary nodes they are warnings. Do not read the PDF itself.

- [ ] **Step 4: Run GREEN**

Run Task 4 tests. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/coc-keeper/scripts/coc_scenario_compile.py tests/test_source_evidence_compile.py
git commit -m "feat(compiler): gate critical nodes on source confidence"
```

---

### Task 5: Source-resolution request and documentation

**Files:**
- Create: `plugins/coc-keeper/scripts/coc_source_resolution.py`
- Create: `tests/test_source_resolution.py`
- Modify: `plugins/coc-keeper/skills/trpg-pdf-ingest/SKILL.md`
- Modify: `plugins/coc-keeper/skills/coc-scenario-import/SKILL.md`
- Modify: `plugins/coc-keeper/skills/coc-scenario-import/references/compile-protocol.md`

**Interfaces:**
- `build_source_resolution_request(node_id, reason, source_refs, allowed_outputs=None) -> dict`.
- Request allows only `player_safe_summary`, `delivery_kind`, `source_refs`, and confidence repair unless explicitly extended.

- [ ] **Step 1: Write failing tests**

```python
def test_source_resolution_request_is_minimum_privilege(): ...
def test_source_resolution_request_rejects_raw_keeper_prose_output(): ...
```

- [ ] **Step 2: Run RED**

```bash
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_source_resolution.py -q -p no:cacheprovider
```

- [ ] **Step 3: Implement and document**

Document the four allowed runtime lookup cases: low-confidence critical reveal, failed source anchor, player-safe handout extraction, and non-truth atmospheric detail.

- [ ] **Step 4: Run focused and full suites**

```bash
PYTHONDONTWRITEBYTECODE=1 python -m pytest \
  tests/test_pdf_cache.py tests/test_pdf_source.py tests/test_scenario.py \
  tests/test_source_evidence_compile.py tests/test_source_resolution.py \
  -q -p no:cacheprovider
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/ -q -p no:cacheprovider
```

Expected: zero failures.

- [ ] **Step 5: Commit**

```bash
git add plugins/coc-keeper tests/test_source_resolution.py
git commit -m "docs(source): complete evidence bridge contract"
```

## Self-review

- Every source-evidence requirement in the completion spec maps to a task.
- No task requires the live Director to parse PDF prose.
- Cache compatibility and strict opt-in behavior are explicit.
- All public function names are consistent across tasks.