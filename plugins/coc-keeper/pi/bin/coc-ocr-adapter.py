#!/usr/bin/env python3
"""Adapter: translate coc_progressive_ocr's CLI contract into baiduocr.py calls.

coc_progressive_ocr expects: <script> <operation> [args] --corpus <dir>
and the script must return ONE JSON object on stdout (not JSONL).

baiduocr.py expects: <source> --output-dir <dir>

Set COC_PROGRESSIVE_OCR_COMMAND to this script's absolute path.

Supported operations:
  status <corpus_path>           → report OCR availability + corpus state
  fast <source_path> --corpus <corpus_path>
                                  → run baiduocr on source, output to corpus
  enhance <corpus_path> --pages <pages>
                                  → report cached pages (baiduocr can't re-extract per-page)
  export <corpus_path> --quality <q> --output <path>
                                  → concatenate corpus markdown to output path
"""
import argparse
import json
import os
import sys
from pathlib import Path

BAIDUOCR = Path.home() / ".codex" / "skills" / "baiduocr" / "scripts" / "baiduocr.py"
BAIDUOCR_PYTHON = os.environ.get("COC_PROGRESSIVE_OCR_PYTHON", sys.executable)


def op_status(corpus_path: str) -> dict:
    corpus = Path(corpus_path)
    md_files = sorted(corpus.glob("*.md")) if corpus.is_dir() else []
    return {
        "status": "ok",
        "corpus_ready": len(md_files) > 0,
        "pages": len(md_files),
    }


def op_fast(source_path: str, corpus_path: str) -> dict:
    import subprocess, hashlib

    source = Path(source_path)
    corpus = Path(corpus_path)
    corpus.mkdir(parents=True, exist_ok=True)

    if not source.exists():
        return {"status": "error", "error": f"source not found: {source}"}

    try:
        result = subprocess.run(
            [BAIDUOCR_PYTHON, str(BAIDUOCR), str(source), "--output-dir", str(corpus)],
            capture_output=True, text=True, timeout=900,
            env={**os.environ},
        )
        if result.returncode != 0:
            return {"status": "error", "error": (result.stderr or "baiduocr failed")[:500]}

        md_files = sorted(corpus.glob("*.md"))

        # Auto-update bundle manifest.json so scenario.bind_pdf works
        # immediately after OCR. The manifest lives in the parent of the
        # pages/ directory (i.e., corpus_path/../manifest.json).
        bundle_dir = corpus.parent
        manifest_path = bundle_dir / "manifest.json"
        if manifest_path.exists():
            manifest = json.loads(manifest_path.read_text("utf-8"))
            # Map baiduocr's doc_N.md to pdf_index N
            pages = []
            for md in md_files:
                stem = md.stem  # e.g. "doc_0", "doc_12"
                parts = stem.split("_")
                pdf_index = int(parts[-1]) if parts[-1].isdigit() else 0
                text_bytes = md.read_bytes()
                text_sha = hashlib.sha256(text_bytes).hexdigest()
                pages.append({
                    "pdf_index": pdf_index,
                    "markdown_path": f"pages/{md.name}",
                    "text_sha256": text_sha,
                    "review_state": "auto_accepted",
                    "parse_confidence": 0.90,
                    "grep_anchors": [],
                })
            # Cap at 32 pages (MAX_PAGES contract)
            if len(pages) > 32:
                pages = pages[:32]
            manifest["pages"] = pages
            manifest_path.write_text(
                json.dumps(manifest, ensure_ascii=False, indent=2), "utf-8"
            )

        return {
            "status": "completed",
            "source": {"path": str(source.resolve())},
            "corpus": str(corpus),
            "pages": [
                {"page": md.stem, "path": str(md), "size": md.stat().st_size}
                for md in md_files
            ],
            "page_count": len(md_files),
            "manifest_updated": manifest_path.exists(),
        }
    except subprocess.TimeoutExpired:
        return {"status": "error", "error": "baiduocr timed out (900s)"}
    except Exception as e:
        return {"status": "error", "error": str(e)[:200]}


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
