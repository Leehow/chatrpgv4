# tests/test_runtime_no_exa_dependency.py
from pathlib import Path
import re

# "exa" uses a word boundary so integrity hashes / "exactly" / "Exact" do not false-positive.
FORBIDDEN = (
    (re.compile(r"\bexa\b", re.IGNORECASE), "exa"),
    (re.compile(r"web_search_exa", re.IGNORECASE), "web_search_exa"),
    (re.compile(r"mcp\.exa\.ai", re.IGNORECASE), "mcp.exa.ai"),
)


def test_runtime_tree_has_no_exa_vendor_strings():
    root = Path("runtime")
    assert root.is_dir()
    hits = []
    for path in root.rglob("*"):
        if path.is_dir():
            continue
        if "node_modules" in path.parts:
            continue
        if path.suffix.lower() not in {".py", ".md", ".json", ".mjs", ".ts", ".js", ".txt"}:
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        for pattern, token in FORBIDDEN:
            if pattern.search(text):
                hits.append(f"{path}: {token}")
    assert hits == [], hits
