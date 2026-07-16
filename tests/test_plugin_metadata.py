import json
import re
import shutil
from pathlib import Path


PLUGIN_ROOT = Path("plugins/coc-keeper")
EXPECTED_PLUGIN_VERSION = "0.16.0-alpha.1"


def test_plugin_manifest_declares_coc_keeper_skill_plugin():
    manifest_path = PLUGIN_ROOT / ".codex-plugin" / "plugin.json"
    assert manifest_path.exists()

    manifest = json.loads(manifest_path.read_text())
    assert manifest["name"] == "coc-keeper"
    assert manifest["version"] == EXPECTED_PLUGIN_VERSION
    assert manifest["skills"] == "./skills/"
    assert manifest["interface"]["displayName"] == "COC Keeper"
    assert "Call of Cthulhu" in manifest["description"]


def test_repository_declares_apache_2_license():
    license_path = Path("LICENSE")
    assert license_path.exists()

    text = license_path.read_text()
    assert "Apache License" in text
    assert "Version 2.0" in text


def test_repo_marketplace_exposes_coc_keeper_plugin():
    marketplace_path = Path(".agents/plugins/marketplace.json")
    assert marketplace_path.exists()

    marketplace = json.loads(marketplace_path.read_text())
    assert marketplace["name"] == "coc-keeper"
    assert marketplace["interface"]["displayName"] == "COC Keeper Plugins"

    assert marketplace["plugins"] == [
        {
            "name": "coc-keeper",
            "source": {
                "source": "local",
                "path": "./plugins/coc-keeper",
            },
            "policy": {
                "installation": "AVAILABLE",
                "authentication": "ON_INSTALL",
            },
            "category": "Productivity",
        }
    ]


def test_claude_plugin_manifest_points_at_canonical_plugin():
    manifest_path = PLUGIN_ROOT / ".claude-plugin" / "plugin.json"
    assert manifest_path.exists()

    manifest = json.loads(manifest_path.read_text())
    assert manifest["name"] == "coc-keeper"
    assert manifest["version"] == EXPECTED_PLUGIN_VERSION
    assert "Call of Cthulhu" in manifest["description"]
    assert (PLUGIN_ROOT / "skills").is_dir()
    assert any((PLUGIN_ROOT / "skills").glob("*/SKILL.md"))


def test_claude_marketplace_exposes_coc_keeper_plugin():
    marketplace_path = Path(".claude-plugin") / "marketplace.json"
    assert marketplace_path.exists()

    marketplace = json.loads(marketplace_path.read_text())
    assert marketplace["name"] == "coc-keeper"
    assert marketplace["plugins"]
    plugin = marketplace["plugins"][0]
    assert plugin["name"] == "coc-keeper"
    assert plugin["version"] == EXPECTED_PLUGIN_VERSION
    assert plugin["source"] == "./plugins/coc-keeper"
    assert Path(plugin["source"]).resolve() == PLUGIN_ROOT.resolve()
    assert "Codex-only" in plugin["description"] or "skip" in plugin["description"].lower()


def test_cursor_plugin_manifest_points_at_canonical_skills():
    manifest_path = PLUGIN_ROOT / ".cursor-plugin" / "plugin.json"
    assert manifest_path.exists()

    manifest = json.loads(manifest_path.read_text())
    assert manifest["name"] == "coc-keeper"
    assert manifest["version"] == EXPECTED_PLUGIN_VERSION
    assert manifest["skills"] == "./skills/"
    skills_dir = (PLUGIN_ROOT / manifest["skills"]).resolve()
    assert skills_dir == (PLUGIN_ROOT / "skills").resolve()
    assert skills_dir.is_dir()
    assert "Codex-only" in manifest["description"] or "skip" in manifest["description"].lower()


def test_cursor_thin_skill_entry_routes_to_canonical_tree():
    entry = Path(".cursor/skills/coc-keeper/SKILL.md")
    assert entry.exists()
    assert not entry.is_symlink()

    text = entry.read_text()
    assert text.startswith("---\n")
    assert "plugins/coc-keeper/skills/" in text
    assert "CODEX_ONLY_IMAGEGEN" in text
    assert "skip" in text.lower()
    assert "Do not create a parallel skill copy" in text
    assert "coc-main" in text


def test_single_track_no_duplicate_skill_trees():
    """Only plugins/coc-keeper/skills/ may hold the full skill tree.

    Allowed outside that tree: the Cursor thin entry at
    .cursor/skills/coc-keeper/SKILL.md, and symlinks that resolve into the
    canonical skills directory. node_modules / tmp are ignored.
    """
    canonical_skills = (PLUGIN_ROOT / "skills").resolve()
    thin_entry = Path(".cursor/skills/coc-keeper/SKILL.md").resolve()
    forbidden = []

    for path in Path(".").rglob("SKILL.md"):
        if any(part in {"node_modules", "tmp", ".git", ".venv", ".venv311"} for part in path.parts):
            continue
        resolved = path.resolve()
        if canonical_skills in resolved.parents or resolved.parent == canonical_skills:
            continue
        if path.is_symlink():
            link_target = path.resolve()
            if canonical_skills in link_target.parents or link_target.parent == canonical_skills:
                continue
        if resolved == thin_entry:
            # Thin adapter must not be a second full tree: only one SKILL.md
            # under .cursor/skills/, and it must not duplicate skill package dirs.
            continue
        forbidden.append(str(path))

    assert forbidden == [], f"extra SKILL.md trees outside single-track: {forbidden}"

    cursor_skill_dirs = [
        p for p in Path(".cursor/skills").iterdir() if p.is_dir()
    ] if Path(".cursor/skills").is_dir() else []
    assert [p.name for p in cursor_skill_dirs] == ["coc-keeper"]

    parallel_plugin_roots = [
        p
        for p in Path("plugins").iterdir()
        if p.is_dir() and p.name != "coc-keeper" and (p / "skills").is_dir()
    ] if Path("plugins").is_dir() else []
    assert parallel_plugin_roots == []


def test_codex_only_imagegen_markers_intact():
    skill = (PLUGIN_ROOT / "skills" / "coc-character" / "SKILL.md").read_text()
    assert "<!-- CODEX_ONLY_IMAGEGEN_START -->" in skill
    assert "<!-- CODEX_ONLY_IMAGEGEN_END -->" in skill
    start = skill.index("<!-- CODEX_ONLY_IMAGEGEN_START -->")
    end = skill.index("<!-- CODEX_ONLY_IMAGEGEN_END -->")
    assert start < end
    block = skill[start:end]
    assert "Portrait generation is available only in Codex" in block
    assert "skip portrait generation" in block


def test_install_docs_cover_three_hosts_and_imagegen_skip():
    readme = Path("README.md").read_text()
    for term in [
        "Claude Code",
        "Cursor",
        "Codex",
        ".claude-plugin/marketplace.json",
        ".cursor/skills/coc-keeper/SKILL.md",
        ".cursor-plugin/plugin.json",
        "CODEX_ONLY_IMAGEGEN",
        "跳过",
    ]:
        assert term in readme, f"README missing install term: {term}"


def test_validate_rules_script_accepts_seed_rules():
    import importlib.util

    path = PLUGIN_ROOT / "scripts" / "coc_validate.py"
    spec = importlib.util.spec_from_file_location("coc_validate", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)

    assert module.validate_rules(PLUGIN_ROOT) == []


def test_validate_rules_requires_all_current_v1_rule_files(tmp_path):
    import importlib.util

    path = PLUGIN_ROOT / "scripts" / "coc_validate.py"
    spec = importlib.util.spec_from_file_location("coc_validate", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)

    assert {
        "cash-assets.json",
        "derived-attributes.json",
        "rule-index.json",
    }.issubset(set(module.REQUIRED_RULE_FILES))

    source_rules_dir = PLUGIN_ROOT / "references" / "rules-json"
    target_rules_dir = tmp_path / "references" / "rules-json"
    target_rules_dir.mkdir(parents=True)
    for source_path in source_rules_dir.glob("*.json"):
        if source_path.name != "derived-attributes.json":
            shutil.copy2(source_path, target_rules_dir / source_path.name)

    assert "missing rule file: derived-attributes.json" in module.validate_rules(tmp_path)


def test_validate_rules_rejects_missing_rule_index_source_table(tmp_path):
    import importlib.util

    path = PLUGIN_ROOT / "scripts" / "coc_validate.py"
    spec = importlib.util.spec_from_file_location("coc_validate", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)

    source_rules_dir = PLUGIN_ROOT / "references" / "rules-json"
    target_rules_dir = tmp_path / "references" / "rules-json"
    target_rules_dir.mkdir(parents=True)
    for source_path in source_rules_dir.glob("*.json"):
        shutil.copy2(source_path, target_rules_dir / source_path.name)

    rule_index_path = target_rules_dir / "rule-index.json"
    rule_index = json.loads(rule_index_path.read_text())
    rule_index["rules"][0]["source_table"] = "missing-percentile-table.json"
    rule_index_path.write_text(json.dumps(rule_index), encoding="utf-8")

    assert (
        "rule-index source_table missing: core.percentile_check -> missing-percentile-table.json"
        in module.validate_rules(tmp_path)
    )


def test_validate_rules_rejects_unindexed_runtime_rule_file(tmp_path):
    import importlib.util

    path = PLUGIN_ROOT / "scripts" / "coc_validate.py"
    spec = importlib.util.spec_from_file_location("coc_validate", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)

    source_rules_dir = PLUGIN_ROOT / "references" / "rules-json"
    target_rules_dir = tmp_path / "references" / "rules-json"
    target_rules_dir.mkdir(parents=True)
    for source_path in source_rules_dir.glob("*.json"):
        shutil.copy2(source_path, target_rules_dir / source_path.name)

    rule_index_path = target_rules_dir / "rule-index.json"
    rule_index = json.loads(rule_index_path.read_text())
    rule_index["rules"] = [
        rule
        for rule in rule_index["rules"]
        if rule.get("source_table") != "damage-bonus-build.json"
    ]
    rule_index_path.write_text(json.dumps(rule_index), encoding="utf-8")

    assert "rule-index missing source_table entry: damage-bonus-build.json" in module.validate_rules(tmp_path)


def test_validate_rules_rejects_duplicate_rule_index_ids(tmp_path):
    import importlib.util

    path = PLUGIN_ROOT / "scripts" / "coc_validate.py"
    spec = importlib.util.spec_from_file_location("coc_validate", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)

    source_rules_dir = PLUGIN_ROOT / "references" / "rules-json"
    target_rules_dir = tmp_path / "references" / "rules-json"
    target_rules_dir.mkdir(parents=True)
    for source_path in source_rules_dir.glob("*.json"):
        shutil.copy2(source_path, target_rules_dir / source_path.name)

    rule_index_path = target_rules_dir / "rule-index.json"
    rule_index = json.loads(rule_index_path.read_text())
    duplicate_id = rule_index["rules"][0]["id"]
    rule_index["rules"][1]["id"] = duplicate_id
    rule_index_path.write_text(json.dumps(rule_index), encoding="utf-8")

    assert f"duplicate rule-index id: {duplicate_id}" in module.validate_rules(tmp_path)


def test_validate_rules_rejects_non_ascii_rule_index_ids(tmp_path):
    import importlib.util

    path = PLUGIN_ROOT / "scripts" / "coc_validate.py"
    spec = importlib.util.spec_from_file_location("coc_validate", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)

    source_rules_dir = PLUGIN_ROOT / "references" / "rules-json"
    target_rules_dir = tmp_path / "references" / "rules-json"
    target_rules_dir.mkdir(parents=True)
    for source_path in source_rules_dir.glob("*.json"):
        shutil.copy2(source_path, target_rules_dir / source_path.name)

    rule_index_path = target_rules_dir / "rule-index.json"
    rule_index = json.loads(rule_index_path.read_text())
    rule_index["rules"][0]["id"] = "core.规则"
    rule_index_path.write_text(json.dumps(rule_index), encoding="utf-8")

    assert "invalid rule-index id: core.规则" in module.validate_rules(tmp_path)


def test_rule_index_ids_are_ascii_machine_keys():
    rule_index = json.loads(
        (PLUGIN_ROOT / "references" / "rules-json" / "rule-index.json").read_text()
    )
    pattern = re.compile(r"^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$")

    for rule in rule_index["rules"]:
        assert pattern.fullmatch(rule["id"])


def test_rule_index_covers_all_runtime_rule_json_files():
    rules_dir = PLUGIN_ROOT / "references" / "rules-json"
    rule_index = json.loads((rules_dir / "rule-index.json").read_text())
    indexed_tables = {
        rule["source_table"]
        for rule in rule_index["rules"]
        if isinstance(rule, dict) and isinstance(rule.get("source_table"), str)
    }
    runtime_rule_files = {
        path.name
        for path in rules_dir.glob("*.json")
        if path.name not in {"metadata.json", "rule-index.json"}
    }

    assert runtime_rule_files <= indexed_tables


def test_rules_json_guide_lists_all_rule_json_files():
    guide_text = (PLUGIN_ROOT / "references" / "rules-json-guide.md").read_text()

    for path in (PLUGIN_ROOT / "references" / "rules-json").glob("*.json"):
        assert f"`{path.name}`" in guide_text


def test_all_v1_skills_have_valid_frontmatter():
    expected = {
            "coc-main",
            "coc-magic",
        "coc-campaign-state",
        "coc-rules-engine",
        "coc-character",
        "coc-development",
        "coc-scenario-import",
        "coc-keeper-play",
        "coc-meta",
        "coc-playtest",
        "coc-combat",
        "coc-chase",
        "coc-sanity",
        "coc-mythos-reference",
        "coc-story-director",
        "trpg-pdf-ingest",
    }
    found = set()
    for skill_path in (PLUGIN_ROOT / "skills").glob("*/SKILL.md"):
        text = skill_path.read_text()
        assert text.startswith("---\n")
        header = text.split("---", 2)[1]
        name_line = next(line for line in header.splitlines() if line.startswith("name: "))
        description_line = next(line for line in header.splitlines() if line.startswith("description: "))
        name = name_line.split(": ", 1)[1].strip()
        description = description_line.split(": ", 1)[1].strip()
        assert name == skill_path.parent.name
        assert len(description) > 40
        found.add(name)
    assert found == expected


def test_development_skill_owns_structured_synchronous_settlement():
    development = (PLUGIN_ROOT / "skills" / "coc-development" / "SKILL.md").read_text()
    keeper = (PLUGIN_ROOT / "skills" / "coc-keeper-play" / "SKILL.md").read_text()
    main = (PLUGIN_ROOT / "skills" / "coc-main" / "SKILL.md").read_text()
    character = (PLUGIN_ROOT / "skills" / "coc-character" / "SKILL.md").read_text()
    assert "structured ending evidence" in development
    assert "Never infer an ending from narration" in development
    assert "Only audit-log or mirror flushing may run in the background" in development
    assert "route post-session" in main
    assert "Route settlement to `coc-development`" in keeper
    assert "use coc-development for post-session advancement" in character.split("---", 2)[1]
    adapter = Path("runtime/adapters/keeper/run_keeper_turn.mjs").read_text()
    assert "synchronously finish every rules.* resource change" in adapter
    assert "Only append-only JSONL audit/mirror flushing may happen" in adapter


def test_reference_documents_exist_and_use_ascii_system_markers():
    reference_names = ["mode-protocol.md", "state-schema.md", "rules-json-guide.md"]
    for name in reference_names:
        path = PLUGIN_ROOT / "references" / name
        assert path.exists()
        text = path.read_text()
        assert "[meta]" in text or name != "mode-protocol.md"
        assert "[spoiler_warning]" in text or name != "mode-protocol.md"
        for marker in ["[超游]", "[剧透警告]", "[回到游戏]"]:
            assert marker not in text


def test_agents_coc_mode_template_documents_passive_activation():
    template_path = PLUGIN_ROOT / "references" / "AGENTS-coc-mode-template.md"
    assert template_path.exists()
    text = template_path.read_text()
    required_terms = [
        "COC mode is passive",
        "explicit activation",
        "Do not proactively offer COC mode",
        "play_language",
        "zh-Hans",
        "language_profile",
        "localized_terms",
        "ASCII markers",
        "[meta]",
        "[spoiler_warning]",
        "coc-main",
        "coc-keeper-play",
        "coc-meta",
        "save and exit",
    ]
    for term in required_terms:
        assert term in text
    for marker in ["[超游]", "[剧透警告]", "[回到游戏]"]:
        assert marker not in text


def test_host_try_demo_prompts_route_to_coc_main_onboarding():
    """Cursor try/demo injections must open the wizard, not a rules demo."""
    main = (PLUGIN_ROOT / "skills" / "coc-main" / "SKILL.md").read_text()
    rules = (PLUGIN_ROOT / "skills" / "coc-rules-engine" / "SKILL.md").read_text()
    protocol = (PLUGIN_ROOT / "references" / "mode-protocol.md").read_text()
    template = (PLUGIN_ROOT / "references" / "AGENTS-coc-mode-template.md").read_text()
    thin = Path(".cursor/skills/coc-keeper/SKILL.md").read_text()

    for text in (main, protocol, template, thin):
        assert "concrete, useful" in text or "concrete/useful" in text
        assert "valuable" in text
        assert "onboarding" in text.lower() or "wizard" in text.lower()
        assert "rules-engine" in text.lower() or "rules engine" in text.lower()

    assert "Do not use for host try/demo" in rules or "Do not use this skill to answer host try" in rules
    assert "coc-main" in rules


def test_rules_json_guide_documents_rule_index_traceability():
    guide_text = (PLUGIN_ROOT / "references" / "rules-json-guide.md").read_text()
    spec_text = Path("docs/superpowers/specs/2026-07-03-coc-keeper-design.md").read_text()
    required_terms = [
        "rule-index.json",
        "rule_refs",
        "core.percentile_check",
        "module.haunting.corbitt_flesh_ward",
    ]
    for term in required_terms:
        assert term in guide_text
        assert term in spec_text


def test_mode_protocol_documents_play_language_and_localized_terms():
    text = (PLUGIN_ROOT / "references" / "mode-protocol.md").read_text()
    required_terms = [
        "play_language",
        "zh-Hans",
        "language_profile",
        "localized_terms",
        "localized_text",
        "Chinese transliterations",
        "conventional translated names",
        "campaign titles",
        "player-visible module source labels",
        "empty_report_lines",
        "speaker_labels",
        "transcript_mode_labels",
        "player-visible skill display names",
        "machine-facing markers, JSON keys, filenames, canonical skill keys, rule enum values, stable IDs, and hidden Mechanical Log audit anchors",
    ]
    for term in required_terms:
        assert term in text


def test_keeper_play_localizes_source_module_names_in_play_language():
    source = (PLUGIN_ROOT / "skills" / "coc-keeper-play" / "SKILL.md").read_text()
    text = " ".join(source.split())
    required_terms = [
        "every player-visible string",
        "`play_language`",
        "`localized_terms[play_language]`",
        "`language_profile.name_policy`",
        "Chinese transliterations or established Chinese translations",
        "Japanese katakana",
        "instead of preserving the source-language spelling",
        "unless the player explicitly asks for it",
        "machine-facing fields, stable IDs, and hidden audit data",
    ]
    for term in required_terms:
        assert term in text


def test_play_protocol_prohibits_player_visible_action_menus():
    mode_protocol = (PLUGIN_ROOT / "references" / "mode-protocol.md").read_text()
    keeper_skill = (PLUGIN_ROOT / "skills" / "coc-keeper-play" / "SKILL.md").read_text()
    state_schema = (PLUGIN_ROOT / "references" / "state-schema.md").read_text()

    assert "Do not present numbered or bulleted action menus" in mode_protocol
    assert "open-ended prompt" in mode_protocol
    assert "diegetic cues" in keeper_skill
    assert "`pending_choices` is Keeper-facing" in state_schema


def test_keeper_play_lists_reusable_investigators_before_character_creation():
    keeper_skill = (PLUGIN_ROOT / "skills" / "coc-keeper-play" / "SKILL.md").read_text()

    assert "Reusable Investigator Selection" in keeper_skill
    assert "`/.coc/investigators/`" in keeper_skill
    assert "before starting characteristic generation" in keeper_skill
    assert "name, occupation, era" in keeper_skill


def test_npc_runtime_rule_files_are_indexed_and_generic():
    rules_dir = PLUGIN_ROOT / "references" / "rules-json"
    core_tags = json.loads((rules_dir / "npc-core-tags.json").read_text())
    stat_archetypes = json.loads((rules_dir / "npc-stat-archetypes.json").read_text())
    rule_index = json.loads((rules_dir / "rule-index.json").read_text())
    indexed = {rule["source_table"] for rule in rule_index["rules"] if "source_table" in rule}

    assert "npc-stat-archetypes.json" in indexed
    for category in [
        "demographic",
        "body",
        "voice",
        "temperament",
        "values",
        "competence",
        "stress_response",
        "social_mask",
        "habit",
        "relationship_seed",
        "secret_posture",
    ]:
        assert category in core_tags["categories"]
    assert stat_archetypes["archetypes"]


def test_design_blueprint_documents_play_language_and_localized_terms():
    text = Path("docs/superpowers/specs/2026-07-03-coc-keeper-design.md").read_text()
    required_terms = [
        "play_language",
        "zh-Hans",
        "language_profile",
        "localized_terms",
        "localized_text",
        "Chinese transliterations",
        "conventional translated names",
        "campaign titles",
        "player-visible module source labels",
        "empty_report_lines",
        "speaker_labels",
        "transcript_mode_labels",
        "player-visible skill display names",
        "machine-facing markers, JSON keys, filenames, canonical skill keys, rule enum values, stable IDs, and hidden Mechanical Log audit anchors",
    ]
    for term in required_terms:
        assert term in text


def test_coc_playtest_skill_documents_battle_report_inputs():
    text = (PLUGIN_ROOT / "skills" / "coc-playtest" / "SKILL.md").read_text()
    required_terms = [
        "campaign.json",
        "party.json",
        "scenario.json",
        "character.json",
        "history.jsonl",
        "development.jsonl",
        "transcript.jsonl",
        "player-view.jsonl",
        "keeper-view.jsonl",
        "rolls.jsonl",
        "events.jsonl",
        "session-summaries.jsonl",
        "player-feedback.jsonl",
        "## Run Setup",
        "## Character Dossier",
        "## Investigator Chronicle",
        "## Chase Tracker",
        "## Player Feedback On KP",
    ]
    for term in required_terms:
        assert term in text


def test_design_blueprint_documents_investigator_chronicle_playtest_gate():
    text = Path("docs/superpowers/specs/2026-07-03-coc-keeper-design.md").read_text()
    required_terms = [
        "## Investigator Chronicle",
        "history.jsonl",
        "development.jsonl",
        "investigator_chronicle_missing",
        "temporary_insanity_bout_missing",
        "temporary_insanity_bout_mode_mismatch",
        "temporary_insanity_bout_duration_missing",
        "temporary_insanity_bout_rounds_missing",
        "table_viii_summary",
        "summary_roll",
        "chase_tracker_not_rendered",
        "chase_tracker_labels",
        "chase_tracker_labels_not_localized",
        "chase_dex_order_not_proven",
        "item_transfer",
        "chase_object_transfer_missing",
        "resource_change",
        "haunting_corbitt_magic_points_missing",
        "haunting_corbitt_own_dagger_exception_missing",
        "chase_dex_order_not_proven",
        "Corbitt Magic points",
        "flesh_ward",
        "own_dagger_ignores_spells",
        "Flesh Ward",
        "report_actor_ids_not_localized",
        "report_actor_label_repeated",
        "report_actor_dash_prefix",
        "report_actor_colon_prefix",
        "localized_empty_placeholders_not_rendered",
        "player_profile_labels",
        "player_profile_labels_not_localized",
        "core.character_creation.movement_rate",
        "derived_movement_rate_mismatch",
        "report_heading_labels",
        "report_field_labels",
        "report_value_labels",
        "report_shell_not_localized",
        "run_setup_values_not_localized",
        "module_metadata_values_not_localized",
        "transcript_labels",
        "speaker_labels",
        "transcript_mode_labels",
        "transcript_labels_not_localized",
        "transcript_detail_values_not_localized",
        "report_boolean_values_not_localized",
        "chronicle_labels",
        "investigator_chronicle_labels_not_localized",
        "feedback_labels",
        "player_feedback_labels_not_localized",
        "feedback_voice_default",
        "feedback_voice_profile",
        "player_feedback_voice_missing",
        "character_dossier_labels",
        "character_dossier_labels_not_localized",
        "character_dossier_derived_labels_not_localized",
        "character_dossier_terms_not_localized",
        "report_skill_names_not_localized",
        "report_state_ids_not_localized",
        "report_memory_ids_not_localized",
        "report_event_type_labels_not_localized",
        "疯狂发作",
        "bout_of_madness",
        "duration_roll",
        "playtests prove investigator reuse without writing sandbox changes into the real investigator library",
    ]
    for term in required_terms:
        assert term in text


def test_coc_playtest_skill_documents_rulebook_audit_loop():
    skill_text = (PLUGIN_ROOT / "skills" / "coc-playtest" / "SKILL.md").read_text()
    spec_text = Path("docs/superpowers/specs/2026-07-03-coc-keeper-design.md").read_text()
    required_terms = [
        "coc_playtest_harness.py",
        "coc_playtest_audit.py",
        "rulebook-audit.md",
        "pushed roll",
        "pushed_roll_protocol",
        "player_reframes_action",
        "keeper_foreshadows_failure",
        "player_confirms_risk",
        "temporary_insanity_bout_missing",
        "temporary_insanity_bout_mode_mismatch",
        "temporary_insanity_bout_duration_missing",
        "temporary_insanity_bout_rounds_missing",
        "table_viii_summary",
        "summary_roll",
        "疯狂发作",
        "bout_of_madness",
        "duration_roll",
        "control_returned",
        "Positive Rulebook Evidence",
        "session ending",
        "mechanical detail",
        "raw payload",
        "transcript_turn_sequence_gap",
        "test_gap",
        "system_gap",
        "report_gap",
        "report-anchor",
        "field-anchor",
        "report_skill_names_not_localized",
        "transcript_mode_labels",
        "report_actor_dash_prefix",
        "report_actor_colon_prefix",
        "feedback_voice_default",
        "feedback_voice_profile",
        "player_feedback_voice_missing",
        "status_event_not_rendered",
        "investigator_creation_missing",
        "investigator_skill_allocation_missing",
        "investigator_skill_allocation_mismatch",
        "view_separation_missing",
        "player_view_secret_leak",
        "player_view_protocol_wrapper_leak",
        "skill_allocation",
        "skill_allocation final values must match character.json skills",
        "Investigator Creation",
        "investigator_inventory_history_missing",
        "haunting_npc_dialogue_missing",
        "Vittorio Macario",
        "chase_player_profile_pressure_missing",
        "item_transfer",
        "chase_object_transfer_missing",
        "resource_change",
        "haunting_corbitt_magic_points_missing",
        "haunting_corbitt_own_dagger_exception_missing",
        "Corbitt Magic points",
        "flesh_ward",
        "own_dagger_ignores_spells",
        "Flesh Ward",
        "decision_kind",
        "chase_decisions_too_thin",
        "Blueprint Cross-Check",
        "Next Loop Fix Target",
    ]
    for term in required_terms:
        assert term in skill_text
        assert term in spec_text


def test_coc_playtest_skill_documents_chase_drill_profile():
    skill_text = (PLUGIN_ROOT / "skills" / "coc-playtest" / "SKILL.md").read_text()
    spec_text = Path("docs/superpowers/specs/2026-07-03-coc-keeper-design.md").read_text()
    required_terms = [
        "chase-drill",
        "chase_drill",
        "save/chase.json",
        "## Chase Tracker",
        "movement actions",
        "location chain",
        "hazard",
        "barrier",
        "conflict",
        "quarry escapes",
        "item_transfer",
        "decision_kind",
        "chase_decisions_too_thin",
        "chase_object_transfer_missing",
        "chase_transcript_position_conflict",
        "participants[].position",
    ]
    for term in required_terms:
        assert term in skill_text
        assert term in spec_text


def test_coc_playtest_skill_documents_single_player_pressure_scope():
    skill_text = (PLUGIN_ROOT / "skills" / "coc-playtest" / "SKILL.md").read_text()
    spec_text = Path("docs/superpowers/specs/2026-07-03-coc-keeper-design.md").read_text()

    assert "play-style profiles for one virtual player" in skill_text
    assert "current completion-oriented playtests are single-player only" in skill_text
    assert "Group-table" not in skill_text
    assert "group-table" not in skill_text
    assert "multiplayer" not in skill_text
    assert "multiplayer" not in spec_text
    assert "virtual player profiles" not in skill_text
    assert "simulated players" not in spec_text
    for text in (skill_text, spec_text):
        assert "exactly one active investigator" in text
        assert "active_run_party_not_single_player" in text
        assert "current completion scope is single-player only" in text


def test_coc_playtest_skill_documents_suite_report_index():
    skill_text = (PLUGIN_ROOT / "skills" / "coc-playtest" / "SKILL.md").read_text()
    spec_text = Path("docs/superpowers/specs/2026-07-03-coc-keeper-design.md").read_text()
    required_terms = [
        "coc_playtest_suite.py",
        "suite-report.md",
        "index.json",
        "Core Coverage Matrix",
        "Non-Passing Evaluated Runs",
        "Evaluator Note Blockers",
        "evaluator_note_blocker",
        "active_evaluator_note_blocker",
        "medium-or-higher or failing-severity evaluator notes",
        "suite_matrix_references_non_evaluated_run",
        "structured automation status",
        "monitor prompt text",
        "party_size",
        "character_dossier",
        "kp_player_transcript",
        "mechanical_rolls",
        "meta_game",
        "player_feedback",
    ]
    for term in required_terms:
        assert term in skill_text
        assert term in spec_text


def test_coc_playtest_skill_documents_interactive_whitebox_driver():
    skill_text = (PLUGIN_ROOT / "skills" / "coc-playtest" / "SKILL.md").read_text()
    required_terms = [
        "Interactive White-Box Driver",
        "coc_interactive_playtest.py",
        "diagnostic_spoiler_run",
        "blind_actual_play",
        "runtime.sdk.api.send",
        "haunting-module",
        "coc_playtest_harness.py",
    ]
    for term in required_terms:
        assert term in skill_text


def test_coc_playtest_skill_documents_semantic_matcher_constitution():
    skill_text = (PLUGIN_ROOT / "skills" / "coc-playtest" / "SKILL.md").read_text()
    spec_text = Path("docs/superpowers/specs/2026-07-03-coc-keeper-design.md").read_text()
    required_terms = [
        "Semantic Matcher Constitution",
        "natural-language matcher",
        "LLM semantic evaluator",
        "machine-controlled schema fields",
        "coverage_evaluator",
        "coverage_reasons",
        "source-gated subsystems",
        "subsystems_covered",
    ]
    for term in required_terms:
        assert term in skill_text
        assert term in spec_text


def test_coc_playtest_skill_documents_semantic_eval_artifact_workflow():
    skill_text = (PLUGIN_ROOT / "skills" / "coc-playtest" / "SKILL.md").read_text()
    spec_text = Path("docs/superpowers/specs/2026-07-03-coc-keeper-design.md").read_text()
    required_terms = [
        "semantic-eval-request.json",
        "semantic-eval-result.json",
        "semantic-artifact",
        "CLI default evaluator",
        "--evaluator structured-source",
        "completion-oriented quality gates",
        "evaluation_provenance",
        "request_sha256",
        "root_cause_classification",
        "next_loop_fix_target",
    ]
    for term in required_terms:
        assert term in skill_text
        assert term in spec_text


def test_coc_playtest_skill_documents_semantic_quality_matrix():
    skill_text = (PLUGIN_ROOT / "skills" / "coc-playtest" / "SKILL.md").read_text()
    spec_text = Path("docs/superpowers/specs/2026-07-03-coc-keeper-design.md").read_text()
    required_terms = [
        "quality_dimensions",
        "Quality Matrix",
        "quality_gaps",
        "module_fidelity",
        "rulebook_procedure",
        "immersion_and_pacing",
        "state_continuity",
        "spoiler_safety",
        "player_agency",
        "report_completeness",
    ]
    for term in required_terms:
        assert term in skill_text
        assert term in spec_text


def test_coc_playtest_skill_documents_loop_decision_artifact():
    skill_text = (PLUGIN_ROOT / "skills" / "coc-playtest" / "SKILL.md").read_text()
    spec_text = Path("docs/superpowers/specs/2026-07-03-coc-keeper-design.md").read_text()
    required_terms = [
        "loop-decision.json",
        "Loop Decision",
        "ready_for_completion_audit",
        "needs_repair",
        "thread_goal_status",
        "active_not_complete",
        "ignored_historical_runs",
        "evaluated_runs",
    ]
    for term in required_terms:
        assert term in skill_text
        assert term in spec_text
