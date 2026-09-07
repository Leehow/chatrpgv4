"""The kernel must not import a PDF parser."""
from pathlib import Path
import re

PDF_LIBRARY_NAMES = ("pypdf", "PyPDF2", "pdfplumber", "fitz", "pymupdf", "pdfminer",
                    "pikepdf", "camelot", "tabula", "pdf2image")


def test_no_pdf_library_is_imported_anywhere_under_kernel():
    kernel_root = Path(__file__).resolve().parents[2] / "kernel"
    import_re = re.compile(r"^\s*(?:import|from)\s+([a-zA-Z0-9_.]+)")
    offenders = []
    for path in kernel_root.rglob("*.py"):
        for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
            match = import_re.match(line)
            if match and match.group(1).split(".")[0] in PDF_LIBRARY_NAMES:
                offenders.append(f"{path}: {line.strip()}")
    assert offenders == []
