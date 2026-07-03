import json
from pathlib import Path


PLUGIN_ROOT = Path("plugins/coc-keeper")


def test_plugin_manifest_declares_coc_keeper_skill_plugin():
    manifest_path = PLUGIN_ROOT / ".codex-plugin" / "plugin.json"
    assert manifest_path.exists()

    manifest = json.loads(manifest_path.read_text())
    assert manifest["name"] == "coc-keeper"
    assert manifest["version"] == "0.1.0"
    assert manifest["skills"] == "./skills/"
    assert manifest["interface"]["displayName"] == "COC Keeper"
    assert "Call of Cthulhu" in manifest["description"]
