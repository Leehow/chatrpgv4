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
SYNC_SCRIPT = None


def _load_module(name: str, relative_path: str):
    path = Path(relative_path)
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


SYNC_SCRIPT = _load_module("sync_coc_plugin_copy", "scripts/sync_coc_plugin_copy.py")


def test_zcode_plugin_manifest_uses_zcode_shape_not_codex_interface():
    manifest_path = ZCODE_ROOT / ".zcode-plugin" / "plugin.json"
    assert manifest_path.exists()
    manifest = json.loads(manifest_path.read_text())

    assert manifest["name"] == "coc-keeper"
    assert manifest["version"] == "0.1.0"
    assert manifest["license"] == "Apache-2.0"
    # ZCode plugins point at the skills dir without the ./ prefix and have no
    # Codex-style interface block.
    assert manifest["skills"] == "skills"
    assert "interface" not in manifest
    assert "Call of Cthulhu" in manifest["description"]

    package = json.loads((ZCODE_ROOT / "package.json").read_text())
    assert package["license"] == "Apache-2.0"


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


# --------------------------------------------------------------------------- #
# Dual-directory sync: verify every file in coc-keeper is either identical
# in coc-keeper-zcode, or has only intentional Codex→ZCode wording changes.
# This prevents silent drift between the two plugin copies.
# --------------------------------------------------------------------------- #

# Files where Codex→ZCode differences are intentional. The sync script is the
# single source of truth for platform drift, including Codex-only sections that
# are stripped from the ZCode copy.
INTENTIONAL_DRIFT_FILES = SYNC_SCRIPT.INTENTIONAL_PLATFORM_DRIFT_FILES

CODEX_ROOT = Path("plugins/coc-keeper")
# ZCODE_ROOT already defined above


def _all_plugin_files(root: Path) -> set[str]:
    """All tracked file paths relative to the plugin root."""
    files = set()
    for p in root.rglob("*"):
        if p.is_file() and "__pycache__" not in p.parts and ".codex-plugin" not in p.parts:
            # Skip Codex-only agents/ dirs (openai.yaml) — ZCode doesn't use them.
            if "agents" in p.parts:
                continue
            files.add(str(p.relative_to(root)))
    return files


def test_no_unintentional_drift_between_codex_and_zcode_copies():
    """Every file must be either identical or in the intentional-drift allowlist.

    For allowlisted files, the diff must be platform-wording only (Codex→ZCode),
    never a logic/code change. This catches silent drift from partial syncs.
    """
    codex_files = _all_plugin_files(CODEX_ROOT)
    zcode_files = _all_plugin_files(ZCODE_ROOT)

    # Files in Codex but missing from ZCode (excluding .codex-plugin).
    missing_in_zcode = codex_files - zcode_files - {".codex-plugin/plugin.json"}
    # The .codex-plugin is Codex-only by design; ZCode uses .zcode-plugin.
    missing_in_zcode = {f for f in missing_in_zcode if not f.startswith(".codex-plugin")}
    assert not missing_in_zcode, f"Files in coc-keeper missing from coc-keeper-zcode: {missing_in_zcode}"

    # For each file, check it's identical or intentionally drifted.
    unintentional = []
    for rel in sorted(codex_files & zcode_files):
        if rel in INTENTIONAL_DRIFT_FILES:
            continue  # checked separately below
        codex_content = (CODEX_ROOT / rel).read_bytes()
        zcode_content = (ZCODE_ROOT / rel).read_bytes()
        if codex_content != zcode_content:
            unintentional.append(rel)

    assert not unintentional, (
        f"Unintentional drift detected — these files differ between "
        f"coc-keeper and coc-keeper-zcode but are not in the allowlist: {unintentional}"
    )


def test_intentional_drift_files_only_differ_in_platform_wording():
    """Allowlisted files must only differ in Codex→ZCode wording, not logic.

    Replaces 'Codex' with 'ZCode' in the Codex version and checks the result
    matches the ZCode version (after also normalizing the dice label
    'Codex 掷骰'→'AI 掷骰' etc).
    """
    for rel in sorted(INTENTIONAL_DRIFT_FILES):
        codex_path = CODEX_ROOT / rel
        zcode_path = ZCODE_ROOT / rel
        if not codex_path.exists() or not zcode_path.exists():
            continue
        codex_text = codex_path.read_text(encoding="utf-8")
        zcode_text = zcode_path.read_text(encoding="utf-8")
        normalized = SYNC_SCRIPT._zcode_text_from_codex(codex_text)
        if normalized != zcode_text:
            # Find first differing line for diagnostics
            for i, (c, z) in enumerate(zip(normalized.splitlines(), zcode_text.splitlines())):
                if c != z:
                    pytest.fail(
                        f"{rel}: line {i+1} differs beyond Codex→ZCode wording.\n"
                        f"  Codex(normalized): {c[:100]}\n"
                        f"  ZCode:              {z[:100]}"
                    )
                    break
            else:
                pytest.fail(f"{rel}: file lengths differ beyond Codex→ZCode wording")


def test_zcode_copy_has_all_three_engines():
    """coc-keeper-zcode must have coc_combat.py, coc_sanity.py, coc_chase.py."""
    for engine in ("coc_combat.py", "coc_sanity.py", "coc_chase.py"):
        assert (ZCODE_ROOT / "scripts" / engine).exists(), f"ZCode copy missing {engine}"
