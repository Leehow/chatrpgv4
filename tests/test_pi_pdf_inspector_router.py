"""Contract tests for the deployed pi-coc Firecrawl pdf-inspector router.

The router lives outside the repository at $HOME/.pi/coc-tools/pdf-inspector/
(AGENTS PDF contract keeps parsers out of the repo) and imports the
@firecrawl/pdf-inspector binding relative to its own file. These tests run
the router as a subprocess with a stub binding injected through the
COC_PI_PDF_INSPECTOR_BINDING env override, so they are hermetic and need no
real PDF or installed binding. The three modes (locator_first_bundle,
full_parse_batch, opening_review) must emit the coc.pi-pdf-inspector-result.v1
envelope and write a schema-v1 source bundle that the repository's own
validator accepts.

Real-binding integration tests at the bottom skip when the deployed binding
or the authorized Cold Harvest PDF is unavailable on this machine.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

import pytest


ROOT = Path(__file__).resolve().parents[1]
PLUGIN = ROOT / "plugins" / "coc-keeper"
DEPLOYED_ROUTER = (
    Path.home() / ".pi" / "coc-tools" / "pdf-inspector"
    / "coc-pi-pdf-inspector-router"
)
DEPLOYED_BINDING = (
    Path.home() / ".pi" / "coc-tools" / "pdf-inspector"
    / "node_modules" / "@firecrawl" / "pdf-inspector" / "index.js"
)
COLD_HARVEST_PDF = Path(
    "/Users/haoli/Documents/TRPG/克苏鲁的呼唤/[COC模组翻译]冰冷的收获-Cold Harvest.pdf"
)
COLD_HARVEST_SHA_PREFIX = "e4832eec4aa06a2a"
REQUEST_CONTRACT = "coc.pi-pdf-inspector-request.v1"
RESULT_CONTRACT = "coc.pi-pdf-inspector-result.v1"


def _load_bundle_validator():
    sys.path.insert(0, str(PLUGIN / "scripts"))
    import coc_pdf_bundle  # type: ignore[import-not-found]
    return coc_pdf_bundle


def _load_pdf_adapter(name: str):
    path = PLUGIN / "pi/bin/coc-pdf-skill-adapter.py"
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _stub_binding(path: Path, *, page_count: int = 48, ocr_pages: list[int] | None = None) -> Path:
    """Write a hermetic @firecrawl/pdf-inspector stand-in.

    classifyPdf always reports TextBased; extractPagesMarkdown synthesizes
    deterministic per-page markdown and marks the configured pages needsOcr.
    """
    ocr = sorted(ocr_pages or [])
    script = f"""export function classifyPdf() {{
  return {{ pdfType: 'TextBased', pageCount: {page_count},
    pagesNeedingOcr: {json.dumps(ocr)}, confidence: 0.93 }};
}}
const OCR = new Set({json.dumps(ocr)});
export function extractPagesMarkdown(_buffer, pages) {{
  return {{
    pages: pages.map((page) => ({{
      page,
      markdown: `# Page ${{page + 1}}\\n\\nExtracted native text ${{page}}.\\n`,
      needsOcr: OCR.has(page),
      ocrReason: OCR.has(page) ? 'scanned_image' : undefined,
    }})),
    pagesWithTables: [], pagesWithColumns: [], pagesNeedingOcr: [],
    ocrReasonsByPage: [], isComplex: false,
  }};
}}
"""
    path.write_text(script, encoding="utf-8")
    return path


def _zero_image_pdfimages(path: Path) -> Path:
    """Hermetic absolute executable: both pdfimages passes report zero images."""
    path.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    path.chmod(0o755)
    return path.resolve()


def _run_router(
    router: Path,
    request: dict,
    *,
    binding: Path,
    real_images: bool = False,
) -> subprocess.CompletedProcess[str]:
    env = {
        **os.environ,
        "COC_PI_PDF_INSPECTOR_BINDING": str(binding),
    }
    if real_images:
        env.pop("COC_PI_PDFIMAGES_COMMAND", None)
    else:
        fake = _zero_image_pdfimages(binding.parent / "zero-image-pdfimages")
        assert fake.is_absolute() and os.access(fake, os.X_OK)
        env["COC_PI_PDFIMAGES_COMMAND"] = str(fake)
    return subprocess.run(
        [str(router)],
        input=json.dumps(request, ensure_ascii=False),
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


def _request(*, mode: str, pdf: Path, bundle: Path, **extra) -> dict:
    body = {
        "schema_version": 1,
        "contract_id": REQUEST_CONTRACT,
        "mode": mode,
        "source": {
            "path": str(pdf),
            "source_id": "pdf:test-module",
            "title": "Test Module",
            "file_sha256": hashlib.sha256(pdf.read_bytes()).hexdigest(),
        },
        "source_bundle_path": str(bundle),
        "manifest_producer_literal": "codex-pdf-skill",
        "page_count": 48,
    }
    body.update(extra)
    return body


def _write_preseed(bundle: Path, indices: list[int]) -> None:
    """Mirror the adapter's _preseed_reusable_bound_source: the output root
    already contains bound pages + a manifest the router must not rewrite."""
    pages_dir = bundle / "pages"
    pages_dir.mkdir(parents=True, exist_ok=True)
    rows = []
    for index in indices:
        content = f"# Preseeded page {index + 1}\n\nBound text {index}.\n".encode()
        (pages_dir / f"{index:04d}.md").write_bytes(content)
        rows.append({
            "pdf_index": index,
            "printed_page": index + 1,
            "markdown_path": f"pages/{index:04d}.md",
            "text_sha256": hashlib.sha256(content).hexdigest(),
            "review_state": "manual_accepted",
            "parse_confidence": 0.9,
            "grep_anchors": [f"Bound text {index}."],
        })
    manifest = {
        "schema_version": 1,
        "producer": "codex-pdf-skill",
        "source": {
            "source_id": "pdf:test-module",
            "title": "Test Module",
            "path": str(bundle / "module.pdf"),
            "file_sha256": "a" * 64,
            "page_count": 48,
        },
        "pages": rows,
        "assets": [],
    }
    (bundle / "manifest.json").write_text(
        json.dumps(manifest), encoding="utf-8",
    )


def _assert_valid_bundle(bundle: Path, expected_indices: list[int]) -> dict:
    validator = _load_bundle_validator()
    loaded = validator.load_host_bundle(bundle)
    assert [int(page["pdf_index"]) for page in loaded["pages"]] == expected_indices
    assert loaded["source"]["source_id"] == "pdf:test-module"
    assert loaded["producer"] == "codex-pdf-skill"
    return loaded


# --------------------------------------------------------------------------
# Hermetic router contract tests
# --------------------------------------------------------------------------


def test_router_locator_first_bundle_writes_valid_bundle(tmp_path: Path):
    binding = _stub_binding(tmp_path / "binding.mjs")
    pdf = tmp_path / "module.pdf"
    pdf.write_bytes(b"stub")
    bundle = tmp_path / "locator-bundle"
    request = _request(
        mode="locator_first_bundle", pdf=pdf, bundle=bundle,
        requested_pdf_indices=[0, 1, 2],
    )
    completed = _run_router(DEPLOYED_ROUTER, request, binding=binding)
    assert completed.returncode == 0, completed.stderr
    result = json.loads(completed.stdout)
    assert result["schema_version"] == 1
    assert result["contract_id"] == RESULT_CONTRACT
    assert result["status"] == "ok"
    assert result["source_bundle_path"] == str(bundle)
    assert result["rendered_pdf_indices"] == [0, 1, 2]
    _assert_valid_bundle(bundle, [0, 1, 2])
    assert (bundle / "pages" / "0000.md").is_file()


def test_router_full_parse_batch_writes_requested_missing_pages(tmp_path: Path):
    binding = _stub_binding(tmp_path / "binding.mjs")
    pdf = tmp_path / "module.pdf"
    pdf.write_bytes(b"stub")
    bundle = tmp_path / "batch-bundle"
    request = _request(
        mode="full_parse_batch", pdf=pdf, bundle=bundle,
        missing_pdf_indices=[2, 3, 4],
    )
    completed = _run_router(DEPLOYED_ROUTER, request, binding=binding)
    assert completed.returncode == 0, completed.stderr
    result = json.loads(completed.stdout)
    assert result["status"] == "ok"
    assert result["rendered_pdf_indices"] == [2, 3, 4]
    _assert_valid_bundle(bundle, [2, 3, 4])


def test_router_opening_review_selects_split_and_retains_preseed(tmp_path: Path):
    binding = _stub_binding(tmp_path / "binding.mjs")
    pdf = tmp_path / "module.pdf"
    pdf.write_bytes(b"stub")
    bundle = tmp_path / "opening-bundle"
    _write_preseed(bundle, [10, 11, 12])
    request = _request(
        mode="opening_review", pdf=pdf, bundle=bundle,
        opening_locator_pdf_indices=[10, 11, 12],
        max_selected_opening_pages=3,
        max_fact_evidence_pages=8,
        reusable_bound_source={"source_bundle_path": str(bundle)},
    )
    completed = _run_router(DEPLOYED_ROUTER, request, binding=binding)
    assert completed.returncode == 0, completed.stderr
    result = json.loads(completed.stdout)
    assert result["status"] == "ok"
    assert result["selected_opening_pdf_indices"] == [10, 11, 12]
    assert result["fact_evidence_pdf_indices"] == [10, 11, 12]
    assert result["rendered_pdf_indices"] == [10, 11, 12]
    loaded = _assert_valid_bundle(bundle, [10, 11, 12])
    # Preseeded rows are retained verbatim (manual_accepted), never re-extracted.
    assert loaded["pages"][0]["review_state"] == "manual_accepted"
    assert loaded["pages"][0]["grep_anchors"] == ["Bound text 10."]
    original = (bundle / "pages" / "0010.md").read_bytes()
    assert original == b"# Preseeded page 11\n\nBound text 10.\n"


def test_router_opening_review_adds_native_pages_beyond_preseed(tmp_path: Path):
    binding = _stub_binding(tmp_path / "binding.mjs")
    pdf = tmp_path / "module.pdf"
    pdf.write_bytes(b"stub")
    bundle = tmp_path / "opening-extended"
    # Preseed covers only page 10; the router must native-extract 11 and 12.
    _write_preseed(bundle, [10])
    request = _request(
        mode="opening_review", pdf=pdf, bundle=bundle,
        opening_locator_pdf_indices=[10, 11, 12],
        max_selected_opening_pages=3,
        max_fact_evidence_pages=8,
    )
    completed = _run_router(DEPLOYED_ROUTER, request, binding=binding)
    assert completed.returncode == 0, completed.stderr
    result = json.loads(completed.stdout)
    assert result["status"] == "ok"
    loaded = _assert_valid_bundle(bundle, [10, 11, 12])
    by_index = {int(page["pdf_index"]): page for page in loaded["pages"]}
    assert by_index[10]["review_state"] == "manual_accepted"
    assert by_index[11]["review_state"] == "auto_accepted"
    assert by_index[11]["grep_anchors"] == ["# Page 12"]


def test_router_needs_ocr_pages_return_fallback_marker(tmp_path: Path):
    binding = _stub_binding(
        tmp_path / "binding.mjs", ocr_pages=[1],
    )
    pdf = tmp_path / "module.pdf"
    pdf.write_bytes(b"stub")
    bundle = tmp_path / "ocr-bundle"
    request = _request(
        mode="locator_first_bundle", pdf=pdf, bundle=bundle,
        requested_pdf_indices=[0, 1, 2],
    )
    completed = _run_router(DEPLOYED_ROUTER, request, binding=binding)
    assert completed.returncode == 0, completed.stderr
    result = json.loads(completed.stdout)
    assert result["status"] == "fallback"
    assert result["reason"] == "needs_ocr"
    assert result["pages_needing_ocr_0indexed"] == [1]
    assert not (bundle / "manifest.json").exists()


def test_router_opening_review_needs_ocr_falls_back_preseed_untouched(
    tmp_path: Path,
):
    binding = _stub_binding(tmp_path / "binding.mjs", ocr_pages=[1])
    pdf = tmp_path / "module.pdf"
    pdf.write_bytes(b"stub")
    bundle = tmp_path / "opening-ocr"
    _write_preseed(bundle, [0, 1, 2])
    original_manifest = (bundle / "manifest.json").read_bytes()
    request = _request(
        mode="opening_review", pdf=pdf, bundle=bundle,
        opening_locator_pdf_indices=[0, 1, 2],
        max_selected_opening_pages=3,
        max_fact_evidence_pages=8,
    )
    completed = _run_router(DEPLOYED_ROUTER, request, binding=binding)
    assert completed.returncode == 0, completed.stderr
    result = json.loads(completed.stdout)
    assert result["status"] == "fallback"
    assert result["reason"] == "needs_ocr"
    assert result["pages_needing_ocr_0indexed"] == [1]
    # The preseeded bundle must remain byte-for-byte untouched on fallback.
    assert (bundle / "manifest.json").read_bytes() == original_manifest


def test_router_invalid_request_returns_error_envelope_and_exit_2(
    tmp_path: Path,
):
    binding = _stub_binding(tmp_path / "binding.mjs")
    request = {
        "schema_version": 2,
        "contract_id": REQUEST_CONTRACT,
        "mode": "locator_first_bundle",
        "source": {"path": "/no/such.pdf"},
        "source_bundle_path": str(tmp_path / "bundle"),
    }
    completed = _run_router(DEPLOYED_ROUTER, request, binding=binding)
    assert completed.returncode == 2
    result = json.loads(completed.stdout)
    assert result["status"] == "error"
    assert result["reason"] == "invalid_request_or_runtime_error"


# --------------------------------------------------------------------------
# Launcher env defaults
# --------------------------------------------------------------------------


def test_pi_coc_launcher_exports_pdf_inspector_defaults():
    wrapper = PLUGIN / "pi/bin/pi-coc"
    script = wrapper.read_text(encoding="utf-8")
    assert (
        'export COC_PI_PDF_INSPECTOR_COMMAND="${COC_PI_PDF_INSPECTOR_COMMAND:-'
        '$HOME/.pi/coc-tools/pdf-inspector/coc-pi-pdf-inspector-router}"'
    ) in script
    assert (
        'export COC_PI_PDF_MODEL="${COC_PI_PDF_MODEL:-xai/grok-4.6}"'
    ) in script
    # The opening extractor defaults to whatever the visual child runs on, not
    # to a model name. "Text-only" argues for a text model, not for a second
    # provider: the DeepSeek default dragged another credential into a chain
    # that otherwise runs entirely on the session's own, and on 2026-09-02 that
    # credential was invalid -- every opening source review died on a 401 for a
    # provider nothing else in the run touches. Assert the one-provider rule so
    # a literal model name cannot be reintroduced here without failing.
    assert (
        'export COC_PI_OPENING_MODEL="${COC_PI_OPENING_MODEL:-$COC_PI_PDF_MODEL}"'
    ) in script


# --------------------------------------------------------------------------
# Real-binding integration (skipped when the deployed binding or the
# authorized Cold Harvest PDF is unavailable on this machine)
# --------------------------------------------------------------------------


@pytest.fixture(scope="module")
def deployed_router() -> Path | None:
    if (
        not DEPLOYED_ROUTER.is_file()
        or not os.access(DEPLOYED_ROUTER, os.X_OK)
        or not DEPLOYED_BINDING.is_file()
    ):
        return None
    return DEPLOYED_ROUTER


def _cold_harvest() -> tuple[Path, str] | None:
    if not COLD_HARVEST_PDF.is_file():
        return None
    digest = hashlib.sha256(COLD_HARVEST_PDF.read_bytes()).hexdigest()
    if not digest.startswith(COLD_HARVEST_SHA_PREFIX):
        return None
    return COLD_HARVEST_PDF, digest


def test_deployed_router_full_parse_cold_harvest_bundle_validates(
    tmp_path: Path, deployed_router,
):
    if deployed_router is None:
        pytest.skip("deployed pdf-inspector binding/router not installed")
    cold = _cold_harvest()
    if cold is None:
        pytest.skip("authorized Cold Harvest PDF unavailable")
    pdf, digest = cold
    bundle = tmp_path / "cold-batch"
    request = _request(
        mode="full_parse_batch", pdf=pdf, bundle=bundle,
        missing_pdf_indices=[2, 3, 4],
    )
    request["source"]["file_sha256"] = digest
    completed = _run_router(
        deployed_router, request, binding=DEPLOYED_BINDING, real_images=True,
    )
    assert completed.returncode == 0, completed.stderr
    result = json.loads(completed.stdout)
    assert result["status"] == "ok"
    assert result["rendered_pdf_indices"] == [2, 3, 4]
    _assert_valid_bundle(bundle, [2, 3, 4])


def test_deployed_router_adapter_run_uses_router_not_pi_fallback(
    tmp_path: Path, deployed_router,
):
    """The adapter --run lane must adopt the router receipt without ever
    invoking the Pi PDF-skill child. Pi is deliberately unavailable (no
    COC_PI_COMMAND and no `pi` on PATH), so any fallback would exit non-zero;
    a located receipt therefore proves the router path."""
    if deployed_router is None:
        pytest.skip("deployed pdf-inspector binding/router not installed")
    cold = _cold_harvest()
    if cold is None:
        pytest.skip("authorized Cold Harvest PDF unavailable")
    pdf, digest = cold
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    bundle_dir = (
        workspace / ".tmp" / "coc-source-scope" / "camp" / "job" / "staging"
    )
    bundle_dir.mkdir(parents=True)
    task = {
        "schema_version": 1,
        "contract_id": "coc.pi-source-scope-locator-task.v1",
        "adapter_mode": "pi_external_pdf_skill_lifecycle",
        "model_policy": "pinned_xai_grok_4_5_thinking_low",
        "max_selected_pages": 3,
        "workspace_root": str(workspace),
        "job_id": "job-router-real",
        "kind": "scenario",
        "target_id": "target-cold-harvest",
        "target_label": "Cold Harvest",
        "source_bundle_path": str(bundle_dir),
        "asset_root_id": "raw-pdf-bind:camp",
        "cached_pdf_indices": [],
        "source": {
            "path": str(pdf),
            "source_id": "pdf:cold-harvest",
            "title": "Cold Harvest",
            "file_sha256": digest,
        },
        # Non-canonical in production, but the adapter forwards it when
        # present: a native-safe window lets the router adopt instead of
        # falling back to Grok vision for Cold Harvest's OCR title pages.
        "requested_pdf_indices": [2, 3, 4],
    }
    env = {
        **os.environ,
        "COC_PI_PDF_INSPECTOR_COMMAND": str(deployed_router),
        "COC_PI_PDF_SKILL": str(tmp_path / "missing-pdf-skill"),
        # node must stay resolvable for the router wrapper; `pi` must not
        # (a fallback would then fail fast instead of hanging on a real CLI).
        "PATH": f"{Path(shutil.which('node') or '/usr/local/bin/node').parent}:"
        "/usr/bin:/bin",
    }
    env.pop("COC_PI_PDFIMAGES_COMMAND", None)
    completed = subprocess.run(
        [os.sys.executable, str(PLUGIN / "pi/bin/coc-pdf-skill-adapter.py"), "--run"],
        cwd=ROOT,
        env=env,
        input=json.dumps(task, ensure_ascii=False),
        capture_output=True,
        text=True,
        check=False,
    )
    assert completed.returncode == 0, completed.stderr
    receipt = json.loads(completed.stdout)
    assert receipt["status"] == "located"
    assert receipt["source_bundle_path"] == task["source_bundle_path"]
    assert receipt["pdf_indices"] == [3, 4, 5]


def test_deployed_router_adapter_opening_review_router_adoption(
    tmp_path: Path, deployed_router,
):
    """opening_review on a native window must be adopted by the adapter
    (_try_external_pdf_router returns the router materialization, not None)."""
    if deployed_router is None:
        pytest.skip("deployed pdf-inspector binding/router not installed")
    cold = _cold_harvest()
    if cold is None:
        pytest.skip("authorized Cold Harvest PDF unavailable")
    pdf, digest = cold
    adapter = _load_pdf_adapter("coc_pdf_adapter_real_router_opening_test")
    bundle = tmp_path / "opening-real"
    _write_preseed(bundle, [10, 11, 12])
    # Align the preseed identity with the real PDF so the validated bundle
    # passes the adapter's source identity checks.
    manifest_path = bundle / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["source"] = {
        "source_id": "pdf:cold-harvest",
        "title": "Cold Harvest",
        "path": str(pdf),
        "file_sha256": digest,
        "page_count": 48,
    }
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    task = {
        "source_bundle_path": str(bundle),
        "source": {
            "path": str(pdf),
            "source_id": "pdf:cold-harvest",
            "title": "Cold Harvest",
            "file_sha256": digest,
        },
        "opening_locator_pdf_indices": [10, 11, 12],
        "max_selected_opening_pages": 3,
        "max_fact_evidence_pages": 8,
        "reusable_bound_source": {"source_bundle_path": str(bundle)},
    }
    env_backup = dict(os.environ)
    os.environ["COC_PI_PDF_INSPECTOR_COMMAND"] = str(deployed_router)
    os.environ.pop("COC_PI_PDFIMAGES_COMMAND", None)
    try:
        adopted = adapter._try_external_pdf_router("opening_review", task)
    finally:
        os.environ.clear()
        os.environ.update(env_backup)
    assert adopted is not None
    assert adopted["selected_opening_pdf_indices"] == [10, 11, 12]
    assert adopted["fact_evidence_pdf_indices"] == [10, 11, 12]
    assert [
        int(page["pdf_index"]) for page in adopted["bundle"]["pages"]
    ] == [10, 11, 12]
