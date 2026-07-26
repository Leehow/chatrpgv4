#!/usr/bin/env python3
"""Adapter: translate coc_progressive_ocr's CLI contract into baiduocr.py calls.

coc_progressive_ocr expects: <script> <operation> [args] --corpus <dir>
baiduocr.py expects: <source> --output-dir <dir>

This adapter bridges the two so pi-coc can use the existing baiduocr skill.
Set COC_PROGRESSIVE_OCR_COMMAND to this script's absolute path.

Supported operations (coc_progressive_ocr contract):
  status <corpus_path>           → report OCR availability + corpus state
  fast <source_path> --corpus <corpus_path>
                                  → run baiduocr on source, output to corpus
  enhance <corpus_path> --pages <pages>
                                  → re-run specific pages (not supported by
                                    baiduocr's batch API; returns cached pages)
  export <corpus_path> --quality <q> --output <path>
                                  → copy corpus markdown to output path

Output: JSONL lines on stdout (coc_progressive_ocr reads line-delimited JSON).
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

BAIDUOCR = Path.home() / ".codex" / "skills" / "baiduocr" / "scripts" / "baiduocr.py"
BAIDUOCR_PYTHON = os.environ.get("COC_PROGRESSIVE_OCR_PYTHON", sys.executable)


def emit(data: dict) -> None:
    """Emit one JSONL line for coc_progressive_ocr to consume."""
    print(json.dumps(data, ensure_ascii=False), flush=True)


def op_status(corpus_path: str) -> None:
    corpus = Path(corpus_path)
    has_pages = corpus.is_dir() and any(corpus.glob("*.md"))
    emit({"status": "ok", "corpus_ready": has_pages, "pages": len(list(corpus.glob("*.md"))) if has_pages else 0})
    if not has_pages:
        emit({"status": "ok", "layout_noise": "tolerated"})


def op_fast(source_path: str, corpus_path: str) -> None:
    source = Path(source_path)
    corpus = Path(corpus_path)
    corpus.mkdir(parents=True, exist_ok=True)

    if not source.exists():
        emit({"status": "error", "error": f"source not found: {source}"})
        return

    emit({"status": "started", "source": str(source), "corpus": str(corpus)})

    try:
        result = subprocess.run(
            [BAIDUOCR_PYTHON, str(BAIDUOCR), str(source), "--output-dir", str(corpus)],
            capture_output=True, text=True, timeout=900,
            env={**os.environ},
        )
        if result.returncode != 0:
            emit({"status": "error", "error": result.stderr[:500] or "baiduocr failed"})
            return

        # baiduocr outputs markdown files into corpus dir
        md_files = sorted(corpus.glob("*.md"))
        emit({"status": "completed", "pages": len(md_files), "corpus": str(corpus)})
        for md in md_files:
            emit({"page": md.stem, "path": str(md), "size": md.stat().st_size})
    except subprocess.TimeoutExpired:
        emit({"status": "error", "error": "baiduocr timed out (900s)"})
    except Exception as e:
        emit({"status": "error", "error": str(e)[:200]})


def op_enhance(corpus_path: str, pages: str | None = None) -> None:
    """baiduocr doesn't support per-page re-extraction via CLI; return cached."""
    corpus = Path(corpus_path)
    md_files = sorted(corpus.glob("*.md"))
    if pages:
        indices = [p.strip() for p in pages.split(",")]
        md_files = [f for f in md_files if f.stem in indices or f.stem.lstrip("0") in indices]
    emit({"status": "ok", "pages": len(md_files)})
    for md in md_files:
        emit({"page": md.stem, "path": str(md), "size": md.stat().st_size})


def op_export(corpus_path: str, output_path: str, quality: str = "best", pages: str | None = None) -> None:
    corpus = Path(corpus_path)
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)

    md_files = sorted(corpus.glob("*.md"))
    if pages:
        indices = [p.strip() for p in pages.split(",")]
        md_files = [f for f in md_files if f.stem in indices or f.stem.lstrip("0") in indices]

    # Concatenate all markdown into a single output file
    content = []
    for md in md_files:
        content.append(f"<!-- page {md.stem} -->\n")
        content.append(md.read_text(encoding="utf-8"))
        content.append("\n\n---\n\n")

    output.write_text("".join(content), encoding="utf-8")
    emit({"status": "exported", "output": str(output), "pages": len(md_files), "size": output.stat().st_size})


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
        op_status(args.path)
    elif args.operation == "fast":
        if not args.corpus:
            print(json.dumps({"status": "error", "error": "fast requires --corpus"}), file=sys.stderr)
            sys.exit(1)
        op_fast(args.path, args.corpus)
    elif args.operation == "enhance":
        op_enhance(args.path, args.pages)
    elif args.operation == "export":
        if not args.output:
            print(json.dumps({"status": "error", "error": "export requires --output"}), file=sys.stderr)
            sys.exit(1)
        op_export(args.path, args.output, args.quality, args.pages)


if __name__ == "__main__":
    main()
