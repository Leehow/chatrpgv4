import importlib.util
import json
import shutil
import subprocess
import sys
from pathlib import Path


SCRIPT_PATH = Path("scripts/sync_coc_plugin_copy.py")
CODEX_ROOT = Path("plugins/coc-keeper")
ZCODE_ROOT = Path("plugins/coc-keeper-zcode")


def _load_sync_script():
    spec = importlib.util.spec_from_file_location("sync_coc_plugin_copy", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_sync_script_check_passes_for_current_plugin_copies():
    result = subprocess.run(
        [sys.executable, str(SCRIPT_PATH), "--check"],
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 0, result.stdout + result.stderr
    assert "plugin copies are in sync" in result.stdout


def test_sync_script_repairs_zcode_copy_without_codex_only_artifacts(tmp_path):
    sync_script = _load_sync_script()
    codex_copy = tmp_path / "coc-keeper"
    zcode_copy = tmp_path / "coc-keeper-zcode"
    shutil.copytree(CODEX_ROOT, codex_copy)
    shutil.copytree(ZCODE_ROOT, zcode_copy)

    stale_skill = zcode_copy / "skills" / "coc-keeper-play" / "SKILL.md"
    stale_skill.write_text(stale_skill.read_text() + "\nSTALE ZCODE DRIFT\n")
    stale_rule = zcode_copy / "references" / "rules-json" / "sync-probe.json"
    stale_rule.write_text("{}\n")

    sync_script.sync_zcode_copy(codex_copy, zcode_copy)

    assert not stale_rule.exists()
    assert not (zcode_copy / ".codex-plugin").exists()
    assert not list((zcode_copy / "skills").rglob("openai.yaml"))
    assert not [p for p in (zcode_copy / "skills").iterdir() if (p / "agents").is_dir()]

    manifest = json.loads((zcode_copy / ".zcode-plugin" / "plugin.json").read_text())
    assert manifest["skills"] == "skills"
    assert "interface" not in manifest
    assert "ZCode" in manifest["description"]

    main_skill = (zcode_copy / "skills" / "coc-main" / "SKILL.md").read_text()
    assert "inside ZCode" in main_skill
    assert "ordinary ZCode work" in main_skill
    assert "inside Codex" not in main_skill
    character_skill = (zcode_copy / "skills" / "coc-character" / "SKILL.md").read_text()
    assert "Player-Facing Localization" in character_skill
    assert "Codex-Only Portrait Generation" not in character_skill
    assert "image_gen" not in character_skill
    assert "STALE ZCODE DRIFT" not in stale_skill.read_text()
    assert sync_script.compare_plugin_copies(codex_copy, zcode_copy).clean


def test_sync_script_strips_codex_only_imagegen_sections_from_zcode_text():
    sync_script = _load_sync_script()
    codex_text = """Shared intro.

<!-- CODEX_ONLY_IMAGEGEN_START -->
Codex-only image_gen instructions.
<!-- CODEX_ONLY_IMAGEGEN_END -->

Shared outro for Codex.
"""

    zcode_text = sync_script._zcode_text_from_codex(codex_text)

    assert "image_gen" not in zcode_text
    assert "CODEX_ONLY_IMAGEGEN" not in zcode_text
    assert "Shared intro." in zcode_text
    assert "Shared outro for ZCode." in zcode_text
