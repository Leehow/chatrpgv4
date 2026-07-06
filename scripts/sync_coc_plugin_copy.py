#!/usr/bin/env python3
"""Sync the ZCode COC Keeper plugin copy from the Codex plugin source.

`plugins/coc-keeper` is the canonical implementation tree. The ZCode copy keeps
the same runtime files with a small, explicit set of platform differences:
ZCode manifest/package files, no Codex agent metadata, and a few Codex->ZCode
wording substitutions.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


DEFAULT_CODEX_ROOT = Path("plugins/coc-keeper")
DEFAULT_ZCODE_ROOT = Path("plugins/coc-keeper-zcode")

INTENTIONAL_PLATFORM_DRIFT_FILES = {
    "references/mode-protocol.md",
    "references/state-schema.md",
    "scripts/coc_completion_audit.py",
    "scripts/coc_language.py",
    "skills/coc-character/SKILL.md",
    "skills/coc-main/SKILL.md",
    "skills/coc-playtest/SKILL.md",
    "skills/coc-rules-engine/SKILL.md",
}

CODEX_ONLY_SECTION_START = "<!-- CODEX_ONLY_IMAGEGEN_START -->"
CODEX_ONLY_SECTION_END = "<!-- CODEX_ONLY_IMAGEGEN_END -->"

ZCODE_MANIFEST = {
    "name": "coc-keeper",
    "version": "0.1.0",
    "description": (
        "Call of Cthulhu Keeper mode plugin for ZCode with structured rules, "
        "persistent campaign state, and playtest reporting."
    ),
    "author": {
        "name": "Local developer",
    },
    "license": "Apache-2.0",
    "skills": "skills",
}

ZCODE_PACKAGE = {
    "$schema": "https://json.schemastore.org/package.json",
    "name": "@zcode/coc-keeper-plugin",
    "version": "0.1.0",
    "private": True,
    "license": "Apache-2.0",
    "description": "Call of Cthulhu Keeper mode plugin published as a ZCode plugin.",
}


class SyncReport:
    def __init__(self) -> None:
        self.missing: list[str] = []
        self.changed: list[str] = []
        self.extra: list[str] = []

    @property
    def clean(self) -> bool:
        return not (self.missing or self.changed or self.extra)

    def lines(self) -> list[str]:
        lines: list[str] = []
        for label, paths in (
            ("missing", self.missing),
            ("changed", self.changed),
            ("extra", self.extra),
        ):
            for path in paths:
                lines.append(f"{label}: {path}")
        return lines


def _is_ignored_path(rel: Path) -> bool:
    return "__pycache__" in rel.parts or rel.name == ".DS_Store"


def _is_codex_only_path(rel: Path) -> bool:
    return rel.parts[:1] == (".codex-plugin",) or "agents" in rel.parts


def _json_bytes(data: dict) -> bytes:
    return (json.dumps(data, indent=2) + "\n").encode("utf-8")


def _zcode_text_from_codex(text: str) -> str:
    text = _strip_codex_only_sections(text)
    text = text.replace("Codex \u63b7\u9ab0", "AI \u63b7\u9ab0")
    text = text.replace("Codex \u30c0\u30a4\u30b9", "AI \u30c0\u30a4\u30b9")
    return text.replace("Codex", "ZCode")


def _strip_codex_only_sections(text: str) -> str:
    while CODEX_ONLY_SECTION_START in text:
        start = text.index(CODEX_ONLY_SECTION_START)
        end = text.find(CODEX_ONLY_SECTION_END, start)
        if end == -1:
            raise ValueError("unclosed Codex-only section marker")
        end += len(CODEX_ONLY_SECTION_END)
        if end < len(text) and text[end : end + 1] == "\n":
            end += 1
        text = text[:start].rstrip() + "\n\n" + text[end:].lstrip()
    return text


def _expected_files(codex_root: Path) -> dict[str, bytes]:
    expected: dict[str, bytes] = {
        ".zcode-plugin/plugin.json": _json_bytes(ZCODE_MANIFEST),
        "package.json": _json_bytes(ZCODE_PACKAGE),
    }
    for path in sorted(codex_root.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(codex_root)
        if _is_ignored_path(rel) or _is_codex_only_path(rel):
            continue
        rel_name = rel.as_posix()
        if rel_name in INTENTIONAL_PLATFORM_DRIFT_FILES:
            expected[rel_name] = _zcode_text_from_codex(path.read_text(encoding="utf-8")).encode("utf-8")
        else:
            expected[rel_name] = path.read_bytes()
    return expected


def compare_plugin_copies(codex_root: Path = DEFAULT_CODEX_ROOT, zcode_root: Path = DEFAULT_ZCODE_ROOT) -> SyncReport:
    expected = _expected_files(codex_root)
    report = SyncReport()

    for rel_name, content in sorted(expected.items()):
        target = zcode_root / rel_name
        if not target.exists():
            report.missing.append(rel_name)
        elif target.read_bytes() != content:
            report.changed.append(rel_name)

    for path in sorted(zcode_root.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(zcode_root)
        if _is_ignored_path(rel):
            continue
        rel_name = rel.as_posix()
        if rel_name not in expected:
            report.extra.append(rel_name)

    return report


def _remove_empty_dirs(root: Path) -> None:
    for path in sorted((p for p in root.rglob("*") if p.is_dir()), key=lambda p: len(p.parts), reverse=True):
        if path == root or "__pycache__" in path.parts:
            continue
        try:
            path.rmdir()
        except OSError:
            pass


def sync_zcode_copy(codex_root: Path = DEFAULT_CODEX_ROOT, zcode_root: Path = DEFAULT_ZCODE_ROOT) -> None:
    expected = _expected_files(codex_root)
    zcode_root.mkdir(parents=True, exist_ok=True)

    for path in sorted(zcode_root.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(zcode_root)
        if _is_ignored_path(rel):
            continue
        if rel.as_posix() not in expected:
            path.unlink()

    for rel_name, content in sorted(expected.items()):
        target = zcode_root / rel_name
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists() and target.read_bytes() == content:
            continue
        target.write_bytes(content)

    _remove_empty_dirs(zcode_root)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="report drift without writing files")
    parser.add_argument("--codex-root", type=Path, default=DEFAULT_CODEX_ROOT)
    parser.add_argument("--zcode-root", type=Path, default=DEFAULT_ZCODE_ROOT)
    args = parser.parse_args()

    if args.check:
        report = compare_plugin_copies(args.codex_root, args.zcode_root)
        if report.clean:
            print("plugin copies are in sync")
            return 0
        print("plugin copies are out of sync")
        for line in report.lines():
            print(line)
        return 1

    sync_zcode_copy(args.codex_root, args.zcode_root)
    report = compare_plugin_copies(args.codex_root, args.zcode_root)
    if report.clean:
        print("synced ZCode plugin copy from Codex plugin source")
        return 0
    print("sync finished with remaining drift")
    for line in report.lines():
        print(line)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
