#!/usr/bin/env python3
"""Adapter: translate coc_progressive_ocr's CLI contract into baiduocr.py calls.

coc_progressive_ocr expects: <script> <operation> [args] --corpus <dir>
and the script must return ONE JSON object on stdout (not JSONL).

baiduocr.py expects: <source> --output-dir <dir>

Set COC_PROGRESSIVE_OCR_COMMAND to this script's absolute path.

Supported operations:
  status <corpus_path>           → report OCR availability + corpus state
  fast <source_path> --corpus <corpus_path>
                                  → run baiduocr and report corpus facts only
  enhance <corpus_path> --pages <pages>
                                  → report cached pages (baiduocr can't re-extract per-page)
  export <corpus_path> --quality <q> --output <path>
                                  → concatenate corpus markdown to output path

This adapter never creates, validates, or mutates a PDF source-bundle manifest.
An external PDF skill/contract producer owns page identity, review evidence,
parse confidence, and the final manifest handoff.
"""
import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

BAIDUOCR = Path.home() / ".codex" / "skills" / "baiduocr" / "scripts" / "baiduocr.py"
BAIDUOCR_PYTHON = os.environ.get("COC_PROGRESSIVE_OCR_PYTHON", sys.executable)


def _resolve_baiduocr_python() -> str:
    """Resolve a python that can run baiduocr.py (requires ``requests``).

    The adapter itself is stdlib-only; only the baiduocr child needs
    ``requests``, which is not a repository dependency.  An explicit
    ``COC_PROGRESSIVE_OCR_PYTHON`` wins; otherwise probe common interpreters.
    """
    explicit = os.environ.get("COC_PROGRESSIVE_OCR_PYTHON", "").strip()
    if explicit:
        return explicit
    resolved = getattr(_resolve_baiduocr_python, "_cached", None)
    if resolved is not None:
        return resolved
    for candidate in (BAIDUOCR_PYTHON, "python3.11", "python3.10", "python3"):
        try:
            probe = subprocess.run(
                [candidate, "-c", "import requests"],
                capture_output=True, text=True, timeout=20,
            )
        except (OSError, subprocess.SubprocessError):
            continue
        if probe.returncode == 0:
            _resolve_baiduocr_python._cached = candidate
            return candidate
    _resolve_baiduocr_python._cached = BAIDUOCR_PYTHON
    return BAIDUOCR_PYTHON


def _ocr_token_status() -> dict | None:
    """Explicit token gate: never submit an OCR job without a credential."""
    token = os.environ.get("BAIDUOCR_TOKEN", "").strip()
    if token:
        return None
    return {
        "status": "error",
        "failure_class": "token_missing",
        "error": (
            "环境缺 BAIDUOCR_TOKEN：需要 COC_KEEPER_ENV_FILE 指向的 env 文件或 "
            "~/.config/coc-keeper/secrets.env 提供 BAIDUOCR_TOKEN 才能跑整本 OCR"
        ),
    }


def op_status(corpus_path: str) -> dict:
    corpus = Path(corpus_path)
    md_files = sorted(corpus.glob("*.md")) if corpus.is_dir() else []
    return {
        "status": "ok",
        "corpus_ready": len(md_files) > 0,
        "pages": len(md_files),
    }


def op_fast(source_path: str, corpus_path: str) -> dict:
    token_gate = _ocr_token_status()
    if token_gate is not None:
        return token_gate

    source = Path(source_path)
    corpus = Path(corpus_path)
    corpus.mkdir(parents=True, exist_ok=True)

    if not source.exists():
        return {
            "status": "error", "failure_class": "source_not_found",
            "error": "source not found",
        }

    try:
        result = subprocess.run(
            [_resolve_baiduocr_python(), str(BAIDUOCR), str(source), "--output-dir", str(corpus)],
            capture_output=True, text=True, timeout=900,
            env={**os.environ},
        )
        if result.returncode != 0:
            detail = (result.stderr or "").strip().splitlines()
            return {
                "status": "error",
                "failure_class": "baiduocr_failed",
                "error": (detail[-1] if detail else "baiduocr failed")[:400],
            }

        md_files = sorted(corpus.glob("*.md"))

        return {
            "status": "completed",
            "corpus_ready": bool(md_files),
            "markdown_document_count": len(md_files),
            "markdown_total_bytes": sum(md.stat().st_size for md in md_files),
            "validated_source_bundle": False,
            "source_bundle_status": "external_manifest_required",
        }
    except subprocess.TimeoutExpired:
        return {
            "status": "error", "failure_class": "timeout",
            "error": "baiduocr timed out (900s)",
        }
    except Exception:
        return {
            "status": "error", "failure_class": "adapter_failure",
            "error": "baiduocr adapter failure",
        }


def op_enhance(corpus_path: str, pages: str | None = None) -> dict:
    corpus = Path(corpus_path)
    md_files = sorted(corpus.glob("*.md")) if corpus.is_dir() else []
    if pages:
        indices = {p.strip() for p in pages.split(",")}
        md_files = [f for f in md_files if f.stem in indices or f.stem.lstrip("0") in indices]
    return {
        "status": "ok",
        "pages": [
            {"page": md.stem, "path": str(md), "size": md.stat().st_size}
            for md in md_files
        ],
        "page_count": len(md_files),
    }


def op_export(corpus_path: str, output_path: str, quality: str = "best", pages: str | None = None) -> dict:
    corpus = Path(corpus_path)
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)

    md_files = sorted(corpus.glob("*.md")) if corpus.is_dir() else []
    if pages:
        indices = {p.strip() for p in pages.split(",")}
        md_files = [f for f in md_files if f.stem in indices or f.stem.lstrip("0") in indices]

    content = []
    for md in md_files:
        content.append(f"<!-- page {md.stem} -->\n")
        content.append(md.read_text(encoding="utf-8"))
        content.append("\n\n---\n\n")

    output.write_text("".join(content), encoding="utf-8")
    return {
        "status": "exported",
        "output": str(output),
        "page_count": len(md_files),
        "size": output.stat().st_size,
    }


def main():
    parser = argparse.ArgumentParser(description="coc_progressive_ocr → baiduocr adapter")
    parser.add_argument("operation", choices=["status", "fast", "enhance", "export"])
    parser.add_argument("path", help="source_path (fast) or corpus_path (other)")
    parser.add_argument("--corpus", default=None)
    parser.add_argument("--pages", default=None)
    parser.add_argument("--quality", default="best")
    parser.add_argument("--output", default=None)
    args = parser.parse_args()

    if args.operation == "status":
        result = op_status(args.path)
    elif args.operation == "fast":
        if not args.corpus:
            result = {"status": "error", "error": "fast requires --corpus"}
        else:
            result = op_fast(args.path, args.corpus)
    elif args.operation == "enhance":
        result = op_enhance(args.path, args.pages)
    elif args.operation == "export":
        if not args.output:
            result = {"status": "error", "error": "export requires --output"}
        else:
            result = op_export(args.path, args.output, args.quality, args.pages)

    # Output ONE JSON object (runOcr expects single JSON.parse, not JSONL)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
