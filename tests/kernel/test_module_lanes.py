"""Published starter assets retain their names and visibility."""
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
