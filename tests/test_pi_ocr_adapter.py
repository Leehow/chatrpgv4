from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ADAPTER_PATH = (
    ROOT / "plugins" / "coc-keeper" / "pi" / "bin" / "coc-ocr-adapter.py"
)


def _load_adapter():
    spec = importlib.util.spec_from_file_location("coc_ocr_adapter", ADAPTER_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_fast_preserves_manifest_and_reports_complete_corpus_without_acceptance(
    monkeypatch, tmp_path,
):
    adapter = _load_adapter()
    source = tmp_path / "source.pdf"
    source.write_bytes(b"external source identity")
    corpus = tmp_path / "bundle" / "pages"
    corpus.mkdir(parents=True)
    manifest = corpus.parent / "manifest.json"
    original_manifest = b'{"sentinel":"external-producer-owned"}\n'
    manifest.write_bytes(original_manifest)
    secret = "do-not-echo-ocr-secret"
    monkeypatch.setenv("BAIDUOCR_TOKEN", secret)

    def fake_run(*_args, **_kwargs):
        for index in range(40):
            (corpus / f"doc_{index}.md").write_text(
                f"external OCR document {index}\n", encoding="utf-8"
            )
        return subprocess.CompletedProcess(
            args=["baiduocr"], returncode=0, stdout="", stderr=secret
        )

    monkeypatch.setattr(subprocess, "run", fake_run)
    result = adapter.op_fast(str(source), str(corpus))

    assert manifest.read_bytes() == original_manifest
    assert result == {
        "status": "completed",
        "corpus_ready": True,
        "markdown_document_count": 40,
        "markdown_total_bytes": sum(
            path.stat().st_size for path in corpus.glob("*.md")
        ),
        "validated_source_bundle": False,
        "source_bundle_status": "external_manifest_required",
    }
    serialized = json.dumps(result, ensure_ascii=False)
    assert secret not in serialized
    assert str(source.resolve()) not in serialized
    assert str(corpus.resolve()) not in serialized
    for invented in (
        "review_state",
        "parse_confidence",
        "pdf_index",
        "manifest_updated",
        "auto_accepted",
    ):
        assert invented not in serialized


def test_adapter_stdout_is_one_strict_json_object(tmp_path):
    corpus = tmp_path / "corpus"
    corpus.mkdir()
    (corpus / "doc_0.md").write_text("external OCR\n", encoding="utf-8")

    completed = subprocess.run(
        [sys.executable, str(ADAPTER_PATH), "status", str(corpus)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )

    assert completed.returncode == 0, completed.stderr
    assert len(completed.stdout.splitlines()) == 1
    assert json.loads(completed.stdout) == {
        "status": "ok",
        "corpus_ready": True,
        "pages": 1,
    }


def test_resolve_baiduocr_python_ignores_env_without_requests(monkeypatch):
    """A mis-set COC_PROGRESSIVE_OCR_PYTHON (project venv) must not win."""
    adapter = _load_adapter()
    if hasattr(adapter._resolve_baiduocr_python, "_cached"):
        delattr(adapter._resolve_baiduocr_python, "_cached")

    broken = sys.executable  # repo venv deliberately has no requests
    monkeypatch.setenv("COC_PROGRESSIVE_OCR_PYTHON", broken)
    monkeypatch.setenv("BAIDUOCR_TOKEN", "test-token")

    calls: list[list[str]] = []

    def fake_run(cmd, **_kwargs):
        calls.append(list(cmd))
        # Probe: candidate -c "import requests"
        if len(cmd) >= 3 and cmd[1] == "-c" and "import requests" in cmd[2]:
            # Only accept a synthetic good interpreter name.
            if cmd[0] == "python3.11-good":
                return subprocess.CompletedProcess(
                    args=cmd, returncode=0, stdout="", stderr="",
                )
            return subprocess.CompletedProcess(
                args=cmd, returncode=1, stdout="", stderr="No module named requests",
            )
        return subprocess.CompletedProcess(
            args=cmd, returncode=0, stdout="", stderr="",
        )

    monkeypatch.setattr(adapter.subprocess, "run", fake_run)
    # Inject the good candidate into the probe list for this process.
    monkeypatch.setattr(
        adapter,
        "_OCR_PYTHON_CANDIDATES",
        ("python3.11-good", "python3", "python"),
    )

    resolved = adapter._resolve_baiduocr_python()
    assert resolved == "python3.11-good"
    assert any(c[0] == broken for c in calls), "must probe the broken env first"
    assert any(c[0] == "python3.11-good" for c in calls)


def test_ocr_python_candidates_cover_reduced_macos_gui_path():
    adapter = _load_adapter()

    assert "/opt/homebrew/opt/python@3.11/bin/python3.11" in (
        adapter._OCR_PYTHON_CANDIDATES
    )
    assert "/Applications/Xcode.app/Contents/Developer/usr/bin/python3" in (
        adapter._OCR_PYTHON_CANDIDATES
    )


def test_op_fast_reports_missing_requests_explicitly(monkeypatch, tmp_path):
    adapter = _load_adapter()
    if hasattr(adapter._resolve_baiduocr_python, "_cached"):
        delattr(adapter._resolve_baiduocr_python, "_cached")
    monkeypatch.delenv("COC_PROGRESSIVE_OCR_PYTHON", raising=False)
    monkeypatch.setenv("BAIDUOCR_TOKEN", "test-token")
    monkeypatch.setattr(adapter, "_OCR_PYTHON_CANDIDATES", ())
    monkeypatch.setattr(
        adapter.subprocess,
        "run",
        lambda *_a, **_k: subprocess.CompletedProcess(
            args=[], returncode=1, stdout="", stderr="",
        ),
    )
    source = tmp_path / "source.pdf"
    source.write_bytes(b"%PDF")
    result = adapter.op_fast(str(source), str(tmp_path / "corpus"))
    assert result["status"] == "error"
    assert result["failure_class"] == "ocr_python_missing_requests"
    assert "requests" in result["error"]
