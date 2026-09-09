"""The kernel must not import a PDF parser."""
from pathlib import Path
import re

PDF_LIBRARY_NAMES = ("pypdf", "PyPDF2", "pdfplumber", "fitz", "pymupdf", "pdfminer",
                    "pikepdf", "camelot", "tabula", "pdf2image", "pdfjs-dist", "@napi-rs/canvas")


def test_no_pdf_library_is_imported_anywhere_under_kernel():
    kernel_root = Path(__file__).resolve().parents[2] / "kernel-ts"
    import_re = re.compile(r'''(?:from|import|require)\s*(?:\(\s*)?["']([^"']+)["']''')
    offenders = []
    sources = list(kernel_root.rglob("*.ts"))
    assert sources, "The active TypeScript kernel is missing"
    for path in sources:
        for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
            match = import_re.search(line)
            if match and any(match.group(1) == name or match.group(1).startswith(name + "/") for name in PDF_LIBRARY_NAMES):
                offenders.append(f"{path}: {line.strip()}")
    assert offenders == []
