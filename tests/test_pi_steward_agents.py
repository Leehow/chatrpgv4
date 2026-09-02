"""Pi-Coc distributable steward-agent definitions."""
from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
AGENTS = ROOT / "plugins" / "coc-keeper" / "pi" / "agents"
LAUNCHER = ROOT / "plugins" / "coc-keeper" / "pi" / "bin" / "pi-coc"


def _frontmatter(path: Path) -> dict[str, str]:
    lines = path.read_text(encoding="utf-8").splitlines()
    assert lines[0] == "---"
    closing = lines.index("---", 1)
    return {
        key.strip(): value.strip()
        for key, value in (line.split(":", 1) for line in lines[1:closing])
    }


def test_steward_agents_are_distributable_project_definitions():
    expected = {
        "steward-init.md": "steward-init",
        "steward-npc.md": "steward-npc",
        "steward-scene.md": "steward-scene",
        "steward-rule.md": "steward-rule",
    }
    assert {path.name for path in AGENTS.glob("steward-*.md")} == set(expected)
    for filename, name in expected.items():
        frontmatter = _frontmatter(AGENTS / filename)
        assert frontmatter["name"] == name
        assert frontmatter["model"] == "grok-4.6"
        assert frontmatter["tools"] == "read, grep, find, bash, subagent, subagent_wait"
        assert frontmatter["inheritProjectContext"] == "false"
        assert frontmatter["inheritSkills"] == "false"
        assert frontmatter["maxSubagentDepth"] == "2"


def test_pi_coc_launcher_syncs_only_bundled_steward_agents_to_project_scope():
    launcher = LAUNCHER.read_text(encoding="utf-8")
    assert "STEWARD_AGENT_SOURCE=$REPO_ROOT/plugins/coc-keeper/pi/agents" in launcher
    # The play workspace may differ from the package root: the web/Electron UI
    # sets COC_WORKSPACE, and the TUI falls back to the repo.
    assert (
        "STEWARD_AGENT_RUNTIME=${COC_WORKSPACE:-$REPO_ROOT}/.pi/agents" in launcher
    )
    assert '"$STEWARD_AGENT_SOURCE"/steward-*.md' in launcher
    assert 'cp "$steward_agent" "$target_agent"' in launcher
    assert "export COC_PI_SCENE_SUPPLY=1" in launcher


def test_pi_coc_launcher_mirrors_coordinators_into_the_agent_home():
    """The subagent extension reads the AGENT HOME, not the project surface.

    `opening_source_review_required` advances only through the opening source
    coordinator, and the coordinator lived in `plugins/coc-keeper/agents`
    while the launcher mirrored only the stewards, into a different directory.
    Dispatching it failed with `Unknown agent:
    "coc-opening-source-coordinator"` and the campaign could not leave that
    gate. Seen live on 2026-09-02 in campaign too-many-1920.
    """
    launcher = LAUNCHER.read_text(encoding="utf-8")
    assert (
        "COORDINATOR_AGENT_SOURCE=$REPO_ROOT/plugins/coc-keeper/agents" in launcher
    )
    assert "COORDINATOR_AGENT_RUNTIME=$PI_CODING_AGENT_DIR/agents" in launcher
    assert '"$COORDINATOR_AGENT_SOURCE"/coc-*-coordinator.md' in launcher
    assert 'cp "$coordinator_agent" "$target_agent"' in launcher

    source = ROOT / "plugins" / "coc-keeper" / "agents"
    mirrored = sorted(path.name for path in source.glob("coc-*-coordinator.md"))
    assert "coc-opening-source-coordinator.md" in mirrored, (
        "the coordinator the opening gate demands must be mirrorable"
    )
