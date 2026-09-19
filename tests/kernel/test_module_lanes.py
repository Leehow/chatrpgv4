"""Published starter assets retain their names, bytes and visibility."""
import json
from pathlib import Path
from shutil import copytree

from conftest import MODULE, RpcClient


def test_starter_assets_come_from_the_graph(kernel: RpcClient):
    from coc.modules.store import ModuleStore
    kernel.ok("module.register", {"module_id": MODULE})
    store = ModuleStore(kernel.workspace)
    assets = store.assets(MODULE)
    assert len(assets) == 30 and {a["kind"] for a in assets} <= {"handout", "map", "illustration"}
    handout = store.asset(MODULE, "Handout 2: Unpublished Boston Globe Story (1918)")
    assert handout is not None and handout["visibility"] == "player-safe" and handout["kind"] == "handout"
    assert handout["authored_text"].startswith("BOSTON GLOBE") and handout["node_id"] == "handout-globe-unpublished-1918"
    assert store.asset(MODULE, "globe-unpublished-1918") == handout
    keeper_only = kernel.ok("module.asset", {"module_id": MODULE, "name": "Bed attack illustration"})
    assert keeper_only["player_visible"] is False and keeper_only["asset"]["visibility"] == "keeper-only"
    assert keeper_only["asset"]["pages"] == [454]


def test_replayed_starter_registration_publishes_late_local_asset_bytes_with_the_graph(kernel: RpcClient):
    first = kernel.ok("module.register", {"module_id": MODULE})
    generation = first["generation"]
    missing = kernel.ok("module.asset", {"module_id": MODULE, "name": "Corbitt House Investigator Map"})
    assert missing["asset"]["path"] is None

    shared = kernel.workspace / ".coc" / "modules" / MODULE
    private = kernel.workspace / ".coc" / "module-campaigns" / "existing-campaign" / "modules" / MODULE
    copytree(shared, private)
    private_meta = json.loads((private / "module.json").read_text(encoding="utf-8"))
    private_meta.update(campaign_scope="existing-campaign", source_generation=generation)
    (private / "module.json").write_text(json.dumps(private_meta), encoding="utf-8")

    root = (kernel.workspace / ".coc" / "module-assets" /
            "the-haunting-keeper-rulebook-40th-full-v1")
    source = root / "assets" / "player" / "corbitt-house-investigator-map.png"
    source.parent.mkdir(parents=True)
    source.write_bytes(b"private reviewed map bytes")
    (root / "identity.json").write_text(json.dumps({
        "schema_version": 1,
        "asset_root_id": "the-haunting-keeper-rulebook-40th-full-v1",
        "file_sha256": "a860499cf34b40cac385f51b6e667ab37ec0796c7329494def08c8b161fd71eb",
    }), encoding="utf-8")

    replayed = kernel.ok("module.register", {"module_id": MODULE})
    assert replayed["generation"] == generation
    published = kernel.ok("module.asset", {"module_id": MODULE, "name": "Corbitt House Investigator Map"})
    target = Path(published["asset"]["path"])
    assert target == (kernel.workspace / ".coc" / "modules" / MODULE /
                      "assets" / "player" / "corbitt-house-investigator-map.png")
    assert target.read_bytes() == source.read_bytes()
    assert (private / "assets" / "player" / "corbitt-house-investigator-map.png").read_bytes() == source.read_bytes()
