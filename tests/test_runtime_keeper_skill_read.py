"""Headless keeper must keep builtin read so Pi injects the skill catalog."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RUNNER = ROOT / "runtime" / "adapters" / "keeper" / "run_keeper_turn.mjs"


def test_runner_activates_read_without_exclusive_allowlist() -> None:
    source = RUNNER.read_text(encoding="utf-8")
    assert 'noTools: "builtin"' in source
    assert "enableKeeperSkillRead(session)" in source
    # An exclusive tools: ["read"] allowlist would drop coc_invoke / coc_discover.
    assert 'tools: ["read"]' not in source
    assert "bash" in source  # blocked-builtin list must stay named


def test_keeper_session_exposes_read_and_skill_catalog(tmp_path: Path) -> None:
    script = r"""
        import { createKeeperSession } from "./runtime/adapters/keeper/run_keeper_turn.mjs";
        import path from "node:path";

        const repo = process.cwd();
        const workspace = process.argv[1];
        const offlineModel = {
          id: "offline",
          name: "Offline",
          provider: "offline",
          api: "openai-completions",
          baseUrl: "http://127.0.0.1",
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 1000,
          maxTokens: 100,
        };
        const session = await createKeeperSession({
          workspace,
          campaign_id: "inspect-skill-read",
          skills_dirs: [
            path.join(repo, "plugins/coc-keeper/skills"),
            path.join(repo, "plugins/coc-keeper/rulesets/coc7/skills"),
          ],
          toolbox_path: path.join(repo, "plugins/coc-keeper/scripts/coc_toolbox.py"),
          runtime_project_root: repo,
          player_input: "",
          play_language: "zh-Hans",
          finalization_offset: 0,
        }, { model: offlineModel });
        const active = session.getActiveToolNames();
        const prompt = session.systemPrompt;
        process.stdout.write(JSON.stringify({
          hasRead: active.includes("read"),
          blocked: ["bash", "edit", "write"].filter((name) => active.includes(name)),
          hasSkillCatalog: prompt.includes("<available_skills>"),
          hasCharacterSkill: prompt.includes("coc-character"),
          mentionsReadTool: prompt.includes("read tool"),
        }));
        session.dispose();
        process.exit(0);
    """
    proc = subprocess.run(
        ["node", "--input-type=module", "--eval", script, str(tmp_path)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=90,
    )
    assert proc.returncode == 0, proc.stderr
    payload = json.loads(proc.stdout)
    assert payload["hasRead"] is True
    assert payload["blocked"] == []
    assert payload["hasSkillCatalog"] is True
    assert payload["hasCharacterSkill"] is True
    assert payload["mentionsReadTool"] is True
