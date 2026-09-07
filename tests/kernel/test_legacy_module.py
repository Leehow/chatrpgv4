"""Published legacy material stays usable without the retired source builder."""
import shutil
import json
from pathlib import Path

from coc.modules.assets import registry_from_graph


def test_legacy_graph_and_assets_open_without_text_bundles_or_an_original_pdf(kernel):
    source = Path(__file__).parent / "fixtures/legacy-module"
    target = kernel.workspace / ".coc/modules/grey-heron-dock"
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source, target)
    assert not (target / "source.pdf").exists()
    assert not (target / "bundle/pages").exists()
    status = kernel.ok("module.status", {"module_id": "grey-heron-dock"})
    assert status["opening_ready"] is True
    for name in ("dock-map", "asset-dock-map", "map-dock"):
        asset = kernel.ok("module.asset", {"module_id": "grey-heron-dock", "name": name})
        assert asset["player_visible"] is True
        assert Path(asset["asset"]["path"]).read_bytes() == (source / "bundle/assets/map-dock.png").read_bytes()
    kernel.ok("campaign.create", {"id": "c1", "module": "grey-heron-dock", "play_language": "en"})
    kernel.ok("setup.investigator", {"campaign": "c1", "name": "Ada", "occupation": "Journalist"})
    kernel.ok("setup.complete", {"campaign": "c1"})
    assert kernel.table("open")["scene"]["name"] == "dock-teahouse"
    error = kernel.err("module.read.request", {"module_id": "grey-heron-dock", "purpose": "detail",
        "focus": "dock-teahouse", "question": "What does the original page say about the north door?"})
    assert error["details"]["reason"] == "needs_source"


def test_a_new_visual_region_preserves_legacy_asset_names_and_uses_its_actual_media_type():
    source = Path(__file__).parent / "fixtures/legacy-module"
    graph = json.loads((source / "module-graph.json").read_text())
    previous = json.loads((source / "assets.json").read_text())["assets"]
    previous[0]["media_type"] = "image/jpeg"
    node = next(n for n in graph["nodes"] if n["node_id"] == "asset-dock-map")
    node["properties"].update(image_sources=[{"page": 4}], asset_ref="work/new-region.png", media_type="image/png")
    entry = registry_from_graph(graph, previous)["assets"][0]
    assert entry["bundle_asset_id"] == "map-dock"
    assert entry["path"] == "work/new-region.png" and entry["media_type"] == "image/png"
