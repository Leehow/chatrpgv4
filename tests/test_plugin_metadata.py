import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PLUGIN_ROOT = ROOT / "plugins" / "coc-keeper"
EXPECTED_PLUGIN_VERSION = "0.4.0-alpha.0"


def _json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def _text(path: Path):
    return path.read_text(encoding="utf-8")


def _skill_package_text(skill_dir: Path) -> str:
    """Main SKILL.md plus normative progressive references under references/."""
    parts = [_text(skill_dir / "SKILL.md")]
    refs = skill_dir / "references"
    if refs.is_dir():
        for path in sorted(refs.glob("*.md")):
            parts.append(_text(path))
    return "\n".join(parts)


def test_all_host_manifests_share_the_040a_version():
    marketplace = _json(ROOT / ".claude-plugin" / "marketplace.json")
    versions = {
        _json(PLUGIN_ROOT / ".codex-plugin" / "plugin.json")["version"],
        _json(PLUGIN_ROOT / ".claude-plugin" / "plugin.json")["version"],
        _json(PLUGIN_ROOT / ".cursor-plugin" / "plugin.json")["version"],
        _json(PLUGIN_ROOT / ".grok-plugin" / "plugin.json")["version"],
        _json(PLUGIN_ROOT / ".zcode-plugin" / "plugin.json")["version"],
        _json(PLUGIN_ROOT / ".kimi-plugin" / "plugin.json")["version"],
        _json(PLUGIN_ROOT / ".kimi-plugin" / "kimi.plugin.json")["version"],
        marketplace["plugins"][0]["version"],
    }
    assert versions == {EXPECTED_PLUGIN_VERSION}


def test_plugin_is_single_track_with_thin_host_entries():
    assert (PLUGIN_ROOT / "skills" / "coc-main" / "SKILL.md").is_file()
    assert (ROOT / ".cursor" / "skills" / "coc-keeper" / "SKILL.md").is_file()
    assert not (ROOT / ".cursor" / "skills" / "coc-main").exists()
    assert (ROOT / ".kimi" / "skills" / "coc-keeper" / "SKILL.md").is_file()
    assert not (ROOT / ".kimi" / "skills" / "coc-main").exists()
    assert not (ROOT / "plugins" / "coc-keeper-zcode").exists()
    assert not (ROOT / "plugins" / "coc-keeper-grok").exists()


def test_kimi_adapter_is_thin_and_points_at_canonical_tree():
    manifest = _json(PLUGIN_ROOT / ".kimi-plugin" / "kimi.plugin.json")
    assert manifest["name"] == "coc-keeper"
    assert manifest["version"] == EXPECTED_PLUGIN_VERSION
    skills_ref = manifest["skills"]
    resolved = (
        PLUGIN_ROOT / ".kimi-plugin" / skills_ref
    ).resolve()
    assert resolved == (PLUGIN_ROOT / "skills").resolve()
    assert (resolved / "coc-main" / "SKILL.md").is_file()

    entry = _text(ROOT / ".kimi" / "skills" / "coc-keeper" / "SKILL.md")
    compact = " ".join(entry.split()).lower()
    for phrase in (
        "host adapter only",
        "plugins/coc-keeper/skills/",
        "coc-main/skill.md",
        "coc-keeper-play/skill.md",
        "coc-story-director/skill.md",
        "host_native_imagegen",
        "skip portrait generation",
        "install-kimi-plugin.sh",
        "evidence.record_adoption",
    ):
        assert phrase in compact, phrase
    # The thin entry must not embed canonical skill bodies.
    assert "core keeper response contract (always active)" not in compact


def test_grok_plugin_is_full_canonical_skill_tree():
    """Grok Build play requires full plugin install, not a thin-only path.

    Grok resolves plugin.json path fields relative to the plugin root
    (plugins/coc-keeper/), not the .grok-plugin/ subdirectory.
    """
    manifest = _json(PLUGIN_ROOT / ".grok-plugin" / "plugin.json")
    assert manifest["name"] == "coc-keeper"
    assert manifest["version"] == EXPECTED_PLUGIN_VERSION
    assert manifest["hooks"] == "./hooks/hooks.json"
    skills_ref = manifest["skills"]
    assert skills_ref in {"./skills/", "skills/", "skills"}
    resolved = (PLUGIN_ROOT / "skills").resolve()
    assert resolved.is_dir()
    required = {
        "coc-main",
        "coc-keeper-play",
        "coc-story-director",
        "coc-character",
        "coc-playtest",
        "coc-export-battle-report",
    }
    present = {
        path.name for path in resolved.iterdir() if path.is_dir()
    }
    assert required <= present
    install = _text(PLUGIN_ROOT / "scripts" / "install-grok-plugin.sh")
    compact = " ".join(install.split()).lower()
    for phrase in (
        "full",
        "plugin install",
        "coc-main",
        "coc-keeper-play",
        "host_native_imagegen",
        "image_gen",
    ):
        assert phrase in compact, phrase
    assert "thin entry alone" in compact or "not a thin entry" in compact


def test_grok_plugin_exposes_shared_mcp_and_safe_host_contract():
    config = _json(PLUGIN_ROOT / ".mcp.json")
    server = config["mcpServers"]["coc-keeper"]
    assert server["command"] == "${GROK_PLUGIN_ROOT}/mcp/launch"
    assert server["env"] == {"COC_HOST": "grok"}
    assert not (PLUGIN_ROOT / "mcp" / "grok_server.py").exists()

    capabilities = _json(PLUGIN_ROOT / "references" / "host-capabilities.json")
    assert capabilities["grok"] == {
        "plugin_skills": True,
        "plugin_mcp": True,
        "native_imagegen": True,
        "isolated_player_agent": True,
    }

    bootstrap = " ".join(
        _text(PLUGIN_ROOT / "skills" / "coc-host-bootstrap" / "SKILL.md").split()
    ).lower()
    for phrase in (
        "mcp tools first",
        "do not mix mcp and shell",
        "exact delivered message",
        "never edit `.coc`",
        "toolbox-calls.jsonl",
        "ordering or integrity error",
        "typed, transactional, idempotent operation",
        "fail closed",
    ):
        assert phrase in bootstrap, phrase

    install = _text(PLUGIN_ROOT / "scripts" / "install-grok-plugin.sh")
    assert "grok plugin details coc-keeper" in install
    assert "grok mcp doctor coc-keeper --json" in install
    assert "MCP server component" in install
    assert '"healthy"' in install
    assert "MCP servers|" in install
    assert "blocked|:[[:space:]]*0" in install
    assert "grep -Eq" in install


def test_plugin_bundles_cross_host_continuation_hooks():
    hooks = _json(PLUGIN_ROOT / "hooks" / "hooks.json")["hooks"]
    assert set(hooks) == {
        "SessionStart",
        "UserPromptSubmit",
        "PreCompact",
        "PostCompact",
        "SessionEnd",
        "PreToolUse",
    }
    for lifecycle in (
        "SessionStart", "UserPromptSubmit", "PreCompact", "PostCompact",
        "SessionEnd",
    ):
        assert "matcher" not in hooks[lifecycle][0]
    assert "coc[-_]keeper" in hooks["PreToolUse"][0]["matcher"]
    for event, entries in hooks.items():
        handler = entries[0]["hooks"][0]
        assert handler["type"] == "command"
        assert "${CLAUDE_PLUGIN_ROOT}/hooks/run" in handler["command"]
        assert handler["env"]["COC_HOOK_EVENT"]
    assert (PLUGIN_ROOT / "hooks" / "run").stat().st_mode & 0o111
    assert (PLUGIN_ROOT / "hooks" / "coc_context_hook.py").is_file()

    install = _text(PLUGIN_ROOT / "scripts" / "install-grok-plugin.sh")
    assert "continuation lifecycle hooks" in install
    assert "components:.*hooks" in install
    assert "grok-global-hooks.json" in install
    assert "coc-keeper-continuation.json" in install
    global_hooks = _json(
        PLUGIN_ROOT / "hooks" / "grok-global-hooks.json"
    )["hooks"]
    assert set(global_hooks) == set(hooks)
    for entries in global_hooks.values():
        command = entries[0]["hooks"][0]["command"]
        assert "$HOME/.grok/coc-keeper-current/hooks/run" in command


def test_codex_manifest_exposes_same_skills_mcp_and_hooks():
    manifest = _json(PLUGIN_ROOT / ".codex-plugin" / "plugin.json")
    assert manifest["skills"] == "./skills/"
    assert manifest["hooks"] == "./hooks/hooks.json"
    assert manifest["mcpServers"] == "./mcp-codex.json"
    mcp = _json(PLUGIN_ROOT / "mcp-codex.json")["mcpServers"]["coc-keeper"]
    assert mcp == {
        "command": "${PLUGIN_ROOT}/mcp/launch",
        "env": {"COC_HOST": "codex"},
    }
    assert not (PLUGIN_ROOT / "mcp" / "codex_server.py").exists()


def test_kimi_manifest_exposes_same_skills_mcp_and_hooks():
    manifest = _json(PLUGIN_ROOT / ".kimi-plugin" / "plugin.json")
    assert manifest["skills"] == "./skills/"
    assert manifest["sessionStart"] == {"skill": "coc-host-bootstrap"}
    server = manifest["mcpServers"]["coc-keeper"]
    assert server["command"] == "./mcp/launch"
    assert server["env"] == {"COC_HOST": "kimi"}
    events = {entry["event"] for entry in manifest["hooks"]}
    assert events == {
        "SessionStart",
        "UserPromptSubmit",
        "PreCompact",
        "PostCompact",
        "SessionEnd",
        "PreToolUse",
    }
    assert not (PLUGIN_ROOT / "mcp" / "kimi_server.py").exists()

def test_cursor_thin_entry_requires_kp_craft_parity_with_codex():
    text = _text(ROOT / ".cursor" / "skills" / "coc-keeper" / "SKILL.md")
    compact = " ".join(text.split()).lower()
    for phrase in (
        "coc-keeper-play/skill.md",
        "coc-story-director/skill.md",
        "director.advise",
        "narration.brief",
        "narration.review",
        "evidence.record_adoption",
        "action_uptake",
        "enact it from the investigator",
        "log_style_summary",
        "ai_summary_voice",
        "always-active player-action uptake",
        "rules.skill_describe",
        "**not** an acceptable",
        "host_native_imagegen",
    ):
        assert phrase in compact, phrase
    agents = _text(PLUGIN_ROOT / "references" / "AGENTS-coc-mode-template.md")
    agents_compact = " ".join(agents.split()).lower()
    assert "coc-story-director" in agents_compact
    assert "director.advise" in agents_compact
    assert (
        PLUGIN_ROOT / "skills" / "coc-story-director" / "agents" / "openai.yaml"
    ).is_file()
    play_dir = PLUGIN_ROOT / "skills" / "coc-keeper-play"
    play_main = _text(play_dir / "SKILL.md")
    play_main_compact = " ".join(play_main.split()).lower()
    # Always-loaded main skill: core contract before optional narration tools.
    core_at = play_main_compact.index("core keeper response contract (always active)")
    brief_at = play_main_compact.index("narration.brief")
    review_at = play_main_compact.index("narration.review")
    assert core_at < brief_at < review_at
    # Progressive references hold full craft detail; main + refs = package.
    play_compact = " ".join(_skill_package_text(play_dir).split()).lower()
    for phrase in (
        "must make that declaration happen in the fictional world",
        "whether or not",
        "always-on prompt-level drafting responsibility",
        "not a fixed workflow",
        "never a keyword list",
        "required craft instruction",
        "not a mandatory pipeline",
        "compound player declarations",
        "diegetic delivery only",
        "settlement is **internal kp craft**",
        "acknowledge the unplayed remainder",
        "tease like a real table kp",
        "table wit (failures players feel)",
        "fumbles / 大失败",
        "【串联】",
        "player knowledge boundary",
        "kp owns the intercept",
        "lucky guesses stay guesses",
        "overconfident unearned knowledge",
    ):
        assert phrase in play_compact, phrase
    agents = _text(ROOT / "AGENTS.md")
    agents_compact = " ".join(agents.split()).lower()
    for phrase in (
        "player knowledge boundary",
        "kp owns the intercept",
        "lucky correct guess",
        "do not ban players from guessing",
    ):
        assert phrase in agents_compact, phrase
    assert "action_uptake" in play_compact
    assert "not acceptable player-" in play_main_compact or (
        "not acceptable player" in play_main_compact
    )
    # Main skill must still carry the always-on uptake constitution itself.
    for phrase in (
        "must make that declaration happen in the fictional world",
        "always-on prompt-level drafting responsibility",
        "player knowledge boundary",
        "kp owns the intercept",
        "play_language",
        "turn.finalize",
        "rendered_text",
    ):
        assert phrase in play_main_compact, phrase
    cursor_chain = " ".join(
        _text(ROOT / ".cursor" / "skills" / "coc-keeper" / "SKILL.md").split()
    ).lower()
    assert "chain-settlement" in cursor_chain or "【串联】" in cursor_chain
    assert "narration.review" in cursor_chain
    contract = _text(PLUGIN_ROOT / "scripts" / "coc_narration_contract.py")
    assert "action_uptake" in contract
    assert "treat_current_action_uptake_as_semantic_repetition" in contract

    cursor_compact = " ".join(
        _text(ROOT / ".cursor" / "skills" / "coc-keeper" / "SKILL.md").split()
    ).lower()
    assert "always-active player-action uptake" in cursor_compact
    assert "whether or not `narration.brief`" in cursor_compact
    assert "player-visible prose pipeline (hard order)" not in cursor_compact

    pi_compact = " ".join(
        _text(ROOT / "runtime" / "adapters" / "pi" / "README.md").split()
    ).lower()
    assert "always-active core keeper response contract" in pi_compact
    assert "whether or not an optional" in pi_compact


def test_canonical_skills_have_matching_frontmatter_names():
    skill_root = PLUGIN_ROOT / "skills"
    skill_dirs = sorted(path for path in skill_root.iterdir() if path.is_dir())
    assert skill_dirs
    for directory in skill_dirs:
        skill_path = directory / "SKILL.md"
        assert skill_path.is_file(), directory
        text = _text(skill_path)
        match = re.search(r"\A---\s*\nname:\s*([^\n]+)", text)
        assert match, skill_path
        assert match.group(1).strip() == directory.name


def test_required_canonical_skills_are_present():
    names = {
        path.name
        for path in (PLUGIN_ROOT / "skills").iterdir()
        if path.is_dir()
    }
    assert {
        "coc-main",
        "coc-keeper-play",
        "coc-playtest",
        "coc-export-battle-report",
        "coc-campaign-state",
        "coc-rules-engine",
        "trpg-pdf-ingest",
    } <= names


def test_host_native_image_generation_is_explicitly_gated():
    character = _text(PLUGIN_ROOT / "skills" / "coc-character" / "SKILL.md")
    assert "HOST_NATIVE_IMAGEGEN_BEGIN" in character
    assert "HOST_NATIVE_IMAGEGEN_END" in character
    assert character.index("HOST_NATIVE_IMAGEGEN_BEGIN") < character.index(
        "HOST_NATIVE_IMAGEGEN_END"
    )
    compact = " ".join(character.split()).lower()
    for phrase in (
        "current host's built-in image tool",
        "do not call another host's image stack",
        "grok build",
        "image_gen",
        "imagine",
        "skip portrait generation",
    ):
        assert phrase in compact, phrase
    # Legacy Codex-only gate must not reappear.
    assert "CODEX_ONLY_IMAGEGEN" not in character
    agents = _text(ROOT / "AGENTS.md")
    assert "HOST_NATIVE_IMAGEGEN" in agents
    assert "Codex-only and must remain" not in agents


def test_playtest_skill_defines_real_plugin_context_free_player_acceptance():
    text = _text(PLUGIN_ROOT / "skills" / "coc-playtest" / "SKILL.md")
    compact = " ".join(text.split()).lower()
    for phrase in (
        "main codex",
        "canonical `coc-keeper` plugin",
        "fork_turns: none",
        "player-safe",
        "fresh isolated workspace",
        "coc-export-battle-report",
        "structured ending",
    ):
        assert phrase in compact
    for obsolete in (
        "coc_eval.py",
        "haunting_module",
        "chase_drill",
        "coc_playtest_harness.py",
        "coc_interactive_playtest.py",
    ):
        assert obsolete not in text


def test_final_report_skill_is_the_single_readable_report_owner():
    text = _text(
        PLUGIN_ROOT / "skills" / "coc-export-battle-report" / "SKILL.md"
    )
    compact = " ".join(text.split()).lower()
    assert "only final battle-report writer" in compact
    assert "battle-report.md" in text
    assert "battle-report-evidence.json" in text
    assert "public" in text and "consequence_public" in text
    assert "read `battle-report.md` end to end" in text
    assert "coc_eval.py" not in text
    assert "supplementary" not in compact


def test_pdf_ingest_is_an_external_skill_source_bundle_boundary():
    main = _text(PLUGIN_ROOT / "skills" / "coc-main" / "SKILL.md")
    ingest = _text(PLUGIN_ROOT / "skills" / "trpg-pdf-ingest" / "SKILL.md")
    playtest = _text(PLUGIN_ROOT / "skills" / "coc-playtest" / "SKILL.md")
    combined = "\n".join((main, ingest, playtest)).lower()
    assert "external pdf skill" in combined
    assert "source bundle" in combined or "source-bundle" in combined
    assert "repository has no pdf parser fallback" in combined
    assert "coc_pdf_bundle.py" in combined


def test_current_skills_reject_legacy_or_mismatched_runtime_state():
    combined = "\n".join(
        _text(PLUGIN_ROOT / "skills" / name / "SKILL.md").lower()
        for name in ("coc-main", "coc-campaign-state", "coc-playtest")
    )
    assert "exact-schema" in combined or "exact current" in combined
    assert "legacy" in combined or "mismatched" in combined
    assert "start fresh" in combined or "fresh campaign" in combined


def test_keeper_play_professional_inference_boundary_is_always_on():
    """Canonical live KP path carries expertise-before-check adjudication.

    Static contract for plugin instructions: always-on main skill + ordinary-
    turn tooling reference. Not a semantic gameplay validator and not a
    keyword-router design proof for play content.
    """
    play_dir = PLUGIN_ROOT / "skills" / "coc-keeper-play"
    play_main = " ".join(_text(play_dir / "SKILL.md").split()).lower()
    tooling_path = play_dir / "references" / "turn-tooling-and-typed-ops.md"
    assert tooling_path.is_file()
    tooling = " ".join(_text(tooling_path).split()).lower()

    # Always-loaded main skill: boundary is ordinary-turn product invariant.
    assert "always-on product invariants" in play_main
    for phrase in (
        "professional inference boundary",
        "always before a check",
        "observable phenomenon",
        "professional inference or expert action",
        "matching professional skill",
        "even when its sheet value is lower",
        "directly observable facts or objects",
        "downgraded substitute",
        "distinct information layers",
        "not a keyword map or hard narrative gate",
    ):
        assert phrase in play_main, phrase
    # Main skill must reject general observation as expert-conclusion substitute.
    assert "must **not** return the same diagnosis" in play_main or (
        "must not return the same diagnosis" in play_main
    )
    assert "professional conclusions" in play_main
    assert "check adjudication flow" in play_main
    # Orientation points KP at the boundary before skill selection.
    assert "professional inference boundary before selecting a skill" in play_main

    # Routed ordinary-turn reference expands operational method/goal guidance.
    assert "check adjudication flow (kp owns the choice)" in tooling
    for phrase in (
        "professional inference boundary",
        "method, goal, and information layer",
        "no-roll obvious facts",
        "professional skill for diagnosis",
        "broad perception",
        "raw observables only",
        "must not emit the same diagnosis",
        "do not choose the higher sheet value merely to improve odds",
        "allied specialty only with rulebook-supported increased",
        "compound layers stay distinct",
        "not a keyword router, fixed skill map, or hard runtime narrative gate",
    ):
        assert phrase in tooling, phrase
    # Illustrative corpse examination layers — never an event→skill map.
    assert "illustrative only" in tooling
    assert "never a fixed event→skill map" in tooling or (
        "never a fixed event" in tooling and "skill map" in tooling
    )
    assert "seeing an obvious body needs no spot hidden" in tooling
    assert "medicine diagnoses" in tooling
    assert "not corpse-keyword routing" in tooling
    # General-perception success still limited to observable layer.
    assert "general-perception success still yields only the observable layer" in tooling
