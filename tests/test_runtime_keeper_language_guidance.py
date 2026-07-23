import json
import os
import subprocess

import pytest


def test_system_prompt_carries_language_guidance() -> None:
    """keeperSystemPrompt appends canonical language-craft lines verbatim."""
    script = """
        import { keeperSystemPrompt } from "./runtime/adapters/keeper/run_keeper_turn.mjs";
        const base = {
          runtime_project_root: process.cwd(),
          toolbox_path: "/x/coc_toolbox.py",
          campaign_id: "c",
          play_language: "zh-Hans",
          run_policy: "single_session",
        };
        const withGuidance = keeperSystemPrompt({
          ...base,
          language_guidance: [
            "Use Simplified Chinese for player-visible narration, table dialogue, recaps, and reports.",
            "Foreign names should use Chinese transliterations or conventional translated names.",
          ],
        });
        if (!withGuidance.includes("Chinese transliterations")) {
          throw new Error("guidance missing from prompt");
        }
        if (!withGuidance.includes("Narrate in zh-Hans.")) {
          throw new Error("fallback narration line missing");
        }
        if (!withGuidance.includes("Action uptake (always-on craft)")) {
          throw new Error("action uptake craft missing from system prompt");
        }
        if (!withGuidance.includes("investigator actually doing that")) {
          throw new Error("action uptake enactment line missing");
        }
        const without = keeperSystemPrompt(base);
        if (!without.includes("Narrate in zh-Hans.")) {
          throw new Error("fallback narration line missing without guidance");
        }
        if (!without.includes("Action uptake (always-on craft)")) {
          throw new Error("action uptake craft missing without language guidance");
        }
        console.log("ok");
    """
    proc = subprocess.run(
        ["node", "--input-type=module", "--eval", script],
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert proc.returncode == 0, proc.stderr
    assert "ok" in proc.stdout


def test_session_request_includes_language_guidance(tmp_path) -> None:
    """send() threads the plugin's canonical language profile into the request."""
    from runtime.sdk import api

    api.setup_workspace(
        tmp_path,
        {
            "schema_version": 1,
            "kind": "campaign.quick_start",
            "payload": {
                "scenario_id": "the-haunting",
                "pregen_id": "thomas-hayes",
                "campaign_id": "test",
            },
        },
    )
    sid = api.create_session(
        tmp_path, campaign_id="test", investigator_id="thomas-hayes"
    )
    capture = tmp_path / "captured.json"
    runner = tmp_path / "capture_runner.mjs"
    runner.write_text(
        'import fs from "node:fs";\n'
        'let input = "";\n'
        'process.stdin.on("data", (c) => (input += c));\n'
        'process.stdin.on("end", () => {\n'
        f'  fs.writeFileSync({json.dumps(str(capture))}, input);\n'
        '  process.stdout.write(JSON.stringify({ ok: false, error: "captured" }) + "\\n");\n'
        "  process.exit(1);\n"
        "});\n",
        encoding="utf-8",
    )
    os.environ["COC_KEEPER_RUNNER"] = str(runner)
    try:
        with pytest.raises(Exception):
            api.send(sid, "你好")
    finally:
        os.environ.pop("COC_KEEPER_RUNNER", None)
    request = json.loads(capture.read_text("utf-8"))
    guidance = request.get("language_guidance")
    assert isinstance(guidance, list) and len(guidance) == 3
    assert any("transliteration" in line for line in guidance)
    assert any("localized_terms" in line for line in guidance)
