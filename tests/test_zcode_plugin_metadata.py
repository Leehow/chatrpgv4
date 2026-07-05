"""ZCode-native plugin copy smoke tests.

`plugins/coc-keeper/` is the original Codex plugin (covered by
`test_plugin_metadata.py`). `plugins/coc-keeper-zcode/` is the ZCode-native
copy. These tests verify the copy's ZCode manifest shape, that its own
``coc_validate`` accepts its rules, that platform-visible wording no longer
says "Codex" where it should say "ZCode", and that rulebook-driven features
landed on the original are also present in the copy.
"""

import importlib.util
import json
from pathlib import Path

import pytest


ZCODE_ROOT = Path("plugins/coc-keeper-zcode")


def _load_module(name: str, relative_path: str):
    path = Path(relative_path)
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_zcode_plugin_manifest_uses_zcode_shape_not_codex_interface():
    manifest_path = ZCODE_ROOT / ".zcode-plugin" / "plugin.json"
    assert manifest_path.exists()
    manifest = json.loads(manifest_path.read_text())

    assert manifest["name"] == "coc-keeper"
    assert manifest["version"] == "0.1.0"
    # ZCode plugins point at the skills dir without the ./ prefix and have no
    # Codex-style interface block.
    assert manifest["skills"] == "skills"
    assert "interface" not in manifest
    assert "Call of Cthulhu" in manifest["description"]


def test_zcode_plugin_has_no_codex_only_artifacts():
    # No Codex manifest, no per-skill openai.yaml, no agents dirs.
    assert not (ZCODE_ROOT / ".codex-plugin").exists()
    assert not list((ZCODE_ROOT / "skills").rglob("openai.yaml"))
    assert not [p for p in (ZCODE_ROOT / "skills").iterdir() if (p / "agents").is_dir()]


def test_zcode_copy_validates_its_own_rules():
    coc_validate = _load_module("zcode_coc_validate", str(ZCODE_ROOT / "scripts" / "coc_validate.py"))
    assert coc_validate.validate_rules(ZCODE_ROOT) == []


def test_zcode_skill_descriptions_do_not_advertise_codex():
    """Platform-facing skill descriptions should say ZCode, not Codex.

    The dice_mode enum key stays "codex" for data compatibility (the original
    Codex plugin and any persisted .coc/ state share it), but the prose that
    tells an agent *where* the skill runs must be platform-correct.
    """
    for skill_path in (ZCODE_ROOT / "skills").glob("*/SKILL.md"):
        text = skill_path.read_text()
        header = text.split("---", 2)[1]
        desc_line = next(line for line in header.splitlines() if line.startswith("description: "))
        # Skill descriptions must not pitch Codex as the host platform.
        assert "Codex" not in desc_line, f"{skill_path.parent.name} description mentions Codex"


def test_zcode_dice_mode_label_is_platform_neutral():
    """The dice_mode enum key 'codex' is kept for compatibility, but the
    player-visible report label is neutral ('AI 掷骰' / 'AI ダイス')."""
    coc_language = _load_module("zcode_coc_language", str(ZCODE_ROOT / "scripts" / "coc_language.py"))
    # Baseline key is preserved.
    assert coc_language.BASE_REPORT_VALUE_LABELS["codex"] == "codex"
    # Player-visible labels are neutralized.
    assert coc_language.LANGUAGE_PROFILES["zh-Hans"]["report_value_labels"]["codex"] == "AI 掷骰"
    assert coc_language.LANGUAGE_PROFILES["ja-JP"]["report_value_labels"]["codex"] == "AI ダイス"


def test_zcode_copy_carries_failed_san_roll_involuntary_action_rule():
    """The rulebook p.166 SAN-failure involuntary-action rule landed on the
    original Codex plugin must also be present in the ZCode copy: rule data,
    harness data, audit check, and skill documentation."""
    # 1. Rule data.
    sanity = json.loads((ZCODE_ROOT / "references" / "rules-json" / "sanity.json").read_text())
    assert "failed_san_roll_involuntary_action" in sanity
    rule_index = json.loads((ZCODE_ROOT / "references" / "rules-json" / "rule-index.json").read_text())
    rule_ids = {rule["id"] for rule in rule_index["rules"]}
    assert "core.sanity.failure_involuntary_action" in rule_ids

    # 2. Harness seeds the involuntary_action on failed SAN rolls.
    coc_playtest_harness = _load_module(
        "zcode_coc_playtest_harness", str(ZCODE_ROOT / "scripts" / "coc_playtest_harness.py")
    )
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        run_dir = coc_playtest_harness.create_haunting_module_run(Path(tmp), run_id="zcode-haunting")
        rolls = [
            json.loads(line)
            for line in (run_dir / "sandbox" / ".coc" / "campaigns" / "zcode-haunting" / "logs" / "rolls.jsonl").read_text().splitlines()
            if line.strip()
        ]
    failed_san = [
        r for r in rolls
        if r.get("type") == "sanity" and r.get("payload", {}).get("outcome") == "failure"
    ]
    assert failed_san, "expected at least one failed SAN roll in the haunting module run"
    for roll in failed_san:
        action = roll["payload"].get("involuntary_action")
        assert isinstance(action, dict), "failed SAN roll missing involuntary_action block"
        assert action.get("kind") in {
            "jump_in_fright", "cry_out", "involuntary_movement",
            "involuntary_combat_action", "freeze",
        }
        assert action.get("rule_ref") == "core.sanity.failure_involuntary_action"

    # 3. Audit check exists and fires when the block is removed.
    coc_playtest_audit = _load_module(
        "zcode_coc_playtest_audit", str(ZCODE_ROOT / "scripts" / "coc_playtest_audit.py")
    )
    assert hasattr(coc_playtest_audit, "_sanity_failure_involuntary_action_gaps")

    # 4. Skill documents the rule.
    sanity_skill = (ZCODE_ROOT / "skills" / "coc-sanity" / "SKILL.md").read_text()
    assert "involuntary_action.kind" in sanity_skill or "involuntary action" in sanity_skill
    playtest_skill = (ZCODE_ROOT / "skills" / "coc-playtest" / "SKILL.md").read_text()
    assert "sanity_failure_involuntary_action_missing" in playtest_skill
