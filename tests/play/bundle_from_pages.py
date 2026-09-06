#!/usr/bin/env python3
"""Forwarding shim: the packer moved to `bin/coc-bundle` (contract §14.2, §20.3), on
the product path -- `extensions/module/ingest.ts` spawns it directly. This module
re-exports its library API and CLI unchanged, so `tests/play/test_bundle_tool.py`
and the playtest scripts that import `bundle_from_pages` (or run this file as a
script) keep working without touching their own imports.

`bin/coc-bundle` has no `.py` suffix (it is spawned directly, not via
`python -m`), so it is loaded here by path rather than by a normal `import`.
"""
from __future__ import annotations

import importlib.machinery
import importlib.util
import sys
from pathlib import Path

_TARGET = Path(__file__).resolve().parents[2] / "bin" / "coc-bundle"
# `bin/coc-bundle` has no `.py` suffix (it is spawned directly, not `python -m`ed),
# so the loader has to be named explicitly -- `spec_from_file_location` alone cannot
# infer a source loader from an extension-less path.
_loader = importlib.machinery.SourceFileLoader("coc_bundle_tool", str(_TARGET))
_spec = importlib.util.spec_from_file_location("coc_bundle_tool", _TARGET, loader=_loader)
if _spec is None or _spec.loader is None:
    raise ImportError(f"could not load the packer at {_TARGET}")
_coc_bundle = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_coc_bundle)

# ---- re-exported library API (verbatim; the real thing lives in bin/coc-bundle) -----

CONTRACT = _coc_bundle.CONTRACT
PAGE_RE = _coc_bundle.PAGE_RE
HEADING_RE = _coc_bundle.HEADING_RE
sha256_bytes = _coc_bundle.sha256_bytes
slugify = _coc_bundle.slugify
discover_pages = _coc_bundle.discover_pages
build_manifest = _coc_bundle.build_manifest
write_bundle = _coc_bundle.write_bundle
verify_bundle = _coc_bundle.verify_bundle
main = _coc_bundle.main


if __name__ == "__main__":
    sys.exit(main())
