"""§14.1–14.2: the module store, starter registration, and byte-level bundle binding."""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
from pathlib import Path

from conftest import CONTENT_DIR, KERNEL_DIR, MODULE, WORKTREE, RpcClient, read_json
from module_helpers import BUNDLE_TINY, TINY_ID, bind_tiny, copy_bundle, module_dir

PDF_LIBRARIES = re.compile(r"^\s*(?:import|from)\s+(?:pypdf|PyPDF2|pdfplumber|fitz|pymupdf|pdfminer)\b", re.M)


def test_no_pdf_library_is_imported_under_kernel():
    offenders = []
    for path in KERNEL_DIR.rglob("*.py"):
        if PDF_LIBRARIES.search(path.read_text(encoding="utf-8")):
            offenders.append(str(path.relative_to(WORKTREE)))
    assert offenders == [], offenders


def test_bind_accepts_the_tiny_bundle_and_lays_out_the_store(kernel: RpcClient, tmp_path: Path):
    result = bind_tiny(kernel, tmp_path)
    assert result == {"module_id": TINY_ID, "page_count": 4, "assets": 1}
    root = module_dir(kernel.workspace)
    meta = read_json(root / "module.json")
    assert meta["status"] == "registered" and meta["source"] == "pdf" and meta["generation"] == 0
    assert meta["title"] == "灰鹭码头的雾" and meta["languages"] == ["zh-Hans"] and meta["page_count"] == 4
    assert re.fullmatch(r"[0-9a-f]{64}", meta["bundle_sha256"])
    assert (root / "bundle" / "manifest.json").exists()
    assert sorted(p.name for p in (root / "bundle" / "pages").iterdir()) == ["0000.md", "0001.md", "0002.md", "0003.md"]
    assert (root / "bundle" / "assets" / "map-dock.png").read_bytes() == (BUNDLE_TINY / "assets" / "map-dock.png").read_bytes()
    registry = read_json(root / "assets.json")
    assert [a["id"] for a in registry["assets"]] == ["map-dock"]
    assert registry["assets"][0]["visibility"] == "keeper-only" and registry["assets"][0]["kind"] == "map"
    status = kernel.ok("module.status", {"module_id": TINY_ID})
    assert status["status"] == "registered" and status["opening_ready"] is False
    assert kernel.ok("module.list", {})["modules"][0]["module_id"] == TINY_ID


def test_bind_is_idempotent_for_the_same_bundle(kernel: RpcClient, tmp_path: Path):
    first = bind_tiny(kernel, tmp_path)
    again = kernel.ok("module.bind", {"bundle": str(tmp_path / "bundle")})
    assert again["replayed"] is True and again["module_id"] == first["module_id"]


def test_bind_rejects_a_tampered_page_with_details_pages(kernel: RpcClient, tmp_path: Path):
    bundle = copy_bundle(tmp_path)
    page = bundle / "pages" / "0002.md"
    page.write_text(page.read_text(encoding="utf-8") + "\n守秘人偷偷加了一句。\n", encoding="utf-8")
    error = kernel.err("module.bind", {"bundle": str(bundle)})
    assert error["code"] == "invalid_params"
    bad = error["details"]["pages"]
    assert [(row["pdf_index"], row["code"]) for row in bad] == [(2, "sha256_mismatch")]
    assert bad[0]["actual"] == hashlib.sha256(page.read_bytes()).hexdigest()
    assert not module_dir(kernel.workspace).exists(), "a failed bind must write nothing"


def test_bind_rejects_a_missing_page_and_a_wrong_page_count(kernel: RpcClient, tmp_path: Path):
    bundle = copy_bundle(tmp_path)
    (bundle / "pages" / "0003.md").unlink()
    manifest = read_json(bundle / "manifest.json")
    manifest["source"]["page_count"] = 9
    (bundle / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
    error = kernel.err("module.bind", {"bundle": str(bundle)})
    codes = {row["code"] for row in error["details"]["pages"]}
    assert codes == {"missing_page_file", "page_count_mismatch"}


def test_bind_rejects_a_non_contiguous_manifest(kernel: RpcClient, tmp_path: Path):
    bundle = copy_bundle(tmp_path)
    manifest = read_json(bundle / "manifest.json")
    manifest["pages"] = [row for row in manifest["pages"] if row["pdf_index"] != 1]
    manifest["source"]["page_count"] = 3
    (bundle / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
    error = kernel.err("module.bind", {"bundle": str(bundle)})
    codes = sorted(row["code"] for row in error["details"]["pages"])
    assert "page_missing_from_manifest" in codes and "page_out_of_sequence" in codes


def test_bind_rejects_a_tampered_asset(kernel: RpcClient, tmp_path: Path):
    bundle = copy_bundle(tmp_path)
    (bundle / "assets" / "map-dock.png").write_bytes(b"not a png at all")
    error = kernel.err("module.bind", {"bundle": str(bundle)})
    assert error["details"]["pages"] == []
    assert [row["code"] for row in error["details"]["assets"]] == ["asset_not_an_image"]


def test_bind_refuses_a_second_bundle_under_the_same_id(kernel: RpcClient, tmp_path: Path):
    bind_tiny(kernel, tmp_path)
    other = copy_bundle(tmp_path, "other")
    page = other / "pages" / "0000.md"
    text = page.read_text(encoding="utf-8") + "\n第二版。\n"
    page.write_text(text, encoding="utf-8")
    manifest = read_json(other / "manifest.json")
    manifest["pages"][0]["sha256"] = hashlib.sha256(text.encode("utf-8")).hexdigest()
    manifest["pages"][0]["chars"] = len(text)
    (other / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
    error = kernel.err("module.bind", {"bundle": str(other)})
    assert error["code"] == "invalid_params" and "different bundle" in error["message"]
    assert kernel.ok("module.bind", {"bundle": str(other), "module_id": "grey-heron-dock-2"})["module_id"] == "grey-heron-dock-2"


def test_starter_registration_copies_the_graph_and_installs_it(kernel: RpcClient):
    result = kernel.ok("module.register", {"module_id": MODULE})
    assert result["status"] == "installed" and result["generation"] == 1
    root = module_dir(kernel.workspace, MODULE)
    source = CONTENT_DIR / "starters" / MODULE / "module-graph.json"
    assert (root / "module-graph.json").read_bytes() == source.read_bytes()
    manifest = read_json(root / "module-graph-manifest.json")
    assert manifest["graph_content_digest"] == hashlib.sha256(
        json.dumps(read_json(source), ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    meta = read_json(root / "module.json")
    assert meta["source"] == "starter" and meta["title"] == "The Haunting" and meta["graph_digest"] == result["graph_digest"]
    assert meta["playability"]["measures"]["scenes"] == 12
    # The curated starter's own gaps are reported, not hidden: two actors in no scene,
    # pacing beats and concepts without a page. Starters install by contract regardless.
    assert set(meta["playability"]["finding_counts"]) == {"actor_in_no_scene", "node_without_page"}
    assert meta["opening_ready"] is True
    again = kernel.ok("module.register", {"module_id": MODULE})
    assert again["generation"] == 1, "re-registering the same content graph is a no-op"
    status = kernel.ok("module.status", {"module_id": MODULE})
    assert status["opening_ready"] is True and status["sections"]["total"] == 0
    assert kernel.err("module.register", {"module_id": "no-such-starter"})["code"] == "invalid_params"


def test_unknown_module_is_invalid_params_with_the_inventory(kernel: RpcClient, tmp_path: Path):
    bind_tiny(kernel, tmp_path)
    error = kernel.err("module.status", {"module_id": "nope"})
    assert error["code"] == "invalid_params" and error["details"]["modules"] == [TINY_ID]


def test_evidence_and_review_clis_run_from_the_work_directory(kernel: RpcClient, tmp_path: Path):
    from module_helpers import packet_for, plan_whole_book, reader_shard, write_shard
    bind_tiny(kernel, tmp_path)
    section_id = plan_whole_book(kernel)
    packet, work_dir = packet_for(kernel, section_id)
    write_shard(work_dir, reader_shard(packet))

    def run(*args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run([str(WORKTREE / "bin" / args[0]), *args[1:]], cwd=work_dir,
                              capture_output=True, text=True, check=False)

    search = run("coc-evidence", "search", "老周")
    assert search.returncode == 0 and "span-p1-4" in search.stdout and "五十三岁" in search.stdout
    verify = run("coc-evidence", "verify", "span-p1-4,span-p9-1")
    assert verify.returncode == 1 and json.loads(verify.stdout)["unknown"] == ["span-p9-1"]
    page = run("coc-evidence", "page", "3")
    assert page.returncode == 0 and "附录" in page.stdout
    beyond = run("coc-evidence", "page", "9")
    assert beyond.returncode == 1
    review = run("coc-review", "--module", TINY_ID, "--section", section_id)
    assert review.returncode == 0, review.stdout + review.stderr
    assert json.loads(review.stdout)["accepted"] is True
