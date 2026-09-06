"""Tests for bin/coc-ocr, the OCR adapter (contract docs/kernel-rpc.md §20.1/§20.2).

Hermetic throughout: `PI_COC_OCR_BACKEND` always points at
tests/play/fixtures/fake_ocr_backend.py, never the real baiduocr skill -- these
tests never call the outsourced OCR service, and never put a token anywhere but
an environment variable.
"""
from __future__ import annotations

import importlib.machinery
import importlib.util
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
COC_OCR = REPO_ROOT / "bin" / "coc-ocr"
FAKE_BACKEND = REPO_ROOT / "tests" / "play" / "fixtures" / "fake_ocr_backend.py"


def _resolve_mutool() -> str | None:
    default = "/opt/homebrew/bin/mutool"
    if Path(default).is_file():
        return default
    return shutil.which("mutool")


MUTOOL = _resolve_mutool()


def _load_coc_ocr():
    """`bin/coc-ocr` has no `.py` suffix (it is spawned directly, like `bin/coc-bundle`
    -- see tests/play/bundle_from_pages.py), so it is loaded by path for the tests
    below that exercise its functions directly rather than through a subprocess."""
    loader = importlib.machinery.SourceFileLoader("coc_ocr_tool", str(COC_OCR))
    spec = importlib.util.spec_from_file_location("coc_ocr_tool", COC_OCR, loader=loader)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def backend_env(page_count: int, **extra: str) -> dict[str, str]:
    env = dict(os.environ)
    env["PI_COC_OCR_BACKEND"] = json.dumps([sys.executable, str(FAKE_BACKEND)])
    env["BAIDUOCR_TOKEN"] = "s3cr3t-test-token"
    env["FAKE_OCR_PAGE_COUNT"] = str(page_count)
    env.update(extra)
    return env


def make_pdf(tmp_path: Path, pages: int, name: str = "book.pdf") -> Path:
    """A tiny real multi-page PDF via `mutool create` (one content stream per page).
    Neither coc-bundle nor coc-ocr ever build a PDF themselves; a real tool makes
    this fixture rather than hand-rolled bytes standing in for one."""
    pdf_path = tmp_path / name
    content_paths = []
    for index in range(pages):
        content = tmp_path / f"_page{index}.txt"
        content.write_text(f"%%MediaBox 0 0 200 200\nBT /Helv 18 Tf 10 100 Td (page {index}) Tj ET\n", encoding="utf-8")
        content_paths.append(str(content))
    subprocess.run([MUTOOL, "create", "-o", str(pdf_path), *content_paths], check=True, capture_output=True)
    return pdf_path


def run_ocr(*args: str, env: dict[str, str]) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(COC_OCR), *args], capture_output=True, text=True, env=env)


def last_json(stdout: str) -> dict:
    return json.loads(stdout.strip().splitlines()[-1])


pytestmark = pytest.mark.skipif(MUTOOL is None, reason="mutool is not installed on this machine")


# ---- the subset path (mutool present) -----------------------------------------------


def test_subset_renames_doc_k_by_the_original_page_index(tmp_path):
    pdf = make_pdf(tmp_path, 12)
    out_dir = tmp_path / "pages"
    env = backend_env(page_count=3)  # the subset holds exactly the 3 requested pages
    result = run_ocr(str(pdf), "--pages", "0,1,11", "--out", str(out_dir), env=env)
    assert result.returncode == 0, result.stderr

    summary = last_json(result.stdout)
    assert summary["pages"] == [0, 1, 11]
    assert summary["written"] == 3
    assert summary["skipped"] == []
    assert "mutool subset" in summary["backend"]

    assert sorted(path.name for path in out_dir.glob("*.md")) == ["0000.md", "0001.md", "0011.md"]
    # subset ordinal 0 -> original page 0, ordinal 1 -> original page 1, ordinal 2 -> original page 11
    assert "ordinal 0" in (out_dir / "0000.md").read_text()
    assert "ordinal 1" in (out_dir / "0001.md").read_text()
    assert "ordinal 2" in (out_dir / "0011.md").read_text()


def test_subset_order_is_independent_of_the_pages_argument_order(tmp_path):
    """`--pages 11,0,1` and `--pages 0,1,11` must produce the same files: the tool
    sorts before cutting the subset, so the mapping never depends on argument order."""
    pdf = make_pdf(tmp_path, 12)
    out_dir = tmp_path / "pages"
    env = backend_env(page_count=3)
    result = run_ocr(str(pdf), "--pages", "11,0,1", "--out", str(out_dir), env=env)
    assert result.returncode == 0, result.stderr
    summary = last_json(result.stdout)
    assert summary["pages"] == [0, 1, 11]  # reported sorted regardless of input order
    assert sorted(path.name for path in out_dir.glob("*.md")) == ["0000.md", "0001.md", "0011.md"]


def test_backend_failure_is_a_nonzero_exit_with_a_reason_and_the_summary_still_printed(tmp_path):
    pdf = make_pdf(tmp_path, 3)
    out_dir = tmp_path / "pages"
    env = backend_env(page_count=0, FAKE_OCR_EXIT_CODE="1")
    result = run_ocr(str(pdf), "--pages", "0,1", "--out", str(out_dir), env=env)
    assert result.returncode != 0
    assert result.stderr.strip()
    summary = last_json(result.stdout)
    assert summary["written"] == 0 and summary["skipped"] == [0, 1]
    assert "mutool subset" in summary["backend"]  # the backend name is known even on failure


def test_partial_backend_result_is_reported_as_skipped_and_fails(tmp_path):
    """The backend job came back with fewer pages than were asked for (contract
    §20.6's ocr_unavailable case starts here): what did land is still written, and
    the ones that did not are named in `skipped`, but the run overall fails."""
    pdf = make_pdf(tmp_path, 3)
    out_dir = tmp_path / "pages"
    env = backend_env(page_count=2, FAKE_OCR_MISSING_ORDINALS="1")  # ordinal 1 (original page 1) missing
    result = run_ocr(str(pdf), "--pages", "0,1", "--out", str(out_dir), env=env)
    assert result.returncode != 0
    summary = last_json(result.stdout)
    assert summary["written"] == 1 and summary["skipped"] == [1]
    assert (out_dir / "0000.md").is_file()
    assert not (out_dir / "0001.md").exists()


# ---- the whole-file fallback (mutool unavailable) -------------------------------------


def test_whole_file_fallback_keeps_only_the_requested_pages(tmp_path):
    pdf = make_pdf(tmp_path, 4)
    out_dir = tmp_path / "pages"
    env = backend_env(page_count=4)  # the whole file: the backend sees every page
    env["PI_COC_MUTOOL"] = str(tmp_path / "no-such-mutool")
    result = run_ocr(str(pdf), "--pages", "1,3", "--out", str(out_dir), env=env)
    assert result.returncode == 0, result.stderr

    summary = last_json(result.stdout)
    assert summary["pages"] == [1, 3]
    assert summary["written"] == 2
    assert summary["skipped"] == []
    assert "whole file" in summary["backend"] and "no mutool" in summary["backend"]

    # pages 0 and 2 (which the fake backend also wrote, since it saw the whole
    # 4-page file) are discarded -- only what was asked for is kept.
    assert sorted(path.name for path in out_dir.glob("*.md")) == ["0001.md", "0003.md"]
    assert "ordinal 1" in (out_dir / "0001.md").read_text()
    assert "ordinal 3" in (out_dir / "0003.md").read_text()


# ---- the token ------------------------------------------------------------------------


def test_token_never_reaches_argv_or_any_output(tmp_path):
    pdf = make_pdf(tmp_path, 2)
    out_dir = tmp_path / "pages"
    argv_log = tmp_path / "argv.json"
    env = backend_env(page_count=2, FAKE_OCR_ARGV_LOG=str(argv_log))
    token = env["BAIDUOCR_TOKEN"]

    result = run_ocr(str(pdf), "--pages", "0,1", "--out", str(out_dir), env=env)
    assert result.returncode == 0, result.stderr

    logged_argv = json.loads(argv_log.read_text())
    assert token not in logged_argv
    assert token not in " ".join(logged_argv)
    assert token not in result.stdout
    assert token not in result.stderr


def test_no_token_fails_clearly_without_running_the_backend(tmp_path):
    pdf = make_pdf(tmp_path, 1)
    out_dir = tmp_path / "pages"
    argv_log = tmp_path / "argv.json"
    env = backend_env(page_count=1, FAKE_OCR_ARGV_LOG=str(argv_log))
    del env["BAIDUOCR_TOKEN"]

    result = run_ocr(str(pdf), "--pages", "0", "--out", str(out_dir), env=env)
    assert result.returncode != 0
    assert "BAIDUOCR_TOKEN" in result.stderr

    summary = last_json(result.stdout)
    assert summary["written"] == 0 and summary["skipped"] == [0]
    assert not list(out_dir.glob("*.md"))
    assert not argv_log.exists()  # the backend was never even started


# ---- the backend resolution (unit-level: the default path is not this machine's own) -


def test_no_backend_configured_fails_clearly(monkeypatch):
    """`PI_COC_OCR_BACKEND` unset and the default script missing is `resolve_backend`
    returning no command at all -- exercised in-process (module-level monkeypatch)
    because the real default path (`~/.codex/skills/baiduocr/...`) may or may not
    exist on the machine running the tests, and this behaviour must not depend on
    that."""
    module = _load_coc_ocr()
    monkeypatch.setattr(module, "DEFAULT_BACKEND", Path("/no/such/backend-installed-here.py"))
    monkeypatch.delenv("PI_COC_OCR_BACKEND", raising=False)
    monkeypatch.setenv("BAIDUOCR_TOKEN", "token-present-so-only-the-backend-is-missing")

    command, name = module.resolve_backend()
    assert command is None and name == "none"

    summary, code, reason = module.run("/no/such.pdf", [0], Path("/tmp/unused"))
    assert code != 0
    assert reason is not None and "no OCR backend" in reason
    assert summary["written"] == 0 and summary["skipped"] == [0] and summary["backend"] is None


def test_default_backend_is_run_with_a_python_outside_this_repos_venv(tmp_path, monkeypatch):
    """§20.1: the baiduocr script needs `requests`, not a repository dependency, so
    the default command must not be this repo's uv-managed `sys.executable`."""
    module = _load_coc_ocr()
    stand_in = tmp_path / "baiduocr.py"
    stand_in.write_text("#!/usr/bin/env python3\n", encoding="utf-8")
    monkeypatch.setattr(module, "DEFAULT_BACKEND", stand_in)
    monkeypatch.delenv("PI_COC_OCR_BACKEND", raising=False)

    command, name = module.resolve_backend()
    assert name == "baiduocr"
    assert command is not None
    interpreter = command[0]
    # Run via `uv run --frozen python -m pytest`, `sys.executable` here *is* this
    # repository's venv -- the one the default backend command must not pick.
    assert ".venv" not in interpreter and interpreter != sys.executable


# ---- no PDF library --------------------------------------------------------------------


def test_coc_ocr_imports_no_pdf_library():
    """The repository's law (docs/kernel-rpc.md §20.1): parsing happens in host
    adapters, and this one shells out (mutool, the backend command) -- it never
    reads a PDF's bytes itself."""
    source = COC_OCR.read_text(encoding="utf-8").lower()
    for banned in ("pypdf", "pdfminer", "fitz", "pymupdf", "pdfplumber", "pikepdf"):
        assert banned not in source, banned
