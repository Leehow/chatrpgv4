"""Tests for tests/play/bundle_from_pages.py, the host-side §14.2 bundler.

This is the tool the lead will run to hand a real PDF (already read into
Markdown pages by an external host skill) to `module.bind`. It never opens a
PDF itself -- these tests only ever feed it `NNNN.md` files -- and it must be
a pure, deterministic function of those bytes: build twice, get the same
manifest; edit a page, break only that page's sha256.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

import bundle_from_pages as bp

SCRIPT = Path(__file__).resolve().parent / "bundle_from_pages.py"


def write_pages(dir_: Path, pages: list[str]) -> None:
    dir_.mkdir(parents=True, exist_ok=True)
    for index, text in enumerate(pages):
        (dir_ / f"{index:04d}.md").write_text(text, encoding="utf-8")


GOOD_PAGES = [
    "# 引子\n\n红灯笼茶馆的故事从这里开始。\n",
    "## 第一场：茶馆前厅\n\n老板娘正在擦拭桌子。\n",
    "空页测试。",
]


def base_kwargs(**overrides):
    kwargs = dict(
        producer="test-harness",
        title="红灯笼茶馆",
        slug="red-lantern-teahouse",
        language="zh-Hans",
        file_sha256="0" * 64,
        filename="red-lantern-teahouse.pdf",
    )
    kwargs.update(overrides)
    return kwargs


# ---- manifest shape -----------------------------------------------------------


def test_manifest_has_contract_identity_and_source(tmp_path):
    pages_dir = tmp_path / "pages"
    write_pages(pages_dir, GOOD_PAGES)
    manifest = bp.build_manifest(pages_dir, **base_kwargs())

    assert manifest["contract"] == "coc.pdf-bundle.v1"
    assert manifest["producer"] == "test-harness"
    assert manifest["module_identity"] == {"title": "红灯笼茶馆", "slug": "red-lantern-teahouse", "language": "zh-Hans"}
    assert manifest["source"] == {"file_sha256": "0" * 64, "page_count": 3, "filename": "red-lantern-teahouse.pdf"}
    assert [p["pdf_index"] for p in manifest["pages"]] == [0, 1, 2]
    assert [p["path"] for p in manifest["pages"]] == ["pages/0000.md", "pages/0001.md", "pages/0002.md"]
    for entry, text in zip(manifest["pages"], GOOD_PAGES):
        assert entry["chars"] == len(text)
        assert len(entry["sha256"]) == 64


def test_optional_authors_and_edition_only_present_when_given(tmp_path):
    pages_dir = tmp_path / "pages"
    write_pages(pages_dir, GOOD_PAGES)
    bare = bp.build_manifest(pages_dir, **base_kwargs())
    assert "authors" not in bare["module_identity"]
    assert "edition" not in bare["module_identity"]

    full = bp.build_manifest(pages_dir, **base_kwargs(authors="佚名", edition="初版"))
    assert full["module_identity"]["authors"] == "佚名"
    assert full["module_identity"]["edition"] == "初版"


def test_outline_collects_headings_in_page_and_document_order(tmp_path):
    pages_dir = tmp_path / "pages"
    write_pages(pages_dir, GOOD_PAGES)
    manifest = bp.build_manifest(pages_dir, **base_kwargs())
    assert manifest["outline"] == [
        {"title": "引子", "level": 1, "pdf_index": 0},
        {"title": "第一场：茶馆前厅", "level": 2, "pdf_index": 1},
    ]


def test_no_outline_key_when_no_headings(tmp_path):
    pages_dir = tmp_path / "pages"
    write_pages(pages_dir, ["纯文本，没有标题。\n", "第二页也没有。\n"])
    manifest = bp.build_manifest(pages_dir, **base_kwargs())
    assert "outline" not in manifest


# ---- page discipline -----------------------------------------------------------


def test_empty_page_is_allowed_and_hashed(tmp_path):
    pages_dir = tmp_path / "pages"
    write_pages(pages_dir, ["第一页。\n", "", "第三页。\n"])
    manifest = bp.build_manifest(pages_dir, **base_kwargs())
    assert manifest["pages"][1]["chars"] == 0
    assert manifest["pages"][1]["sha256"] == bp.sha256_bytes(b"")


def test_non_contiguous_pages_are_rejected(tmp_path):
    pages_dir = tmp_path / "pages"
    write_pages(pages_dir, ["a", "b"])
    (pages_dir / "0001.md").unlink()
    (pages_dir / "0002.md").write_text("c", encoding="utf-8")
    with pytest.raises(ValueError, match="contiguous"):
        bp.build_manifest(pages_dir, **base_kwargs())


def test_pages_must_start_at_zero(tmp_path):
    pages_dir = tmp_path / "pages"
    write_pages(pages_dir, ["a"])
    (pages_dir / "0000.md").rename(pages_dir / "0001.md")
    with pytest.raises(ValueError, match="contiguous"):
        bp.build_manifest(pages_dir, **base_kwargs())


def test_no_pages_is_rejected(tmp_path):
    pages_dir = tmp_path / "pages"
    pages_dir.mkdir()
    with pytest.raises(ValueError, match="no NNNN.md pages"):
        bp.build_manifest(pages_dir, **base_kwargs())


def test_non_page_files_are_ignored(tmp_path):
    pages_dir = tmp_path / "pages"
    write_pages(pages_dir, GOOD_PAGES)
    (pages_dir / "README.md").write_text("not a page", encoding="utf-8")
    (pages_dir / "notes.txt").write_text("not a page", encoding="utf-8")
    manifest = bp.build_manifest(pages_dir, **base_kwargs())
    assert manifest["source"]["page_count"] == 3


# ---- assets: never guess kind/pages ---------------------------------------------


def test_asset_without_meta_entry_is_refused(tmp_path):
    pages_dir = tmp_path / "pages"
    write_pages(pages_dir, GOOD_PAGES)
    assets_dir = tmp_path / "assets"
    assets_dir.mkdir()
    (assets_dir / "map.png").write_bytes(b"\x89PNG-fake-bytes")
    with pytest.raises(ValueError, match="asset-meta"):
        bp.build_manifest(pages_dir, **base_kwargs(assets_dir=assets_dir, asset_meta={}))


def test_asset_with_meta_is_hashed_and_typed(tmp_path):
    pages_dir = tmp_path / "pages"
    write_pages(pages_dir, GOOD_PAGES)
    assets_dir = tmp_path / "assets"
    assets_dir.mkdir()
    data = b"\x89PNG-fake-bytes"
    (assets_dir / "map.png").write_bytes(data)
    manifest = bp.build_manifest(pages_dir, **base_kwargs(
        assets_dir=assets_dir,
        asset_meta={"map.png": {"id": "teahouse-map", "kind": "map", "pages": [1]}},
    ))
    assert manifest["assets"] == [{
        "id": "teahouse-map", "kind": "map", "pages": [1], "path": "assets/map.png",
        "sha256": bp.sha256_bytes(data), "media_type": "image/png",
    }]


def test_no_assets_key_when_assets_dir_absent(tmp_path):
    pages_dir = tmp_path / "pages"
    write_pages(pages_dir, GOOD_PAGES)
    manifest = bp.build_manifest(pages_dir, **base_kwargs())
    assert "assets" not in manifest


# ---- determinism, write_bundle, verify_bundle -----------------------------------


def test_write_bundle_is_deterministic_byte_for_byte(tmp_path):
    pages_dir = tmp_path / "pages"
    write_pages(pages_dir, GOOD_PAGES)
    first = bp.write_bundle(pages_dir, tmp_path / "bundle-a", **base_kwargs())
    second = bp.write_bundle(pages_dir, tmp_path / "bundle-b", **base_kwargs())
    assert first.read_bytes() == second.read_bytes()


def test_write_bundle_copies_pages_and_verify_bundle_is_clean(tmp_path):
    pages_dir = tmp_path / "pages"
    write_pages(pages_dir, GOOD_PAGES)
    bundle_dir = tmp_path / "bundle"
    bp.write_bundle(pages_dir, bundle_dir, **base_kwargs())

    for index in range(len(GOOD_PAGES)):
        assert (bundle_dir / "pages" / f"{index:04d}.md").is_file()
    assert bp.verify_bundle(bundle_dir) == []


def test_editing_a_page_after_bundling_breaks_only_that_shas(tmp_path):
    pages_dir = tmp_path / "pages"
    write_pages(pages_dir, GOOD_PAGES)
    bundle_dir = tmp_path / "bundle"
    bp.write_bundle(pages_dir, bundle_dir, **base_kwargs())
    assert bp.verify_bundle(bundle_dir) == []

    (bundle_dir / "pages" / "0001.md").write_text("被人偷偷改过的一页。\n", encoding="utf-8")
    problems = bp.verify_bundle(bundle_dir)
    assert problems and all("pages/0001.md" in p for p in problems)
    assert any("sha256 mismatch" in p for p in problems)


def test_editing_a_page_to_the_same_length_still_breaks_only_its_sha(tmp_path):
    """Same char count, different content: only sha256 (not chars) should flag it,
    and only for the edited page."""
    pages_dir = tmp_path / "pages"
    write_pages(pages_dir, GOOD_PAGES)
    bundle_dir = tmp_path / "bundle"
    bp.write_bundle(pages_dir, bundle_dir, **base_kwargs())

    original = (bundle_dir / "pages" / "0002.md").read_text(encoding="utf-8")
    assert len(original) == len("空页测试。")
    (bundle_dir / "pages" / "0002.md").write_text("换个内容试", encoding="utf-8")
    problems = bp.verify_bundle(bundle_dir)
    assert problems == [
        f"sha256 mismatch for pages/0002.md: manifest={bp.sha256_bytes(original.encode('utf-8'))} "
        f"actual={bp.sha256_bytes('换个内容试'.encode('utf-8'))}"
    ]


def test_editing_source_pages_after_the_fact_does_not_retroactively_change_a_built_bundle(tmp_path):
    """Editing the *source* pages_dir after the bundle was written must not affect the
    already-written bundle -- the bundle is a copy, not a link, so re-verifying the
    bundle still passes."""
    pages_dir = tmp_path / "pages"
    write_pages(pages_dir, GOOD_PAGES)
    bundle_dir = tmp_path / "bundle"
    bp.write_bundle(pages_dir, bundle_dir, **base_kwargs())

    (pages_dir / "0001.md").write_text("source edited after bundling", encoding="utf-8")
    assert bp.verify_bundle(bundle_dir) == []


def test_verify_bundle_catches_a_missing_page_file(tmp_path):
    pages_dir = tmp_path / "pages"
    write_pages(pages_dir, GOOD_PAGES)
    bundle_dir = tmp_path / "bundle"
    bp.write_bundle(pages_dir, bundle_dir, **base_kwargs())
    (bundle_dir / "pages" / "0002.md").unlink()
    problems = bp.verify_bundle(bundle_dir)
    assert any("missing page file pages/0002.md" in p for p in problems)


def test_verify_bundle_catches_a_tampered_asset(tmp_path):
    pages_dir = tmp_path / "pages"
    write_pages(pages_dir, GOOD_PAGES)
    assets_dir = tmp_path / "assets"
    assets_dir.mkdir()
    (assets_dir / "map.png").write_bytes(b"original bytes")
    bundle_dir = tmp_path / "bundle"
    bp.write_bundle(pages_dir, bundle_dir, **base_kwargs(
        assets_dir=assets_dir, asset_meta={"map.png": {"kind": "map", "pages": [1]}},
    ))
    assert bp.verify_bundle(bundle_dir) == []

    (bundle_dir / "assets" / "map.png").write_bytes(b"tampered bytes")
    problems = bp.verify_bundle(bundle_dir)
    assert any("sha256 mismatch for asset assets/map.png" in p for p in problems)


def test_verify_bundle_reports_missing_manifest(tmp_path):
    empty_dir = tmp_path / "nothing-here"
    empty_dir.mkdir()
    problems = bp.verify_bundle(empty_dir)
    assert len(problems) == 1 and "manifest.json" in problems[0]


# ---- CLI wiring ------------------------------------------------------------------


def test_cli_build_then_verify_round_trip(tmp_path):
    pages_dir = tmp_path / "pages"
    write_pages(pages_dir, GOOD_PAGES)
    bundle_dir = tmp_path / "bundle"

    build = subprocess.run(
        [sys.executable, str(SCRIPT), str(pages_dir), "--out", str(bundle_dir),
         "--producer", "test-harness", "--title", "红灯笼茶馆", "--slug", "red-lantern-teahouse",
         "--language", "zh-Hans", "--file-sha256", "0" * 64, "--filename", "red-lantern-teahouse.pdf"],
        capture_output=True, text=True, cwd=tmp_path,
    )
    assert build.returncode == 0, build.stderr
    assert (bundle_dir / "manifest.json").is_file()

    verify_ok = subprocess.run(
        [sys.executable, str(SCRIPT), "--verify", "--out", str(bundle_dir)],
        capture_output=True, text=True,
    )
    assert verify_ok.returncode == 0
    assert verify_ok.stderr == ""

    (bundle_dir / "pages" / "0000.md").write_text("tampered", encoding="utf-8")
    verify_bad = subprocess.run(
        [sys.executable, str(SCRIPT), "--verify", "--out", str(bundle_dir)],
        capture_output=True, text=True,
    )
    assert verify_bad.returncode == 1
    assert "sha256 mismatch" in verify_bad.stderr


def test_cli_reports_missing_required_arguments(tmp_path):
    pages_dir = tmp_path / "pages"
    write_pages(pages_dir, GOOD_PAGES)
    result = subprocess.run(
        [sys.executable, str(SCRIPT), str(pages_dir), "--out", str(tmp_path / "bundle")],
        capture_output=True, text=True,
    )
    assert result.returncode == 2
    assert "missing required argument" in result.stderr


def test_manifest_is_valid_json_with_sorted_keys_on_disk(tmp_path):
    pages_dir = tmp_path / "pages"
    write_pages(pages_dir, GOOD_PAGES)
    bundle_dir = tmp_path / "bundle"
    manifest_path = bp.write_bundle(pages_dir, bundle_dir, **base_kwargs())
    raw = manifest_path.read_text(encoding="utf-8")
    parsed = json.loads(raw)
    assert parsed["contract"] == "coc.pdf-bundle.v1"
    # sort_keys=True was used to write it; re-dumping the parsed object the same way
    # must reproduce the file byte-for-byte (proves no key ordering nondeterminism).
    reserialized = json.dumps(parsed, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    assert reserialized == raw
