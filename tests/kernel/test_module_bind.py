"""PDF processing stays on the host; published starter registration stays available."""
import hashlib, json, re
from pathlib import Path
from conftest import CONTENT_DIR, KERNEL_DIR, MODULE, WORKTREE, RpcClient, read_json

def module_dir(workspace, module_id):
    return workspace / ".coc/modules" / module_id

PDF_LIBRARIES = re.compile(r"^\s*(?:import|from)\s+(?:pypdf|PyPDF2|pdfplumber|fitz|pymupdf|pdfminer)\b", re.M)

def test_no_pdf_library_is_imported_under_kernel():
    offenders = []
    for path in KERNEL_DIR.rglob("*.py"):
        if PDF_LIBRARIES.search(path.read_text(encoding="utf-8")):
            offenders.append(str(path.relative_to(WORKTREE)))
    assert offenders == [], offenders


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
    # §14.16: the starter keeps its own status shape and says which window of which book it reads.
    assert status["source"] == "starter" and status["source_window"]["pages"] == [446, 462]
    assert status["reading"] == {"state": "ready", "index_complete": True, "sections": 12}
    assert kernel.err("module.register", {"module_id": "no-such-starter"})["code"] == "invalid_params"
