from __future__ import annotations

import errno
import importlib.util
import hashlib
from copy import deepcopy
import io
import json
import os
from pathlib import Path
import signal
import shlex
import shutil
import subprocess
import sys
import tarfile
import time

import pytest


ROOT = Path(__file__).resolve().parents[1]
PLUGIN = ROOT / "plugins" / "coc-keeper"


def _node(script: Path, *args: str, env: dict[str, str] | None = None) -> dict:
    completed = subprocess.run(
        ["node", "--experimental-strip-types", str(script), *args],
        cwd=ROOT, env=env, check=True, capture_output=True, text=True,
    )
    return json.loads(completed.stdout)


def _load_toolbox():
    path = PLUGIN / "scripts" / "coc_toolbox.py"
    spec = importlib.util.spec_from_file_location("coc_toolbox_pi_revision", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _load_module_sections():
    path = PLUGIN / "scripts" / "coc_module_sections.py"
    spec = importlib.util.spec_from_file_location(
        "coc_module_sections_pi_fixture", path,
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _load_mcp_server():
    path = PLUGIN / "mcp" / "server.py"
    spec = importlib.util.spec_from_file_location(
        "test_coc_pi_package_mcp_server", path,
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _load_pdf_adapter(name: str):
    path = PLUGIN / "pi/bin/coc-pdf-skill-adapter.py"
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_root_manifest_loads_only_main_extension_and_canonical_skills():
    manifest = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    assert manifest["pi"] == {
        "extensions": ["./plugins/coc-keeper/pi/extensions/index.ts"],
        "skills": [
            "./plugins/coc-keeper/skills",
            "./plugins/coc-keeper/rulesets/coc7/skills",
        ],
    }
    assert {".python-version", "pyproject.toml", "uv.lock", "runtime/**", "plugins/coc-keeper/**"} <= set(manifest["files"])
    result = _node(ROOT / "tests/pi/package-smoke.mjs", str(ROOT))
    assert result["extensionCount"] == 1
    assert result["toolNames"] == [
        "coc_capabilities", "coc_discover", "coc_dispatch_source_work",
        "coc_invoke", "coc_progressive_ocr",
    ]
    assert not {"subagent", "edit", "write", "coc_run_source_coordinator", "coc_read_source_packet"} & set(result["toolNames"])
    assert {"coc-main", "coc-keeper-play", "coc-story-director", "coc-rules-engine", "coc-character"} <= set(result["skillNames"])
    assert result["skillDiagnostics"] == []
    assert result["childStartedOnLoad"] is False
    # The loader registers the private fail-closed host bridge. The actual
    # session_start active-surface assertion lives in auto-dispatch-smoke.
    assert result["activeToolNames"] == result["toolNames"]


def test_pi_coc_exposes_subagents_only_on_the_live_kp_surface():
    result = _node(ROOT / "tests/pi/steward-subagent-routing.mjs", str(ROOT))
    assert result == {
        "ok": True,
        "activeTools": [
            "coc_capabilities", "coc_discover", "coc_invoke",
            "coc_progressive_ocr", "subagent", "subagent_wait",
        ],
    }


def test_pi_opening_forwards_only_contract_selected_era_adaptive_creation():
    result = _node(
        ROOT / "tests/pi/guided-character-contract-smoke.mjs",
        str(ROOT),
    )
    assert result == {
        "ok": True,
        "adaptiveInputMode": "kp_guided_era_adaptive",
        "standardInputMode": "guided_quick_fire",
        "unavailableCode": "guided_character_creation_route_unavailable",
        "adaptiveCashSemanticAdmitted": True,
        "adaptiveLooseCashSemanticAdmitted": True,
        "quickFireCashSemanticBlocked": True,
    }


def test_pi_package_metadata_exposes_bounded_opening_preview_compatibility():
    server = _load_mcp_server()
    discovered = server._discover(
        operation="progressive.prepare_opening",
    )
    description = discovered["operation"]["description"]
    assert "opening_page_candidates catalog" in description
    assert "never guess page indices" in description
    arguments_schema = discovered["invoke_card"]["arguments_schema"]
    assert arguments_schema["additionalProperties"] is False
    assert arguments_schema["properties"]["campaign_id"] == {
        "type": "string",
        "minLength": 1,
        "description": (
            "Optional redundant compatibility selector; when present it "
            "must exactly equal the bound outer campaign and is not an "
            "opening semantic selector."
        ),
    }


def test_real_canonical_briefing_receipt_authorizes_conversational_pi_output(
    tmp_path: Path,
    monkeypatch,
):
    monkeypatch.setenv("COC_HOST", "pi")
    server = _load_mcp_server()
    created = server._call_tool("coc_invoke", {
        "operation": "setup.invoke",
        "root": os.fspath(tmp_path),
        "arguments": {
            "kind": "campaign.create",
            "payload": {
                "campaign_id": "pi-visible-briefing",
                "title": "Pi Visible Briefing",
                "play_language": "zh-Hans",
            },
        },
    })
    assert created["ok"] is True, created
    params = {
        "operation": "setup.invoke",
        "campaign": "pi-visible-briefing",
        "arguments": {
            "kind": "campaign.render_briefing",
            "payload": {
                "campaign_id": "pi-visible-briefing",
                "language": "zh-Hans",
            },
        },
    }
    rendered = server._call_tool("coc_invoke", {
        **params,
        "root": os.fspath(tmp_path),
    })
    assert rendered["ok"] is True, rendered
    text = (
        tmp_path / rendered["data"]["result"]["briefing_path"]
    ).read_text(encoding="utf-8")
    fixture = tmp_path / "pi-visible-provenance.json"
    fixture.write_text(json.dumps({
        "workspace": os.fspath(tmp_path),
        "params": params,
        "envelope": rendered,
        "expected_text_sha256": (
            "sha256:"
            + hashlib.sha256(
                json.dumps(
                    text,
                    ensure_ascii=False,
                    separators=(",", ":"),
                ).encode("utf-8")
            ).hexdigest()
        ),
    }), encoding="utf-8")
    result = _node(
        ROOT / "tests/pi/setup-visible-provenance.mjs",
        str(ROOT),
        str(fixture),
    )
    assert result["ok"] is True
    assert result["sourceKind"] == "campaign.render_briefing"
    assert result["publicSetupSha256"] == rendered["data"]["result"][
        "public_setup_sha256"
    ]


def test_coc_tools_register_compact_tui_renderers():
    result = _node(ROOT / "tests/pi/tool-render-smoke.mjs", str(ROOT))
    assert "setup.inspect" in result["callSummary"]
    assert "3 campaigns" in result["resultSummary"]
    assert "ok" in result["resultSummary"]
    for name in (
        "coc_capabilities", "coc_discover", "coc_invoke",
        "coc_dispatch_source_work", "coc_progressive_ocr",
    ):
        assert result["rendererStatus"][name] == {
            "hasRenderCall": True,
            "hasRenderResult": True,
        }


def test_player_safe_hud_model_hides_secrets_and_coding_chrome():
    result = _node(ROOT / "tests/pi/hud-model-smoke.mjs", str(ROOT))
    assert result["ok"] is True
    assert result["clueCount"] == 2
    assert result["itemCount"] == 2
    assert result["prelinkOpeningHidden"] is True
    assert result["operationalErrorVisible"] is True
    assert any("托马斯" in line for line in result["footer"])
    assert any("物品 2" in line for line in result["footer"])


def test_pi_hud_injects_exact_hidden_active_table_identity():
    result = _node(ROOT / "tests/pi/hud-identity-context.mjs", str(ROOT))
    assert result == {
        "ok": True,
        "hidden": True,
        "firstBinding": {
            "schema_version": 1,
            "contract_id": "coc.pi-active-table-identity.v1",
            "campaign_id": "campaign-a",
            "investigator_ids": ["inv-a", "inv-b"],
        },
        "driftPreserved": True,
        "authoritativeResume": True,
        "refreshedBinding": {
            "schema_version": 1,
            "contract_id": "coc.pi-active-table-identity.v1",
            "campaign_id": "campaign-b",
            "investigator_ids": ["inv-c"],
        },
        "emptyOmitted": True,
        "linkRefreshCoalesced": True,
        "setupErrorClassified": True,
    }


def test_pi_coc_host_prompt_and_wrapper_defaults():
    host_prompt = PLUGIN / "pi" / "prompts" / "host-system.md"
    wrapper = PLUGIN / "pi" / "bin" / "pi-coc"
    assert host_prompt.is_file()
    text = host_prompt.read_text(encoding="utf-8")
    assert "pi-coc" in text
    assert "already active" in text.lower() or "已经" in text or "already active" in text
    assert "Never ask" in text or "无需" in text or "never ask" in text.lower()
    assert "coc_capabilities" in text
    assert "never call or construct `coc_dispatch_source_work`" in text
    assert "the Pi extension's private source locator" in text
    assert "never guess a bundle path or reuse an old bundle" in text
    assert "do not use any legacy `coc_progressive_ocr` fast/enhance/export route" in " ".join(text.split()).lower()
    prompt_compact = " ".join(text.split())
    assert "Skill 1: L0 package and source-facts adoption" in prompt_compact
    assert "then start the bounded steward group, and let Skill 3 supply future scenes" in prompt_compact
    for phrase in (
        "Pi-Coc campaign lifecycle is a fixed entry workflow",
        "New campaign, 1 → 2 → 3",
        "hidden first-bundle `located` notification",
        "exact `setup.adopt_source_facts` next operation",
        "Run the idempotent opening bootstrap",
        "Load campaign, 1 → 2 → 3",
        "select it and call `session.resume`",
        "Never guess filesystem paths",
        "hidden wait card is not a producer failure",
    ):
        assert phrase in text, phrase
    assert "zh-Hans" in text
    script = wrapper.read_text(encoding="utf-8")
    assert "--no-context-files" in script
    assert "host-system.md" in script
    assert "--session-id" in script
    assert "coc-keeper" in script
    assert "quietStartup" in script
    assert wrapper.stat().st_mode & 0o111
    main = (PLUGIN / "skills" / "coc-main" / "SKILL.md").read_text(encoding="utf-8")
    assert "pi-coc" in main
    assert "entering the session **is** activation" in main


def _pi_coc_test_home(
    tmp_path: Path, *, settings: dict, models: dict,
    uv_version: str | None = "0.11.16",
) -> tuple[Path, Path]:
    agent_dir = tmp_path / "agent"
    agent_bin = agent_dir / "bin"
    fake_bin = tmp_path / "fake-bin"
    agent_bin.mkdir(parents=True)
    fake_bin.mkdir()
    (agent_dir / "settings.json").write_text(
        json.dumps(settings), encoding="utf-8",
    )
    (agent_dir / "models-store.json").write_text(
        json.dumps(models), encoding="utf-8",
    )
    for name in ("fd", "rg"):
        executable = agent_bin / name
        executable.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
        executable.chmod(0o755)
    fake_pi = fake_bin / "pi"
    fake_pi.write_text(
        (
            '#!/bin/sh\n'
            'for arg in "$@"; do printf "%s\\n" "$arg"; done > "$PI_COC_TEST_ARGS"\n'
            'printf "%s" "${PI_COC_CAMPAIGN_ID-}" > "$PI_COC_TEST_CAMPAIGN"\n'
            'printf "%s" "$PATH" > "$PI_COC_TEST_PATH"\n'
        ),
        encoding="utf-8",
    )
    fake_pi.chmod(0o755)
    if uv_version is not None:
        fake_uv = fake_bin / "uv"
        fake_uv.write_text(
            f"#!/bin/sh\nprintf '%s\\n' 'uv {uv_version}'\n",
            encoding="utf-8",
        )
        fake_uv.chmod(0o755)
    return agent_dir, fake_bin


def _run_pi_coc(
    tmp_path: Path,
    *,
    settings: dict,
    models: dict,
    args: list[str],
    new: bool = True,
    extra_env: dict[str, str] | None = None,
    uv_version: str | None = "0.11.16",
    minimal_path: bool = False,
) -> tuple[subprocess.CompletedProcess[str], Path]:
    agent_dir, fake_bin = _pi_coc_test_home(
        tmp_path, settings=settings, models=models, uv_version=uv_version,
    )
    args_path = tmp_path / "pi-args.txt"
    path_tail = "/usr/bin:/bin" if minimal_path else os.environ["PATH"]
    env = {
        **os.environ,
        "PATH": f"{fake_bin}{os.pathsep}{path_tail}",
        "PI_COC_AGENT_DIR": str(agent_dir),
        "PI_COC_TEST_ARGS": str(args_path),
        "PI_COC_TEST_CAMPAIGN": str(tmp_path / "campaign-id.txt"),
        "PI_COC_TEST_PATH": str(tmp_path / "child-path.txt"),
        **(extra_env or {}),
    }
    wrapper_args = [str(PLUGIN / "pi" / "bin" / "pi-coc")]
    if new:
        wrapper_args.append("--new")
    wrapper_args.extend(args)
    completed = subprocess.run(
        wrapper_args,
        cwd=ROOT,
        env=env,
        check=False,
        capture_output=True,
        text=True,
    )
    return completed, args_path


def _supported_pi_settings() -> tuple[dict, dict]:
    return (
        {
            "defaultProvider": "test",
            "defaultModel": "reasoning-optional",
        },
        {
            "test": {
                "models": [{
                    "id": "reasoning-optional",
                    "reasoning": True,
                    "thinkingLevelMap": {"off": "off", "low": "low"},
                }],
            },
        },
    )


def test_pi_coc_exports_validated_fallback_uv_directory_to_pi_children(
    tmp_path: Path,
):
    settings, models = _supported_pi_settings()
    agent_dir, fake_bin = _pi_coc_test_home(
        tmp_path, settings=settings, models=models, uv_version=None,
    )
    home = tmp_path / "home"
    uv_dir = home / ".local" / "bin"
    uv_dir.mkdir(parents=True)
    uv = uv_dir / "uv"
    uv.write_text("#!/bin/sh\nprintf '%s\\n' 'uv 0.11.16'\n", encoding="utf-8")
    uv.chmod(0o755)
    fake_node = fake_bin / "node"
    fake_node.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    fake_node.chmod(0o755)
    args_path = tmp_path / "pi-args.txt"
    env = {
        **os.environ,
        "HOME": str(home),
        "PATH": f"{fake_bin}{os.pathsep}/usr/bin{os.pathsep}/bin",
        "PI_COC_AGENT_DIR": str(agent_dir),
        "PI_COC_TEST_ARGS": str(args_path),
        "PI_COC_TEST_CAMPAIGN": str(tmp_path / "campaign-id.txt"),
        "PI_COC_TEST_PATH": str(tmp_path / "child-path.txt"),
    }
    completed = subprocess.run(
        [str(PLUGIN / "pi" / "bin" / "pi-coc"), "--new", "--model", "test/model"],
        cwd=ROOT, env=env, check=False, capture_output=True, text=True,
    )
    assert completed.returncode == 0, completed.stderr
    child_path = (tmp_path / "child-path.txt").read_text(encoding="utf-8")
    assert str(uv_dir) in child_path.split(os.pathsep)
    assert child_path.split(os.pathsep).count(str(uv_dir)) == 1
    assert args_path.read_text(encoding="utf-8").splitlines()[-2:] == [
        "--model", "test/model",
    ]


def test_pi_coc_fails_before_pi_when_required_uv_is_missing(tmp_path: Path):
    settings, models = _supported_pi_settings()
    completed, args_path = _run_pi_coc(
        tmp_path, settings=settings, models=models, args=[], uv_version=None,
        minimal_path=True, extra_env={"HOME": str(tmp_path / "empty-home")},
    )
    assert completed.returncode == 1
    assert "required uv 0.11.16 was not found" in completed.stderr
    assert not args_path.exists()


def test_pi_coc_fails_before_pi_when_uv_version_is_wrong(tmp_path: Path):
    settings, models = _supported_pi_settings()
    completed, args_path = _run_pi_coc(
        tmp_path, settings=settings, models=models, args=[], uv_version="0.11.15",
    )
    assert completed.returncode == 1
    assert "required uv 0.11.16, found 'uv 0.11.15'" in completed.stderr
    assert not args_path.exists()


def test_pi_coc_campaign_selector_is_distinct_from_pi_session(tmp_path: Path):
    settings, models = _supported_pi_settings()
    completed, args_path = _run_pi_coc(
        tmp_path,
        settings=settings,
        models=models,
        args=["--campaign", "campaign-a"],
        new=False,
        extra_env={"PI_COC_SESSION_ID": "pi-window-a"},
    )
    assert completed.returncode == 0, completed.stderr
    forwarded = args_path.read_text(encoding="utf-8").splitlines()
    assert forwarded[-2:] == ["--session-id", "pi-window-a"]
    assert "--campaign" not in forwarded
    assert (tmp_path / "campaign-id.txt").read_text(
        encoding="utf-8",
    ) == "campaign-a"


def test_pi_coc_new_transcript_can_resume_existing_campaign(tmp_path: Path):
    settings, models = _supported_pi_settings()
    completed, args_path = _run_pi_coc(
        tmp_path,
        settings=settings,
        models=models,
        args=["--campaign", "campaign-new-transcript"],
        new=True,
        extra_env={"PI_COC_SESSION_ID": "unrelated-pi-window"},
    )
    assert completed.returncode == 0, completed.stderr
    forwarded = args_path.read_text(encoding="utf-8").splitlines()
    assert "--session-id" not in forwarded
    assert "--campaign" not in forwarded
    assert (tmp_path / "campaign-id.txt").read_text(
        encoding="utf-8",
    ) == "campaign-new-transcript"


def test_pi_coc_rejects_missing_campaign_argument(tmp_path: Path):
    settings, models = _supported_pi_settings()
    completed, args_path = _run_pi_coc(
        tmp_path,
        settings=settings,
        models=models,
        args=["--campaign"],
    )
    assert completed.returncode == 2
    assert "--campaign requires a campaign_id" in completed.stderr
    assert not args_path.exists()


@pytest.mark.parametrize(
    "campaign_id",
    [
        "",
        "   ",
        "--new",
        "../outside",
        r"dir\campaign",
        "a" * 129,
    ],
)
def test_pi_coc_rejects_invalid_cli_campaign_before_pi(
    tmp_path: Path,
    campaign_id: str,
):
    settings, models = _supported_pi_settings()
    completed, args_path = _run_pi_coc(
        tmp_path,
        settings=settings,
        models=models,
        args=["--campaign", campaign_id],
    )
    assert completed.returncode == 2
    assert (
        "campaign_id must match ^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"
        in completed.stderr
    )
    assert not args_path.exists()


@pytest.mark.parametrize(
    "campaign_id",
    [
        "",
        "   ",
        "--new",
        "../outside",
        r"dir\campaign",
        "a" * 129,
    ],
)
def test_pi_coc_rejects_invalid_direct_campaign_environment_before_pi(
    tmp_path: Path,
    campaign_id: str,
):
    settings, models = _supported_pi_settings()
    completed, args_path = _run_pi_coc(
        tmp_path,
        settings=settings,
        models=models,
        args=[],
        extra_env={"PI_COC_CAMPAIGN_ID": campaign_id},
    )
    assert completed.returncode == 2
    assert (
        "campaign_id must match ^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"
        in completed.stderr
    )
    assert not args_path.exists()


def test_pi_coc_accepts_direct_explicit_campaign_environment(tmp_path: Path):
    settings, models = _supported_pi_settings()
    campaign_id = "A.valid_name:part-9"
    completed, _args_path = _run_pi_coc(
        tmp_path,
        settings=settings,
        models=models,
        args=[],
        extra_env={"PI_COC_CAMPAIGN_ID": campaign_id},
    )
    assert completed.returncode == 0, completed.stderr
    assert (tmp_path / "campaign-id.txt").read_text(
        encoding="utf-8",
    ) == campaign_id


def test_pi_coc_accepts_valid_punctuation_in_cli_campaign(tmp_path: Path):
    settings, models = _supported_pi_settings()
    campaign_id = "A.valid_name:part-9"
    completed, args_path = _run_pi_coc(
        tmp_path,
        settings=settings,
        models=models,
        args=["--campaign", campaign_id],
    )
    assert completed.returncode == 0, completed.stderr
    assert "--campaign" not in args_path.read_text(
        encoding="utf-8",
    ).splitlines()
    assert (tmp_path / "campaign-id.txt").read_text(
        encoding="utf-8",
    ) == campaign_id


def test_pi_coc_refuses_unsupported_thinking_off_before_pi_starts(tmp_path: Path):
    settings = {"defaultProvider": "xai", "defaultModel": "grok-4.5"}
    models = {
        "xai": {
            "models": [{
                "id": "grok-4.5",
                "reasoning": True,
                "thinkingLevelMap": {"off": None, "low": "low"},
            }],
        },
    }
    completed, args_path = _run_pi_coc(
        tmp_path,
        settings=settings,
        models=models,
        args=["--thinking", "off"],
    )
    assert completed.returncode == 2
    assert "declares thinking off unsupported" in completed.stderr
    assert "silently clamp" in completed.stderr
    assert not args_path.exists()


def test_pi_coc_preserves_supported_thinking_off_exactly(tmp_path: Path):
    settings = {"defaultProvider": "test", "defaultModel": "reasoning-optional"}
    models = {
        "test": {
            "models": [{
                "id": "reasoning-optional",
                "reasoning": True,
                "thinkingLevelMap": {"off": "off", "low": "low"},
            }],
        },
    }
    completed, args_path = _run_pi_coc(
        tmp_path,
        settings=settings,
        models=models,
        args=["--thinking", "off", "hello"],
    )
    assert completed.returncode == 0
    forwarded = args_path.read_text(encoding="utf-8").splitlines()
    assert forwarded[-3:] == ["--thinking", "off", "hello"]


def test_pi_coc_requires_deliberate_valid_level_instead_of_none(tmp_path: Path):
    completed, args_path = _run_pi_coc(
        tmp_path,
        settings={
            "defaultProvider": "xai",
            "defaultModel": "grok-4.5",
            "defaultThinkingLevel": "none",
        },
        models={},
        args=[],
    )
    assert completed.returncode == 2
    assert 'invalid defaultThinkingLevel "none"' in completed.stderr
    assert "hideThinkingBlock=true" in completed.stderr
    assert not args_path.exists()


def test_pi_coc_allows_deliberate_low_without_calling_it_off(tmp_path: Path):
    completed, args_path = _run_pi_coc(
        tmp_path,
        settings={
            "defaultProvider": "xai",
            "defaultModel": "grok-4.5",
            "defaultThinkingLevel": "low",
            "hideThinkingBlock": True,
        },
        models={},
        args=["--thinking", "low"],
    )
    assert completed.returncode == 0
    assert args_path.read_text(encoding="utf-8").splitlines()[-2:] == [
        "--thinking",
        "low",
    ]


def test_pi_coc_welcome_guide_copy():
    result = _node(ROOT / "tests/pi/welcome-smoke.mjs", str(ROOT))
    assert result["ok"] is True
    assert result["fullHasWelcome"] is True
    assert result["fullHasAlreadyActive"] is True
    assert result["fullNoActivatePrompt"] is True
    assert result["fullHasTools"] is True
    assert result["fullHasNew"] is True
    assert result["resumeIsShort"] is True
    assert result["resumeAlreadyActive"] is True
    assert result["resumeReason"] is True
    assert result["newReasonIsFull"] is True
    assert result["headerHasTitle"] is True
    assert result["headerSaysActive"] is True
    assert result["customType"] == "coc-pi-welcome"
    assert result["tableOpenNoAskActivate"] is True
    assert result["noEnvTableOpenUnchanged"] is True
    assert result["startupOpenExactResume"] is True
    assert result["startupOpenNoMenuFirst"] is True
    assert result["startupInstructionTriggered"] is True
    assert result["resumedHiddenResumeInstruction"] is True
    assert result["autoOpenFreshStartup"] is True
    assert result["noAutoOpenResumeHistory"] is True


def test_revision_component_chain_bindings_activation_roles_and_secrets():
    result = _node(ROOT / "tests/pi/revision-probe.mjs", str(ROOT))
    assert result["strictHappy"] == "usable"
    assert all(result["rejects"].values())
    assert result["lifecycle"] == {
        "schema_version": 1,
        "contract_id": "coc.source-coordinator-result.v1",
        "packet_id": "coord-1", "status": "fulfilled",
        "claim_calls": 1, "claimed_packet_count": 2,
        "leaf_task_count": 2, "fulfilled_result_count": 2,
        "failure_class": None, "design_issue_threshold": 3,
    }
    assert result["claimCount"] == 1
    assert result["fulfillCount"] == 2
    assert result["forwardedIdentity"] is True
    assert result["waitedForActivation"] is True
    assert result["concurrentPending"] == {
        "status": "pending",
        "dispatch_key": "coord-2",
        "role": "coordinator",
        "pending_queue_count": 1,
    }
    assert result["submitted"]["status"] == "submitted"
    assert result["secondReplay"]["status"] == "submitted"
    assert result["capturedLaunches"] == [
        {"cwd": str(ROOT), "provider": "provider-1", "modelId": "model-1", "thinking": "low"},
        {"cwd": str(ROOT), "provider": "provider-2", "modelId": "model-2", "thinking": "high"},
    ]
    assert all(result["approvedPendingSemantics"].values())
    assert result["activeShutdownTerminated"] is True
    assert result["failureDuplicate"] == {
        "status": "terminal_failure",
        "dispatch_key": "coord-1",
        "failure_stage": "activation",
        "failure_class": "coordinator_activation_failed",
    }
    assert result["duplicateRefsRejected"] is True
    assert result["symlinkRejected"] is True
    assert result["tokenValueRejected"] is True
    assert result["tokenKeyRejected"] is True
    assert result["directorySymlinkRejected"] is True
    assert result["badModeRejected"] is True
    assert result["badDirectoryModeRejected"] is True
    assert result["tokenEchoRejected"] is True
    assert result["secretKeyOutputRejected"] is True
    assert result["ocrGood"] == {"status": "ok", "layout_noise": "tolerated"}
    assert result["ocrDelayed"] == {"status": "delayed-close"}
    assert result["ocrAbortRejected"] is True
    assert result["coordinatorSurface"] == {
        "registered": ["coc_run_source_coordinator"],
        "active": ["coc_run_source_coordinator"],
    }
    assert result["leafSurface"] == {
        "registered": [],
        "active": [],
    }
    for role, tools in (
        ("coordinator", ["coc_run_source_coordinator"]),
        ("leaf", []),
    ):
        surface = result[f"{role}LoaderSurface"]
        assert surface["extensionCount"] == 1
        assert surface["registered"] == tools
        assert surface["active"] == tools
        assert surface["publicToolsAbsent"] is True
        assert surface["builtinsAbsent"] is True
        assert surface["workspaceSkillAbsent"] is True
        assert surface["contextFiles"] == []
        assert "coc-main" in surface["skills"]
        assert surface["skillDiagnostics"] == []
    assert result["exactModelThinking"] is True
    assert result["noTaskInArgv"] is True
    assert result["isolationFlags"] is True
    assert result["exactCoordinatorAllowlist"] is True
    assert result["exactLeafNoTools"] is True
    assert result["invalidRoleRejected"] is True
    assert result["delayedLeafStatus"] == "usable"
    assert result["childAbortRejected"] is True
    assert result["productionProbeBypassAbsent"] is True


def test_pi_mcp_error_surface_includes_toolbox_code_and_message():
    result = _node(ROOT / "tests/pi/mcp-error-surface.mjs", str(ROOT))
    assert result["ok"] is True
    assert result["asserts"]["hasPendingCode"] is True
    assert result["asserts"]["hasPendingMessage"] is True
    assert result["asserts"]["hasJournalCode"] is True
    assert result["asserts"]["notOpaqueOnlyWhenCoded"] is True
    assert "turn_pending_finalization" in result["cases"]["pendingFinalization"]
    assert "turn_finalization_pending" in result["cases"]["journalBlocked"]
    assert result["cases"]["transport"].startswith("MCP request failed:")


def test_pi_mcp_parallel_dispatch_transport():
    result = _node(ROOT / "tests/pi/mcp-parallel-transport.mjs", str(ROOT))
    assert result["ok"] is True
    assert result["queueTolerance"]["ok"] is True
    assert result["queueTolerance"]["arrivalOrder"] == [1, 2, 3, 4, 5, 6]
    assert result["hangDetection"]["ok"] is True
    assert result["hangDetection"]["statuses"] == ["rejected"] * 3
    assert result["abortIsolation"]["ok"] is True
    assert result["abortIsolation"]["statuses"] == ["fulfilled", "rejected", "fulfilled"]
    assert result["canonicalErrorMetadata"] == {
        "ok": True,
        "errorName": "CanonicalToolError",
        "code": "opening_setup_incomplete",
        "tool": "session.resume",
        "phase": "opening_selection",
    }


def test_pi_leaf_provider_context_failure_isolation_and_terminal_bridge():
    result = _node(ROOT / "tests/pi/structural-repair.mjs", str(ROOT))
    assert result["evidence"] == {
        "contract": "coc.pi-leaf-evidence-context.v1",
        "immutable": True,
        "pageProjectionHasPath": False,
        "containsNonce": False,
        "containsSecretKey": False,
        "openingClockContractCarried": True,
    }
    happy = result["happyProbe"]
    assert happy["rawStdoutHasSentinel"] is False
    assert happy["parsed"] == {
        "providerHasSentinel": True,
        "sessionHasSentinel": False,
        "eventsHaveSentinel": False,
        "providerCalls": 1,
        "registered": [],
        "active": [],
    }
    valid_cli = result["validCliProbe"]
    assert valid_cli["exitCode"] == 0
    assert valid_cli["exitFailedClosed"] is False
    assert valid_cli["providerCalls"] == 1
    assert valid_cli["stdoutHasSentinel"] is False
    assert valid_cli["stderrHasSentinel"] is False
    assert valid_cli["stdoutIsJsonLines"] is True
    for failed in result["preloadFailures"]:
        assert failed["exitFailedClosed"] is True
        assert failed["providerCalls"] == 0
        assert failed["stdoutHasSentinel"] is False
        assert failed["stderrHasSentinel"] is False
        assert failed["stdoutIsJsonLines"] is True
        assert failed["stderrBytes"] > 0
    assert result["partial"]["status"] == "partial"
    assert result["partial"]["fulfilled_result_count"] == 2
    assert result["partial"]["failure_class"] == "fulfill_rejected"
    assert result["siblingContinued"] is True
    assert result["identityPreserved"] is True
    assert result["rejectedLeafPartial"]["status"] == "partial"
    assert result["rejectedLeafPartial"]["failure_class"] == "leaf_dispatch_failed"
    assert result["rejectedLeafForwarded"] == ["job-2"]
    assert result["invalidLeafPartial"]["status"] == "partial"
    assert result["invalidLeafPartial"]["failure_class"] == "leaf_result_invalid"
    assert result["invalidLeafForwarded"] == ["job-2"]
    assert result["productionFailures"] == [
        {
            "kind": "failure",
            "stage": "framing",
            "failure_class": "leaf_result_not_bare",
            "diagnostic": {
                "code": "leaf_framing_not_one_text",
                "path": "assistant.content",
            },
        },
        {
            "kind": "failure",
            "stage": "validation",
            "failure_class": "leaf_result_invalid",
            "diagnostic": {
                "code": "leaf_result_packet_binding_drift",
                "path": "$.packet_id|$.work_group_id",
            },
        },
        {"kind": "failure", "stage": "activation", "failure_class": "leaf_dispatch_failed"},
    ]
    assert result["framingLeafPartial"]["status"] == "partial"
    assert result["framingLeafPartial"]["failure_class"] == "leaf_result_not_bare"
    assert result["framingLeafForwarded"] == ["job-2"]
    assert result["framingSiblingExact"] is True
    assert result["allFailed"]["status"] == "failed"
    assert result["allFailed"]["fulfilled_result_count"] == 0
    lease = result["leaseLifecycle"]
    assert lease["renewExact"] is True
    assert lease["renewCount"] >= 1
    assert lease["renewDuringFulfill"] >= 1
    assert lease["fulfillPreserved"] is True
    assert lease["releaseAfterFulfill"] == 0
    assert all(entry["status"] == "succeeded" for entry in lease["renewAudit"])
    assert lease["renewCoverage"]["exact"] == {
        "resultStatus": "fulfilled",
        "lifecycleStatus": "succeeded",
        "failureClass": None,
        "ttlFallback": False,
    }
    assert lease["renewCoverage"]["subset"] == {
        "resultStatus": "fulfilled",
        "lifecycleStatus": "partial",
        "failureClass": "lease_ownership_partial",
        "ttlFallback": True,
    }
    assert lease["renewCoverage"]["mixed"] == {
        "resultStatus": "fulfilled",
        "lifecycleStatus": "partial",
        "failureClass": "lease_ownership_partial",
        "ttlFallback": True,
    }
    for mode in ("foreign", "duplicate", "overlap", "malformed"):
        assert lease["renewCoverage"][mode] == {
            "resultStatus": "fulfilled",
            "lifecycleStatus": "failed",
            "failureClass": "lease_response_invalid",
            "ttlFallback": True,
        }
    assert lease["interruptStatus"] == "failed"
    assert lease["interruptRelease"] == {
        "signalAborted": False,
        "arguments": {
            "asset_root_id": "asset-fixture",
            "executor_id": "pi:test",
            "lease_ids": ["packet-1"],
            "reason": "coordinator_shutdown",
        },
    }
    assert lease["wrongOwnerAudit"] == [
        {
            "schema_version": 1,
            "contract_id": "coc.pi-source-lease-lifecycle.v1",
            "phase": "release",
            "status": "rejected",
            "asset_root_id": "asset-fixture",
            "executor_id": "pi:test",
            "lease_ids": ["packet-1"],
            "reason": "coordinator_failed",
            "failure_class": "lease_ownership_mismatch",
        },
        {
            "schema_version": 1,
            "contract_id": "coc.pi-source-lease-lifecycle.v1",
            "phase": "ttl_fallback",
            "status": "ttl_fallback",
            "asset_root_id": "asset-fixture",
            "executor_id": "pi:test",
            "lease_ids": ["packet-1"],
            "reason": "wrong_owner_or_unconfirmed_lease",
            "recovery": "bounded_ttl",
        },
    ]
    assert lease["releaseCoverage"]["exact"] == {
        "resultStatus": "failed",
        "lifecycleStatus": "succeeded",
        "failureClass": None,
        "ttlFallback": False,
    }
    assert lease["releaseCoverage"]["subset"] == {
        "resultStatus": "failed",
        "lifecycleStatus": "partial",
        "failureClass": "lease_ownership_partial",
        "ttlFallback": True,
    }
    assert lease["releaseCoverage"]["mixed"] == {
        "resultStatus": "failed",
        "lifecycleStatus": "partial",
        "failureClass": "lease_ownership_partial",
        "ttlFallback": True,
    }
    for mode in ("foreign", "duplicate", "overlap", "malformed"):
        assert lease["releaseCoverage"][mode] == {
            "resultStatus": "failed",
            "lifecycleStatus": "failed",
            "failureClass": "lease_response_invalid",
            "ttlFallback": True,
        }
    assert lease["partialFulfillRelease"]["resultStatus"] == "partial"
    assert lease["partialFulfillRelease"]["fulfilledResultCount"] == 1
    assert lease["partialFulfillRelease"]["audit"] == [
        {
            "schema_version": 1,
            "contract_id": "coc.pi-source-lease-lifecycle.v1",
            "phase": "release",
            "status": "succeeded",
            "asset_root_id": "asset-fixture",
            "executor_id": "pi:test",
            "lease_ids": ["packet-1"],
            "reason": "coordinator_partial",
        },
    ]
    assert lease["releaseFailureAudit"] == [
        {
            "schema_version": 1,
            "contract_id": "coc.pi-source-lease-lifecycle.v1",
            "phase": "release",
            "status": "failed",
            "asset_root_id": "asset-fixture",
            "executor_id": "pi:test",
            "lease_ids": ["packet-1"],
            "reason": "coordinator_failed",
            "failure_class": "lease_call_failed",
        },
        {
            "schema_version": 1,
            "contract_id": "coc.pi-source-lease-lifecycle.v1",
            "phase": "ttl_fallback",
            "status": "ttl_fallback",
            "asset_root_id": "asset-fixture",
            "executor_id": "pi:test",
            "lease_ids": ["packet-1"],
            "reason": "graceful_release_failed",
            "recovery": "bounded_ttl",
        },
    ]
    assert lease["hardCrashRecoveryClaim"] == (
        "bounded TTL only; no graceful release receipt exists after abrupt "
        "process loss"
    )
    assert result["terminal"] == {
        "absentRejected": True,
        "duplicateRejected": True,
        "bindingRejected": True,
        "authorityRejected": True,
        "contentDetailsRejected": True,
        "impossibleRejected": True,
        "designIssueRejected": True,
        "diagnosticRejected": True,
    }
    assert result["manager"]["notifications"] == 1
    assert result["manager"]["lifecycle"] == 1
    assert result["manager"]["duplicateDiagnostic"]["status"] == "completed"
    assert result["manager"]["duplicateDiagnostic"]["terminal_receipt"]["packet_id"] == "coord-manager"
    assert result["manager"]["absentState"] == {
        "status": "terminal_failure",
        "dispatch_key": "coord-manager-absent",
        "failure_stage": "framing",
        "failure_class": "coordinator_result_invalid",
    }
    assert result["manager"]["absentNotifications"] == 0
    assert result["manager"]["absentLifecycle"] == 1
    assert result["manager"]["rejectedLifecycle"] == 1
    assert result["manager"]["throwingState"]["status"] == "completed"
    assert result["manager"]["throwingState"]["terminal_receipt"]["packet_id"] == "coord-manager-notify-failure"
    assert result["manager"]["throwingState"]["notification"] == {
        "status": "failed", "failure_class": "notification_callback_failed",
    }
    assert result["manager"]["throwingLifecycle"] == 1
    assert result["manager"]["closingRejected"] is True
    assert result["manager"]["raceActive"] == 0
    assert result["manager"]["raceLifecycle"] == 1
    assert result["notification"] == {
        "appended": 1,
        "appendPreservesReceipt": True,
        "duplicateAppended": 1,
        "sent": 1,
        "options": {"triggerTurn": True, "deliverAs": "followUp"},
        "display": False,
        "content": {
            "dispatch_key": "coord-manager",
            "status": "partial",
            "terminal": True,
            "failure_class": "fulfill_rejected",
            "automatic_retry_remaining": False,
            "continuation_class": "blocking_opening",
            "dispatch_class": "blocking_opening",
            "player_turn_epoch": 1,
        },
        "details": {
            "dispatch_key": "coord-manager",
            "status": "partial",
            "terminal": True,
            "failure_class": "fulfill_rejected",
            "automatic_retry_remaining": False,
            "continuation_class": "blocking_opening",
            "dispatch_class": "blocking_opening",
            "player_turn_epoch": 1,
        },
        "customTypes": [
            "coc-source-coordinator-terminal",
            "coc-source-coordinator-terminal-continuation",
        ],
        "leaksSource": False,
        "report": {
            "status": "delivered",
            "append_entry": "delivered",
            "hidden_continuation": "delivered",
            "player_transcript": "suppressed",
        },
        "duplicateReport": {
            "status": "delivered",
            "append_entry": "delivered",
            "hidden_continuation": "deduplicated",
            "player_transcript": "suppressed",
        },
        "failedReport": {
            "status": "failed",
            "append_entry": "failed",
            "hidden_continuation": "failed",
            "player_transcript": "suppressed",
            "append_failure_class": "append_entry_failed",
            "continuation_failure_class": "hidden_continuation_failed",
        },
        "failedAppendCalls": 1,
        "failedSendCalls": 1,
    }


def test_pi_player_transcript_hides_unsettled_and_tool_framing_text():
    result = _node(ROOT / "tests/pi/player-transcript-gate.mjs", str(ROOT))
    assert result == {
        "registered": ["message_end", "message_start", "message_update"],
        "startTypes": [],
        "pendingTypes": [],
        "toolUpdateTypes": ["toolCall"],
        "toolFinalOriginalTypes": ["text", "toolCall", "text"],
        "toolFinalReturnedTypes": ["toolCall"],
        "toolFinalRole": "assistant",
        "narrationReturned": True,
        "narrationText": "雨水沿着窗玻璃缓缓滑落。",
        "awaitingWaitReturnedTypes": [],
        "unrelatedWhileAwaitingReturned": True,
        "validOpeningReturned": True,
        "validOpeningText": "马车在白昼里停到城堡门前。",
        "mismatchedDigestRejected": True,
        "rawUtf8DigestRejected": True,
        "finalizedArmed": True,
        "earlyMismatch": {
            "armed": True,
            "continuationClass": (
                "nonblocking_background_after_finalized_output"
            ),
            "digestMatches": True,
            "mismatchReplacedExact": True,
            "followUpSuppressed": True,
        },
        "arbitraryBeforeExactReplacedExact": True,
        "toolBearingAfterFinalizeTypes": ["toolCall"],
        "finalizedNarrationSuppressed": True,
        "mismatchAfterExactSuppressed": True,
        "finalizedWake": {
            "appended": 1,
            "sent": 0,
            "noModelOpportunity": True,
            "report": {
                "status": "delivered",
                "append_entry": "delivered",
                "hidden_continuation": "suppressed_nonblocking",
                "player_transcript": "suppressed",
            },
        },
        "failedBackgroundWake": {
            "appended": 1,
            "sent": 0,
            "decideWakeCalls": 0,
            "noModelOpportunity": True,
            "report": {
                "status": "delivered",
                "append_entry": "delivered",
                "hidden_continuation": "suppressed_nonblocking",
                "player_transcript": "suppressed",
            },
        },
        "blockingAfterFinalizedReturned": True,
        "userText": "我走近窗边。",
        "staleEpochNarrationReturned": True,
        "terminal": {
            "appended": 2,
            "sent": 1,
            "display": False,
            "options": {"triggerTurn": True, "deliverAs": "followUp"},
            "content": {
                "dispatch_key": "coord-player-boundary",
                "status": "fulfilled",
                "terminal": True,
                "failure_class": None,
                "automatic_retry_remaining": False,
                "continuation_class": "blocking_opening",
                "dispatch_class": "blocking_opening",
                "player_turn_epoch": 2,
            },
            "details": {
                "dispatch_key": "coord-player-boundary",
                "status": "fulfilled",
                "terminal": True,
                "failure_class": None,
                "automatic_retry_remaining": False,
                "continuation_class": "blocking_opening",
                "dispatch_class": "blocking_opening",
                "player_turn_epoch": 2,
            },
            "leaksPrivate": False,
            "report": {
                "status": "delivered",
                "append_entry": "delivered",
                "hidden_continuation": "delivered",
                "player_transcript": "suppressed",
            },
            "duplicateReport": {
                "status": "delivered",
                "append_entry": "delivered",
                "hidden_continuation": "deduplicated",
                "player_transcript": "suppressed",
            },
        },
        "structuredWake": {
            "awaitingSent": 1,
            "consumedSent": 0,
            "consumedAppended": 1,
            "consumedDeferredWhileAwaiting": True,
            "consumedReport": {
                "status": "delivered",
                "append_entry": "delivered",
                "hidden_continuation": "suppressed_consumed",
                "player_transcript": "suppressed",
            },
            "unfinishedSent": 1,
            "unfinishedAppended": 1,
            "unfinishedDeferredBeforeEnd": True,
            "unfinishedReport": {
                "status": "delivered",
                "append_entry": "delivered",
                "hidden_continuation": "delivered",
                "player_transcript": "suppressed",
            },
            "unfinishedContinuationClass": "blocking_opening",
            "unfinishedDispatchClass": "blocking_opening",
            "terminalBlockerWhileAwaitingReturned": True,
            "sessionReuse": {
                "staleSent": 0,
                "staleAppended": 1,
                "staleReport": {
                    "status": "delivered",
                    "append_entry": "delivered",
                    "hidden_continuation": "suppressed_consumed",
                    "player_transcript": "suppressed",
                },
                "staleContinued": True,
                "currentSent": 1,
                "currentAppended": 1,
                "currentReport": {
                    "status": "delivered",
                    "append_entry": "delivered",
                    "hidden_continuation": "delivered",
                    "player_transcript": "suppressed",
                },
                "currentContinued": True,
            },
        },
        "realLoop": {
            "piVersion": "0.81.1",
            "sameContentObject": False,
            "startLength": 0,
            "endLength": 1,
            "unrelatedFirstVisible": True,
            "toolBearingTextHidden": True,
            "operationalWaitSuppressed": True,
        },
        "realFinalizationLoop": {
            "armed": True,
            "arbitraryVisible": True,
            "toolBearingTypes": ["toolCall"],
            "exactVisible": True,
            "redundantSuppressed": True,
            "structuredCustomStartObserved": True,
            "producerContext": {
                "continuationClass": (
                    "nonblocking_background_after_finalized_output"
                ),
                "dispatchClass": "nonblocking_background",
                "playerTurnEpoch": 1,
                "digestMatches": True,
                "dispatchKey": "coord-real-finalizer-probe",
            },
        },
        "realEarlyFinalizationLoop": {
            "piVersion": "0.81.1",
            "armed": True,
            "earlyContextBeforeExactDelivery": {
                "appended": 1,
                "sent": 0,
                "continuationClass": (
                    "nonblocking_background_after_finalized_output"
                ),
                "dispatchClass": "nonblocking_background",
                "playerTurnEpoch": 1,
                "digestMatches": True,
                "dispatchKey": "coord-real-early-finalizer-probe",
                "report": {
                    "status": "delivered",
                    "append_entry": "delivered",
                    "hidden_continuation": "suppressed_nonblocking",
                    "player_transcript": "suppressed",
                },
            },
            "exactVisible": True,
            "redundantSuppressed": True,
            "queuedCustomObserved": True,
        },
        "adversarialFinalizationInterleave": {
            "armed": True,
            "durableOrder": [
                "coc-source-coordinator-lifecycle",
                "coc-source-coordinator-terminal",
            ],
            "terminalReport": {
                "status": "delivered",
                "append_entry": "delivered",
                "hidden_continuation": "suppressed_nonblocking",
                "player_transcript": "suppressed",
            },
            "sent": 0,
            "decideWakeCalls": 0,
            "replacement": {
                "exact": True,
                "wrongSuppressed": True,
                "textParts": 1,
                "staleSignatureRemoved": True,
            },
            "duplicateExactSuppressed": True,
            "exactAssistantAllowedOnce": True,
            "stalePreviousEpochAllowed": True,
            "openingExactAllowed": True,
            "openingWakeConsumed": True,
        },
    }


def test_pi_mechanical_output_gate_intercepts_unbound_markers():
    result = _node(ROOT / "tests/pi/mechanical-output-gate.mjs", str(ROOT))
    assert result == {
        "detection": {
            "p47Total": 6,
            "p47Classes": {"dice": 4, "resource": 2},
            "p47HasFormalDiceBlock": True,
            "p47HasSanTransfer": True,
            "p47HasLossPoints": True,
            "prose": 0,
            "hpTransfer": 1,
            "hpTransferClass": "resource",
            "diceLineOnly": 1,
            "diceLineOnlyClass": "dice",
            "lossPoints": 1,
        },
        "gate": {
            "noReceiptIntercepted": True,
            "noReceiptEnvelope": {
                "kind": "mechanical_output_gate",
                "status": "intercepted",
                "action": "execute_then_render",
                "playerTurnEpoch": 1,
                "schemaVersion": 1,
                "uncoveredClasses": [
                    "dice", "dice", "dice", "dice",
                    "resource", "resource",
                ],
                "hasInstruction": True,
            },
            "diceOnlyStillIntercepted": True,
            "diceOnlyUncoveredClasses": ["resource", "resource"],
            "boundReleased": True,
            "boundEnvelopeEmpty": True,
            "proseReleased": True,
            "staleEpochIntercepted": True,
            "staleEpochUncoveredClasses": [
                "dice", "dice", "dice", "dice",
                "resource", "resource",
            ],
            "reboundReleased": True,
            "failedToolsNeverBind": True,
            "finalizeBoundReleased": True,
        },
        "delivery": {
            "delivered": True,
            "deliveredEmpty": False,
            "appended": 1,
            "sent": 1,
            "customType": "coc-mechanical-output-gate",
            "display": False,
            "options": {"triggerTurn": True, "deliverAs": "followUp"},
            "contentParsed": {
                "schema_version": 1,
                "kind": "mechanical_output_gate",
                "status": "intercepted",
                "player_turn_epoch": 1,
                "uncovered_markers": [
                    {
                        "class": "dice",
                        "pattern": "formal_dice_block",
                        "sample": "【明骰】",
                    },
                    {
                        "class": "dice",
                        "pattern": "formal_dice_block",
                        "sample": "【明骰】",
                    },
                    {
                        "class": "dice",
                        "pattern": "dice_line",
                        "sample": "掷骰：14",
                    },
                    {
                        "class": "dice",
                        "pattern": "dice_line",
                        "sample": "掷骰：63",
                    },
                    {
                        "class": "resource",
                        "pattern": "san_transfer",
                        "sample": "SAN 50→46",
                    },
                    {
                        "class": "resource",
                        "pattern": "loss_points",
                        "sample": "损失 1D6 → 4 点",
                    },
                ],
                "action": "execute_then_render",
                "instruction": (
                    "你的上一条输出包含正式机械标记（【明骰】／掷骰：N／SAN·HP 数值转移），"
                    "但本回合没有对应的权威收据，已被门禁拦截、未送达玩家。"
                    "机械数字只能来自规则/状态收据：先经 coc_invoke 执行——骰点走 "
                    "rules.roll / rules.opposed / sanity.execute / rules.damage 等并取得返回的 "
                    "roll_id，结算与 SAN/HP 落账走 state.* 并取得 decision_id——"
                    "再按收据数字渲染正式标记；禁止凭叙述编造或推算骰点与数值变动。"
                    "执行完成后重新输出即可放行。"
                ),
            },
        },
        "transcriptGate": {
            "p47InterceptedTextParts": 0,
            "prosePassed": True,
        },
    }


def test_real_pi_gateway_uses_canonical_finalizer_string_digest():
    result = _node(ROOT / "tests/pi/finalization-gateway.mjs", str(ROOT))
    assert result == {
        "piVersion": "0.81.1",
        "gatewayCalls": [
            {
                "name": "coc_invoke",
                "params": {
                    "operation": "turn.finalize",
                    "campaign": "hoyk-pi-grok-fix7-20260727",
                    "arguments": {},
                },
            },
            {
                "name": "coc_invoke",
                "params": {
                    "operation": "turn.finalize",
                    "campaign": "hoyk-pi-grok-fix7-20260727",
                    "arguments": {},
                },
            },
        ],
        "gatewayEnvelope": {
            "ok": True,
            "tool": "turn.finalize",
            "canonicalOperation": "turn.finalize",
            "renderedTextExact": True,
            "renderedDigestExact": True,
        },
        "digest": {
            "receipt": (
                "sha256:09f98a4af3dd62654cff7d27c7adc1fac2224955463f845"
                "7eba953b44767a806"
            ),
            "canonical": (
                "sha256:09f98a4af3dd62654cff7d27c7adc1fac2224955463f845"
                "7eba953b44767a806"
            ),
            "rawUtf8": (
                "sha256:64d5d68441b331cc3a9df159f366c4fc574c12082ba73f9"
                "a7128d88186553919"
            ),
            "canonicalMatchesReceipt": True,
            "rawUtf8RejectedByContract": True,
        },
        "exactVisible": True,
        "redundantSuppressed": True,
        "queuedCustomObserved": True,
        "rawGatewayRejected": {
            "exactVisible": True,
            "followUpVisible": True,
        },
    }


def test_pi_gateway_accepts_only_object_or_plain_object_json_arguments():
    result = _node(ROOT / "tests/pi/invoke-string-arguments.mjs", str(ROOT))
    assert result == {
        "schemaTypes": ["object", "string"],
        "stringifiedDeliveredExact": True,
        "objectPathIdentityUnchanged": True,
        "stringResultOk": True,
        "objectResultOk": True,
        "clientCallCount": 2,
        "rejected": {
            "malformed": (
                "coc_invoke arguments JSON string must be valid JSON "
                "encoding a plain object"
            ),
            "array": (
                "coc_invoke arguments JSON string must encode a plain object"
            ),
            "null": (
                "coc_invoke arguments JSON string must encode a plain object"
            ),
            "scalar": (
                "coc_invoke arguments JSON string must encode a plain object"
            ),
        },
    }


def test_pi_auto_dispatch_uses_named_paths_bounded_queues_and_scene_priority():
    """The Node contract includes Pi-only source-bound scene priority."""
    completed = subprocess.run(
        ["node", "--experimental-strip-types", str(ROOT / "tests/pi/auto-dispatch-smoke.mjs"), str(ROOT)],
        cwd=ROOT, check=True, capture_output=True, text=True,
    )
    assert completed.stdout.strip() == "auto-dispatch smoke OK"


def test_pi_raw_pdf_bind_dispatch_deduplicates_concurrent_retries():
    """Two concurrent raw-PDF-bind retries for the same path share one
    in-flight locator producer run; a completed retry is served from the
    finished cache. Regression for the Cold Harvest acceptance observation
    of a duplicate concurrent locator child timing out while its sibling
    succeeded."""
    completed = subprocess.run(
        ["node", "--experimental-strip-types", str(ROOT / "tests/pi/raw-pdf-bind-dedup-smoke.mjs"), str(ROOT)],
        cwd=ROOT, check=True, capture_output=True, text=True,
    )
    assert completed.stdout.strip() == "raw-pdf-bind dedup smoke OK"


def test_pi_cold_harvest_classify_sections_empty_entity_fixture_contract():
    """Keep the observed Pi failure shape without retaining source prose."""
    fixture = json.loads((
        ROOT / "tests/pi/fixtures/cold-harvest-classify-sections-empty-entity.json"
    ).read_text(encoding="utf-8"))
    sections_module = _load_module_sections()
    assert fixture["scope"] == "pi-coc"
    assert fixture["source_content_omitted"] == [
        "titles", "pdf_indices", "source_text", "source_specific_entity_ids",
    ]
    assert fixture["correction_contract"]["legal_resolutions"] == [
        "entity_with_existing_entity_id", "global", "unresolved_omit_section",
    ]

    row_fields = {
        "section_id", "audience", "timing", "payload", "binding", "confidence",
    }

    def materialize(rows: list[dict]) -> tuple[dict, list[dict]]:
        # The fixture intentionally carries no module title, page, or entity-id
        # content. These inert slots only satisfy the canonical row shape.
        candidates: list[dict] = []
        materialized: list[dict] = []
        for index, source_row in enumerate(rows):
            title = f"fixture-section-{index:03d}"
            candidates.append({
                "section_id": source_row["section_id"],
                "title": title,
                "pdf_index": index,
            })
            materialized.append({
                **deepcopy(source_row),
                "title": title,
                "pdf_indices": [index],
            })
        return {"candidates": candidates, "page_count": len(rows)}, materialized

    for attempt in fixture["attempts"]:
        observed_rows = attempt["sections"]
        expected = attempt["expected"]
        assert attempt["toolbox_error"] == "invalid_source_worker_pack"
        assert len(observed_rows) == expected["row_count"]
        assert all(set(row) == row_fields for row in observed_rows)
        assert all(set(row["binding"]) == {
            "kind", "entity_kind", "entity_ids",
        } for row in observed_rows)
        assert all(row["binding"]["entity_ids"] == [] for row in observed_rows)
        empty_entities = [
            (index, row) for index, row in enumerate(observed_rows)
            if row["binding"]["kind"] == "entity"
            and row["binding"]["entity_ids"] == []
        ]
        assert len(empty_entities) == expected["empty_entity_count"]
        first_index, first_row = empty_entities[0]
        assert first_index == 6
        assert first_row["section_id"] == expected["first_error"]["section_id"]
        assert expected["first_error"]["path"] == f"sections[{first_index}].binding"
        request, result_rows = materialize(observed_rows)
        with pytest.raises(sections_module.SectionIndexError) as exc_info:
            sections_module.validate_section_rows(result_rows, request=request)
        assert str(exc_info.value) == expected["first_error"]["message"]

    correction = fixture["correction_contract"]
    global_binding = {
        "kind": "global", "entity_kind": None, "entity_ids": [],
    }
    assert sections_module._validate_binding(
        global_binding, prefix="correction.global",
    ) == global_binding
    known_entity_ids = {
        entity_kind: set(entity_ids)
        for entity_kind, entity_ids in correction[
            "test_only_existing_entity_ids"
        ].items()
    }

    def is_existing_entity_binding(binding: dict) -> bool:
        entity_kind = binding.get("entity_kind")
        entity_ids = binding.get("entity_ids")
        return (
            binding.get("kind") == "entity"
            and isinstance(entity_kind, str)
            and isinstance(entity_ids, list)
            and bool(entity_ids)
            and set(entity_ids) <= known_entity_ids.get(entity_kind, set())
        )

    for entity_kind, entity_ids in known_entity_ids.items():
        entity_id = next(iter(entity_ids))
        assert entity_id.startswith("fixture-existing-")
        binding = {
            "kind": "entity",
            "entity_kind": entity_kind,
            "entity_ids": [entity_id],
        }
        assert is_existing_entity_binding(binding)
        assert sections_module._validate_binding(
            binding, prefix=f"correction.{entity_kind}",
        ) == binding
    assert not is_existing_entity_binding({
        "kind": "entity",
        "entity_kind": "location",
        "entity_ids": ["fixture-unregistered-location"],
    })

    # In this contract, unresolved means omitting a candidate, not inventing an
    # entity id or a third binding kind. The canonical validator accepts it.
    assert correction["unresolved_representation"] == "omit_section_row"
    request, result_rows = materialize(fixture["attempts"][0]["sections"][:7])
    unresolved_section_id = result_rows[-1]["section_id"]
    validated = sections_module.validate_section_rows(
        result_rows[:-1], request=request,
    )
    assert unresolved_section_id not in {
        row["section_id"] for row in validated
    }


def test_real_node22_preactivation_failures_are_owned_and_cleaned():
    result = _node(ROOT / "tests/pi/preactivation-ownership.mjs", str(ROOT))
    assert result["node"].startswith("v22.")
    assert "exited before activation (7)" in result["managerNonzero"]["error"]
    assert result["managerNonzero"]["completionError"] == result["managerNonzero"]["error"]
    assert result["managerNonzero"]["active"] == 0
    assert result["managerAbort"] == {
        "error": "Pi child aborted", "completionError": "Pi child aborted", "active": 0,
    }
    assert "exited before activation (7)" in result["leafNonzero"]["error"]
    assert result["leafNonzero"]["completionError"] == result["leafNonzero"]["error"]
    assert result["leafNonzero"]["owned"] == 0
    assert result["leafAbort"] == {
        "error": "Pi child aborted", "completionError": "Pi child aborted", "owned": 0,
    }


def test_pi_projection_uses_task_return_and_repository_produced_leaf_wrappers(monkeypatch):
    toolbox = _load_toolbox()
    dispatch = toolbox._pi_source_coordinator_dispatch(
        workspace_root="/workspace", campaign_id="campaign-a",
        asset_root_id="asset-a",
        ready_background=[{"job_id": "job-a", "work_group_id": "group-a"}],
    )
    task = dispatch["pi_task"]
    assert task["contract_id"] == "coc.pi-source-coordinator-task.v1"
    assert task["packet"]["claim_operation"]["prefilled_arguments"]["result_delivery"] == "task_return_to_parent"
    canonical = json.loads((PLUGIN / "references/source-coordinator-v1.json").read_text(encoding="utf-8"))
    variation = canonical["packet"]["claim_operation"]["transport_variations"]["pi_private_lifecycle"]
    assert variation["result_delivery"] == task["packet"]["claim_operation"]["prefilled_arguments"]["result_delivery"]
    assert variation["claim_result_field"] == "dispatch_tasks"
    assert variation["optional_private_exact_claim_field"] == (
        "current_dependency_claim"
    )
    assert variation["private_exact_claim_cardinality"] == 1
    assert variation["main_keeper_may_supply_private_exact_claim"] is False
    retry_contract = canonical["failure_policy"][
        "manager_automatic_retry_by_adapter"
    ]["pi_private_lifecycle"]
    assert canonical["failure_policy"]["coordinator_self_retry"] is False
    assert retry_contract["owner"] == (
        "pi_source_coordinator_dispatch_manager"
    )
    assert retry_contract["same_task_retry"] is True
    assert retry_contract["manager_repairs_receipt_or_leaf_result"] is False
    assert task["packet"]["failure_policy"]["automatic_retry"] == {
        key: retry_contract[key]
        for key in (
            "retryable_failure_classes",
            "require_status",
            "require_positive_claimed",
            "require_zero_fulfilled",
            "max_attempts",
        )
    }
    assert retry_contract["max_attempts"] == 2
    assert retry_contract["interim_terminal_receipt_published"] is False
    assert retry_contract["interim_parent_wake"] is False
    assert canonical["lifecycle"]["pi_parent_terminal_delivery"] == (
        "append_final_receipt_then_wake_only_structured_blocking_opening_or_"
        "exact_fulfilled_current_dependency"
    )
    assert canonical["lifecycle"]["pi_nonblocking_background_parent_wake"] is False
    assert canonical["lifecycle"]["pi_hidden_continuation_source"] == (
        "final_validated_receipt_plus_structured_blocking_opening_or_exact_"
        "current_dependency_dispatch_identity"
    )
    assert canonical["result_contract"]["optional_fields"] == [
        "diagnostics", "lease_release",
    ]
    assert task["packet"]["leaf_worker"]["prompt_binding"] == (
        "one exact repository-produced dispatch_tasks[] "
        "coc.pi-source-pack-task.v1 value"
    )
    packet = {
        "schema_version": 1, "contract_id": "coc.source-pack-worker.v1",
        "packet_id": "packet-a", "work_group_id": "group-a", "requests": [],
    }
    monkeypatch.setenv("COC_HOST", "pi")
    wrapped = toolbox._pi_source_pack_dispatch_task(packet)
    assert wrapped["contract_id"] == "coc.pi-source-pack-task.v1"
    assert wrapped["packet"] == packet
    assert "codex_task" not in wrapped


def test_capability_promoted_after_real_lifecycle_probe():
    pi = json.loads((PLUGIN / "references/host-capabilities.json").read_text(encoding="utf-8"))["pi"]
    assert pi["plugin_skills"] is True and pi["plugin_mcp"] is True
    assert pi["coc_source_coordinator_v1"] is True
    assert pi["coc_source_coordinator_v1_status"] == "experimental"
    assert pi["coc_source_coordinator_v1_adapter"] == "pi_private_lifecycle"
    # The Pi lifecycle spawns leaves through a fixed-width pool, so its claim
    # ceiling is a batch size rather than a process count. Codex still fans out
    # over everything it claims and keeps the conservative ceiling.
    assert pi["max_source_coordinator_leaves"] == 32
    source = (PLUGIN / "pi/extensions/index.ts").read_text(encoding="utf-8")
    assert "COC_PI_SOURCE_COMPONENT_PROBE" not in source
    assert "COC_PI_AGENT_DEPTH" not in source
    assert "COC_PI_ROLE" not in source




def test_pi_opening_source_review_transport_lifecycle():
    result = _node(
        ROOT / "tests/pi/opening-source-review-transport-smoke.mjs",
        str(ROOT),
    )
    assert result == {
        "ok": True,
        "checks": {
            "pre_character_background_trigger": True,
            "post_character_wait_without_duplicate": True,
            "private_task_not_model_visible": True,
            "exact_next_generation_same_scenario_only": True,
            "valid_failed_receipt_is_terminal": True,
            "duplicate_suppressed": True,
            "restart_reconciled_without_duplicate_launch": True,
            "outer_failures_remain_retryable": True,
            "producer_death_emits_terminal_audit_and_evidence": True,
            "timeout_and_abort_remain_retryable": True,
            "exact_hidden_facts_card": True,
            "misaligned_state_still_delivers_reviewed_adopt_card": True,
            "misaligned_state_keeps_real_failure_class": True,
            "no_raw_source_leakage": True,
        },
    }


def _locator_termination_task(tmp_path: Path, workspace: Path, *, tag: str) -> dict:
    return {
        "schema_version": 1,
        "contract_id": "coc.pi-source-scope-locator-task.v1",
        "adapter_mode": "pi_external_pdf_skill_lifecycle",
        "model_policy": "pinned_xai_grok_4_5_thinking_low",
        "max_selected_pages": 3,
        "workspace_root": str(workspace),
        "asset_root_id": f"adapter-{tag}",
        "job_id": f"job-adapter-{tag}",
        "kind": "location",
        "target_id": "archive",
        "target_label": "Archive",
        "source_bundle_path": str(
            workspace / ".tmp" / "coc-source-scope" / "camp" / "job" / "staging"
        ),
        "cached_pdf_indices": [],
        "source": {
            "path": str(tmp_path / "module.pdf"),
            "source_id": f"pdf:adapter-{tag}",
            "title": f"Adapter {tag}",
            "file_sha256": "a" * 64,
        },
    }


def test_pdf_skill_adapter_reaps_term_resistant_pi_process_group(
    tmp_path: Path,
):
    """Leader may exit on TERM while a grandchild ignores TERM and holds pipes.

    Host SIGTERM must make the adapter exit non-zero and the grandchild PID
    must disappear — killpg is unconditional on the saved PGID, not gated on
    leader.poll().
    """
    started = tmp_path / "pi-started"
    child_pid_path = tmp_path / "child-pid"
    survivor = tmp_path / "descendant-survived"
    pipe_hold = tmp_path / "pipe-hold"
    fake_pi = tmp_path / "fake-pi"
    # Grandchild ignores TERM, keeps a pipe open (survives leader exit), and
    # would write survivor if not SIGKILL'd with the process group.
    child_code = (
        "import os,signal,time,pathlib;"
        "signal.signal(signal.SIGTERM,signal.SIG_IGN);"
        f"pathlib.Path({str(child_pid_path)!r}).write_text(str(os.getpid()));"
        f"hold=open({str(pipe_hold)!r},'w');"
        "time.sleep(1.2);"
        f"pathlib.Path({str(survivor)!r}).write_text('survived')"
    )
    fake_pi.write_text(
        f"""#!{os.fspath(Path(os.sys.executable).resolve())}
import os
import signal
import subprocess
import sys
import time
from pathlib import Path
if sys.argv[1:] == ["--version"]:
    raise SystemExit(0)
# Leader cooperates with TERM (exits) so cleanup cannot rely on leader.poll().
signal.signal(signal.SIGTERM, signal.SIG_DFL)
subprocess.Popen([sys.executable, "-c", {child_code!r}])
Path({str(started)!r}).write_text(str(os.getpid()))
time.sleep(10)
""",
        encoding="utf-8",
    )
    fake_pi.chmod(0o755)
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    task = _locator_termination_task(tmp_path, workspace, tag="termination")
    env = {
        **os.environ,
        "COC_PI_COMMAND": str(fake_pi),
    }
    # Locator must take the legacy Pi path; a leaked host inspector command
    # would block before fake Pi starts and hide the process-group contract.
    env.pop("COC_PI_PDF_INSPECTOR_COMMAND", None)
    # This test owns only process-tree termination. The fake Pi never reads
    # the adapter's required external-skill path, so keep the fixture hermetic.
    pdf_skill = tmp_path / "pdf-skill" / "SKILL.md"
    pdf_skill.parent.mkdir()
    pdf_skill.write_text("# process-tree fixture\n", encoding="utf-8")
    env["COC_PI_PDF_SKILL"] = str(pdf_skill)
    adapter = PLUGIN / "pi/bin/coc-pdf-skill-adapter.py"
    process = subprocess.Popen(
        [os.sys.executable, str(adapter), "--run"],
        cwd=ROOT,
        env=env,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        start_new_session=True,
    )
    assert process.stdin is not None
    process.stdin.write(json.dumps(task))
    process.stdin.close()
    deadline = time.monotonic() + 3
    while not started.is_file() and time.monotonic() < deadline:
        time.sleep(0.02)
    assert started.is_file()
    # Grandchild starts after fake Pi marks ready; wait until its PID is
    # published so the reap assertion observes a real descendant.
    deadline = time.monotonic() + 3
    while not child_pid_path.is_file() and time.monotonic() < deadline:
        time.sleep(0.02)
    assert child_pid_path.is_file()
    child_pid = int(child_pid_path.read_text(encoding="utf-8"))
    process.send_signal(signal.SIGTERM)
    assert process.wait(timeout=5) != 0
    # First prove the process group is reaped, then pass the grandchild's
    # 1.2s write deadline: absence of the survivor file is not a timing-only
    # false positive.
    deadline = time.monotonic() + 1.0
    while time.monotonic() < deadline:
        try:
            os.kill(child_pid, 0)
        except ProcessLookupError:
            break
        time.sleep(0.02)
    with pytest.raises(ProcessLookupError):
        os.kill(child_pid, 0)
    time.sleep(1.3)
    assert not survivor.exists()


def test_pdf_skill_adapter_sigterm_reaps_hanging_pdf_inspector(
    tmp_path: Path,
):
    """SIGTERM during the optional router must exit and reap the session."""
    hang = tmp_path / "hanging-inspector"
    hang_pid_path = tmp_path / "hang-pid"
    hang.write_text(
        f"""#!{os.fspath(Path(os.sys.executable).resolve())}
import os, signal, time
from pathlib import Path
signal.signal(signal.SIGTERM, signal.SIG_IGN)
Path({str(hang_pid_path)!r}).write_text(str(os.getpid()))
time.sleep(30)
""",
        encoding="utf-8",
    )
    hang.chmod(0o755)
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    task = _locator_termination_task(tmp_path, workspace, tag="router-term")
    # Pi must not be required once the hanging router is running; still provide
    # a dummy so any accidental fallback cannot block on a missing binary.
    fake_pi = tmp_path / "fake-pi"
    fake_pi.write_text(
        f"""#!{os.fspath(Path(os.sys.executable).resolve())}
import sys
if sys.argv[1:] == ["--version"]:
    raise SystemExit(0)
raise SystemExit("pi should not run while inspector hangs")
""",
        encoding="utf-8",
    )
    fake_pi.chmod(0o755)
    pdf_skill = tmp_path / "pdf-skill" / "SKILL.md"
    pdf_skill.parent.mkdir()
    pdf_skill.write_text("# router-term fixture\n", encoding="utf-8")
    env = {
        **os.environ,
        "COC_PI_COMMAND": str(fake_pi),
        "COC_PI_PDF_SKILL": str(pdf_skill),
        "COC_PI_PDF_INSPECTOR_COMMAND": str(hang),
    }
    adapter = PLUGIN / "pi/bin/coc-pdf-skill-adapter.py"
    process = subprocess.Popen(
        [os.sys.executable, str(adapter), "--run"],
        cwd=ROOT,
        env=env,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        start_new_session=True,
    )
    assert process.stdin is not None
    process.stdin.write(json.dumps(task))
    process.stdin.close()
    deadline = time.monotonic() + 3
    while not hang_pid_path.is_file() and time.monotonic() < deadline:
        time.sleep(0.02)
    assert hang_pid_path.is_file()
    hang_pid = int(hang_pid_path.read_text(encoding="utf-8"))
    process.send_signal(signal.SIGTERM)
    assert process.wait(timeout=5) != 0
    deadline = time.monotonic() + 1.0
    while time.monotonic() < deadline:
        try:
            os.kill(hang_pid, 0)
        except ProcessLookupError:
            break
        time.sleep(0.02)
    with pytest.raises(ProcessLookupError):
        os.kill(hang_pid, 0)


def test_pdf_skill_adapter_leader_exit_reaps_pipe_holding_descendants(
    tmp_path: Path,
):
    """Leader exits while grandchild ignores TERM and holds inherited pipes.

    selectors+waitid must observe leader exit without waiting on pipe EOF first,
    killpg the saved PGID while the zombie still owns it, and reap the
    TERM-immune grandchild. This is normal completion, not a supervise timeout.
    """
    adapter = _load_pdf_adapter("coc_pdf_adapter_pipe_hold_orphan_test")
    child_pid_path = tmp_path / "pipe-hold-child-pid"
    survivor = tmp_path / "pipe-hold-survivor"
    child_code = (
        "import os,signal,time,pathlib;"
        "signal.signal(signal.SIGTERM,signal.SIG_IGN);"
        f"pathlib.Path({str(child_pid_path)!r}).write_text(str(os.getpid()));"
        # Keep inherited stdout open after leader exit.
        "time.sleep(5);"
        f"pathlib.Path({str(survivor)!r}).write_text('survived')"
    )
    script = tmp_path / "pipe-hold-leader.py"
    script.write_text(
        "import signal, subprocess, sys, time\n"
        "from pathlib import Path\n"
        "signal.signal(signal.SIGTERM, signal.SIG_DFL)\n"
        f"subprocess.Popen([sys.executable, '-c', {child_code!r}])\n"
        f"target = Path({str(child_pid_path)!r})\n"
        "deadline = time.time() + 2\n"
        "while not target.is_file() and time.time() < deadline:\n"
        "    time.sleep(0.01)\n"
        "raise SystemExit(0)\n",
        encoding="utf-8",
    )
    completed = adapter._run_session_command(
        [os.sys.executable, str(script)],
        timeout=3,
    )
    assert completed.returncode == 0
    assert child_pid_path.is_file()
    child_pid = int(child_pid_path.read_text(encoding="utf-8"))
    deadline = time.monotonic() + 1.0
    while time.monotonic() < deadline:
        try:
            os.kill(child_pid, 0)
        except ProcessLookupError:
            break
        time.sleep(0.02)
    with pytest.raises(ProcessLookupError):
        os.kill(child_pid, 0)
    assert not survivor.exists()


def test_pdf_skill_adapter_normal_completion_reaps_leftover_descendants(
    tmp_path: Path,
):
    """Successful producer must not leave session grandchildren behind."""
    adapter = _load_pdf_adapter("coc_pdf_adapter_normal_orphan_test")
    child_pid_path = tmp_path / "normal-child-pid"
    survivor = tmp_path / "normal-survivor"
    child_code = (
        "import os,signal,time,pathlib;"
        "signal.signal(signal.SIGTERM,signal.SIG_IGN);"
        f"pathlib.Path({str(child_pid_path)!r}).write_text(str(os.getpid()));"
        "time.sleep(5);"
        f"pathlib.Path({str(survivor)!r}).write_text('survived')"
    )
    script = tmp_path / "normal-leader.py"
    script.write_text(
        "import subprocess, sys, time\n"
        "from pathlib import Path\n"
        # Detach stdio so leader exit is independent of grandchild pipe holds.
        f"subprocess.Popen([sys.executable, '-c', {child_code!r}],"
        " stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,"
        " stderr=subprocess.DEVNULL)\n"
        f"target = Path({str(child_pid_path)!r})\n"
        "deadline = time.time() + 2\n"
        "while not target.is_file() and time.time() < deadline:\n"
        "    time.sleep(0.01)\n"
        "raise SystemExit(0)\n",
        encoding="utf-8",
    )
    completed = adapter._run_session_command(
        [os.sys.executable, str(script)],
        timeout=3,
    )
    assert completed.returncode == 0
    deadline = time.monotonic() + 1.0
    while not child_pid_path.is_file() and time.monotonic() < deadline:
        time.sleep(0.02)
    assert child_pid_path.is_file()
    child_pid = int(child_pid_path.read_text(encoding="utf-8"))
    deadline = time.monotonic() + 1.0
    while time.monotonic() < deadline:
        try:
            os.kill(child_pid, 0)
        except ProcessLookupError:
            break
        time.sleep(0.02)
    with pytest.raises(ProcessLookupError):
        os.kill(child_pid, 0)
    assert not survivor.exists()


def test_pdf_skill_adapter_timeout_kills_hanging_leader_and_grandchild(
    tmp_path: Path,
):
    """Hard timeout while leader still hangs must killpg and reap grandchild."""
    adapter = _load_pdf_adapter("coc_pdf_adapter_timeout_hang_test")
    child_pid_path = tmp_path / "hang-child-pid"
    survivor = tmp_path / "hang-survivor"
    child_code = (
        "import os,signal,time,pathlib;"
        "signal.signal(signal.SIGTERM,signal.SIG_IGN);"
        f"pathlib.Path({str(child_pid_path)!r}).write_text(str(os.getpid()));"
        "time.sleep(5);"
        f"pathlib.Path({str(survivor)!r}).write_text('survived')"
    )
    script = tmp_path / "hang-leader.py"
    script.write_text(
        "import signal, subprocess, sys, time\n"
        "from pathlib import Path\n"
        "signal.signal(signal.SIGTERM, signal.SIG_IGN)\n"
        f"subprocess.Popen([sys.executable, '-c', {child_code!r}])\n"
        f"target = Path({str(child_pid_path)!r})\n"
        "deadline = time.time() + 2\n"
        "while not target.is_file() and time.time() < deadline:\n"
        "    time.sleep(0.01)\n"
        "time.sleep(5)\n",
        encoding="utf-8",
    )
    with pytest.raises(subprocess.TimeoutExpired):
        adapter._run_session_command(
            [os.sys.executable, str(script)],
            timeout=1,
        )
    deadline = time.monotonic() + 1.0
    while not child_pid_path.is_file() and time.monotonic() < deadline:
        time.sleep(0.02)
    # Child PID file may be missing if killed before write; if present, gone.
    if child_pid_path.is_file():
        child_pid = int(child_pid_path.read_text(encoding="utf-8"))
        deadline = time.monotonic() + 1.0
        while time.monotonic() < deadline:
            try:
                os.kill(child_pid, 0)
            except ProcessLookupError:
                break
            time.sleep(0.02)
        with pytest.raises(ProcessLookupError):
            os.kill(child_pid, 0)
    assert not survivor.exists()


def test_pdf_skill_adapter_signal_after_producer_fail_closed_before_receipt(
    tmp_path: Path, monkeypatch,
):
    """Signal after producer reaps, before receipt, must fail closed (no OK)."""
    adapter = _load_pdf_adapter("coc_pdf_adapter_post_producer_signal_test")
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    bundle_dir = (
        workspace / ".tmp" / "coc-source-scope" / "camp" / "job" / "staging"
    )
    bundle_dir.mkdir(parents=True)
    pdf = tmp_path / "module.pdf"
    pdf.write_bytes(b"%PDF fixture")
    task = _locator_task(workspace, bundle_dir, pdf)
    receipt_calls: list[str] = []

    def fake_run_pi(
        prompt, cwd, *, timeout, allow_non_json_receipt=False, shutdown=None,
    ):
        return {
            "schema_version": 1,
            "contract_id": "coc.pi-source-scope-locator-producer-result.v1",
            "job_id": task["job_id"],
            "status": "not_located",
            "kind": task["kind"],
            "target_id": task["target_id"],
            "pdf_indices": [],
            "source_bundle_path": None,
            "failure_class": None,
        }

    def fake_receipt(task_arg, producer_result):
        receipt_calls.append("receipt")
        return {"receipt": "should-not-return"}

    def fire_host_abort():
        # Deterministic: flip the lane flag the real handler would set.
        # Locate the live flag via a side channel installed below.
        fire_host_abort.flag.requested = True  # type: ignore[attr-defined]

    monkeypatch.setattr(adapter, "_run_pi", fake_run_pi)
    monkeypatch.setattr(adapter, "_locator_receipt", fake_receipt)
    monkeypatch.setattr(adapter, "_try_external_pdf_router", lambda *a, **k: None)
    monkeypatch.setattr(adapter, "_post_child_hook", fire_host_abort)

    real_install = adapter._install_interrupt_handlers

    def tracking_install(flag):
        fire_host_abort.flag = flag  # type: ignore[attr-defined]
        return real_install(flag)

    monkeypatch.setattr(adapter, "_install_interrupt_handlers", tracking_install)

    class _Stdin:
        buffer = io.BytesIO(json.dumps(task, ensure_ascii=False).encode())

    monkeypatch.setattr(sys, "stdin", _Stdin())
    with pytest.raises(RuntimeError, match="interrupted by signal"):
        adapter._run()
    assert receipt_calls == []


def test_pdf_skill_adapter_handler_does_not_touch_popen(
    tmp_path: Path, monkeypatch,
):
    """Signal handler must only set the flag — no wait/poll/kill/raise."""
    adapter = _load_pdf_adapter("coc_pdf_adapter_handler_flag_only_test")
    flag = adapter._ShutdownFlag()
    handlers = adapter._install_interrupt_handlers(flag)
    try:
        handler = signal.getsignal(signal.SIGTERM)
        assert flag.requested is False
        handler(signal.SIGTERM, None)
        assert flag.requested is True
        # Second delivery stays flag-only and must not raise.
        handler(signal.SIGTERM, None)
        assert flag.requested is True
    finally:
        adapter._restore_interrupt_handlers(handlers)


def test_pdf_skill_adapter_unblocks_inherited_blocked_term_int(
    tmp_path: Path,
):
    """Parent may inherit blocked TERM/INT; producer lane must still abort."""
    started = tmp_path / "blocked-started"
    child_pid_path = tmp_path / "blocked-child-pid"
    fake_pi = tmp_path / "fake-pi-blocked"
    child_code = (
        "import os,signal,time,pathlib;"
        "signal.signal(signal.SIGTERM,signal.SIG_IGN);"
        f"pathlib.Path({str(child_pid_path)!r}).write_text(str(os.getpid()));"
        "time.sleep(8)"
    )
    fake_pi.write_text(
        f"""#!{os.fspath(Path(os.sys.executable).resolve())}
import os
import signal
import subprocess
import sys
import time
from pathlib import Path
if sys.argv[1:] == ["--version"]:
    raise SystemExit(0)
signal.signal(signal.SIGTERM, signal.SIG_DFL)
subprocess.Popen([sys.executable, "-c", {child_code!r}])
Path({str(started)!r}).write_text(str(os.getpid()))
time.sleep(20)
""",
        encoding="utf-8",
    )
    fake_pi.chmod(0o755)
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    task = _locator_termination_task(tmp_path, workspace, tag="blocked-mask")
    pdf_skill = tmp_path / "pdf-skill" / "SKILL.md"
    pdf_skill.parent.mkdir()
    pdf_skill.write_text("# blocked-mask fixture\n", encoding="utf-8")
    env = {
        **os.environ,
        "COC_PI_COMMAND": str(fake_pi),
        "COC_PI_PDF_SKILL": str(pdf_skill),
    }
    env.pop("COC_PI_PDF_INSPECTOR_COMMAND", None)
    adapter = PLUGIN / "pi/bin/coc-pdf-skill-adapter.py"
    # Child inherits this blocked mask; lane entry must unblock TERM/INT.
    old_mask = signal.pthread_sigmask(
        signal.SIG_BLOCK, {signal.SIGTERM, signal.SIGINT},
    )
    try:
        process = subprocess.Popen(
            [os.sys.executable, str(adapter), "--run"],
            cwd=ROOT,
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
    finally:
        signal.pthread_sigmask(signal.SIG_SETMASK, old_mask)
    assert process.stdin is not None
    process.stdin.write(json.dumps(task))
    process.stdin.close()
    deadline = time.monotonic() + 3
    while not started.is_file() and time.monotonic() < deadline:
        time.sleep(0.02)
    assert started.is_file()
    deadline = time.monotonic() + 3
    while not child_pid_path.is_file() and time.monotonic() < deadline:
        time.sleep(0.02)
    assert child_pid_path.is_file()
    child_pid = int(child_pid_path.read_text(encoding="utf-8"))
    process.send_signal(signal.SIGTERM)
    assert process.wait(timeout=5) != 0
    deadline = time.monotonic() + 1.0
    while time.monotonic() < deadline:
        try:
            os.kill(child_pid, 0)
        except ProcessLookupError:
            break
        time.sleep(0.02)
    with pytest.raises(ProcessLookupError):
        os.kill(child_pid, 0)


def test_pdf_skill_adapter_router_host_abort_never_falls_back_to_pi(
    tmp_path: Path,
):
    """Host abort during router must exit non-zero without invoking Pi."""
    hang = tmp_path / "hanging-inspector"
    hang_pid_path = tmp_path / "hang-pid"
    pi_marker = tmp_path / "pi-fallback-ran"
    hang.write_text(
        f"""#!{os.fspath(Path(os.sys.executable).resolve())}
import os, signal, time
from pathlib import Path
signal.signal(signal.SIGTERM, signal.SIG_IGN)
Path({str(hang_pid_path)!r}).write_text(str(os.getpid()))
time.sleep(30)
""",
        encoding="utf-8",
    )
    hang.chmod(0o755)
    fake_pi = tmp_path / "fake-pi"
    fake_pi.write_text(
        f"""#!{os.fspath(Path(os.sys.executable).resolve())}
import sys
from pathlib import Path
if sys.argv[1:] == ["--version"]:
    raise SystemExit(0)
Path({str(pi_marker)!r}).write_text("pi-ran")
raise SystemExit("pi must not run after router host abort")
""",
        encoding="utf-8",
    )
    fake_pi.chmod(0o755)
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    task = _locator_termination_task(tmp_path, workspace, tag="router-no-fb")
    pdf_skill = tmp_path / "pdf-skill" / "SKILL.md"
    pdf_skill.parent.mkdir()
    pdf_skill.write_text("# router-no-fallback fixture\n", encoding="utf-8")
    env = {
        **os.environ,
        "COC_PI_COMMAND": str(fake_pi),
        "COC_PI_PDF_SKILL": str(pdf_skill),
        "COC_PI_PDF_INSPECTOR_COMMAND": str(hang),
    }
    adapter = PLUGIN / "pi/bin/coc-pdf-skill-adapter.py"
    process = subprocess.Popen(
        [os.sys.executable, str(adapter), "--run"],
        cwd=ROOT,
        env=env,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        start_new_session=True,
    )
    assert process.stdin is not None
    process.stdin.write(json.dumps(task))
    process.stdin.close()
    deadline = time.monotonic() + 3
    while not hang_pid_path.is_file() and time.monotonic() < deadline:
        time.sleep(0.02)
    assert hang_pid_path.is_file()
    hang_pid = int(hang_pid_path.read_text(encoding="utf-8"))
    process.send_signal(signal.SIGTERM)
    assert process.wait(timeout=5) != 0
    assert not pi_marker.exists()
    deadline = time.monotonic() + 1.0
    while time.monotonic() < deadline:
        try:
            os.kill(hang_pid, 0)
        except ProcessLookupError:
            break
        time.sleep(0.02)
    with pytest.raises(ProcessLookupError):
        os.kill(hang_pid, 0)


def test_pdf_skill_adapter_selector_io_is_exact_and_stdin_once(
    tmp_path: Path,
):
    """stdout/stderr across selector slices must be exact; stdin sent once."""
    adapter = _load_pdf_adapter("coc_pdf_adapter_selector_io_test")
    # Force many selector read slices without relying on sleep races.
    adapter._IO_CHUNK_BYTES = 64
    payload = ("alpha-" * 200) + "end"
    stdout_body = ("OUT" * 400) + "OUT_END"
    stderr_body = ("ERR" * 300) + "ERR_END"
    out_path = tmp_path / "stdout_body.bin"
    err_path = tmp_path / "stderr_body.bin"
    out_path.write_bytes(stdout_body.encode())
    err_path.write_bytes(stderr_body.encode())
    script = tmp_path / "io-child.py"
    script.write_text(
        "import hashlib, pathlib, sys\n"
        f"stdout_body = pathlib.Path({str(out_path)!r}).read_bytes()\n"
        f"stderr_body = pathlib.Path({str(err_path)!r}).read_bytes()\n"
        "data = sys.stdin.buffer.read()\n"
        "sys.stdout.buffer.write(stdout_body)\n"
        "sys.stdout.buffer.flush()\n"
        "sys.stderr.buffer.write(stderr_body)\n"
        "sys.stderr.buffer.flush()\n"
        "sys.stdout.buffer.write(hashlib.sha256(data).hexdigest().encode())\n"
        "sys.stdout.buffer.write(b'\\n')\n"
        "sys.stdout.buffer.write(str(len(data)).encode())\n"
        "sys.stdout.buffer.write(b'\\n')\n",
        encoding="utf-8",
    )
    completed = adapter._run_session_command(
        [os.sys.executable, str(script)],
        timeout=5,
        input_text=payload,
    )
    assert completed.returncode == 0
    digest = hashlib.sha256(payload.encode()).hexdigest()
    expected_stdout = (
        stdout_body + digest + "\n" + str(len(payload.encode())) + "\n"
    )
    assert completed.stdout == expected_stdout
    assert completed.stderr == stderr_body


def test_pdf_skill_adapter_killpg_permission_error_fail_closed(
    monkeypatch,
):
    """killpg EPERM is always fail-closed — no platform success special case."""
    adapter = _load_pdf_adapter("coc_pdf_adapter_killpg_eperm_test")
    # Force the live-member gate open so killpg is actually attempted.
    monkeypatch.setattr(adapter, "_live_process_group_pids", lambda pgid: [pgid])

    def boom_killpg(pgid, sig):
        raise PermissionError(errno.EPERM, "Operation not permitted")

    monkeypatch.setattr(os, "killpg", boom_killpg)
    with pytest.raises(adapter._SupervisorInvariantError, match="SIGKILL failed"):
        adapter._kill_process_group(12345)
    # Leader-exited branch uses the same helper — EPERM still fail-closed.
    with pytest.raises(adapter._SupervisorInvariantError, match="SIGKILL failed"):
        adapter._kill_process_group(99901)


def test_pdf_skill_adapter_waitid_error_fail_closed(monkeypatch):
    adapter = _load_pdf_adapter("coc_pdf_adapter_waitid_fail_test")

    def boom_waitid(*_a, **_k):
        raise OSError(errno.EINVAL, "invalid waitid")

    monkeypatch.setattr(os, "waitid", boom_waitid)
    with pytest.raises(adapter._SupervisorInvariantError, match="waitid failed"):
        adapter._leader_exited_nowait(1)


def test_pdf_skill_adapter_mask_and_reap_errors_fail_closed(
    tmp_path: Path, monkeypatch,
):
    adapter = _load_pdf_adapter("coc_pdf_adapter_mask_reap_fail_test")

    def boom_mask(*_a, **_k):
        raise OSError(errno.EINVAL, "bad mask")

    monkeypatch.setattr(signal, "pthread_sigmask", boom_mask)
    flag = adapter._ShutdownFlag()
    with pytest.raises(adapter._SupervisorInvariantError, match="signal mask"):
        adapter._enter_producer_lane(flag)

    # Reap failure: wait never settles returncode.
    class _FakeProc:
        returncode = None

        def wait(self, timeout=None):
            raise subprocess.TimeoutExpired(cmd="x", timeout=timeout)

    with pytest.raises(adapter._SupervisorInvariantError, match="reap timed out"):
        adapter._reap_direct_child(_FakeProc())


def test_pdf_skill_adapter_spawn_mask_restore_failure_clears_child(
    tmp_path: Path, monkeypatch,
):
    """Post-Popen mask restore failure must kill/reap the child, never return it."""
    adapter = _load_pdf_adapter("coc_pdf_adapter_spawn_mask_restore_test")
    child_pid_path = tmp_path / "spawn-child-pid"
    script = tmp_path / "spawn-child.py"
    script.write_text(
        "import os, time\n"
        f"open({str(child_pid_path)!r},'w').write(str(os.getpid()))\n"
        "time.sleep(30)\n",
        encoding="utf-8",
    )
    real_mask = signal.pthread_sigmask
    state = {"block_done": False, "restore_calls": 0}

    def flaky_mask(how, mask):
        # After the spawn BLOCK, the next SETMASK (restore) fails once the
        # child exists. Earlier calls (capability/block) succeed.
        if how == signal.SIG_BLOCK and signal.SIGTERM in set(mask):
            state["block_done"] = True
            return real_mask(how, mask)
        if (
            state["block_done"]
            and how == signal.SIG_SETMASK
            and state["restore_calls"] == 0
        ):
            state["restore_calls"] += 1
            raise OSError(errno.EINVAL, "injected mask restore failure")
        return real_mask(how, mask)

    monkeypatch.setattr(signal, "pthread_sigmask", flaky_mask)
    with pytest.raises(adapter._SupervisorInvariantError, match="mask restore"):
        adapter._spawn_session_process(
            [os.sys.executable, str(script)],
            cwd=None,
            env=None,
            input_text=None,
        )
    deadline = time.monotonic() + 2.0
    while not child_pid_path.is_file() and time.monotonic() < deadline:
        time.sleep(0.02)
    # Child may die before writing pid; if it wrote, it must be gone.
    if child_pid_path.is_file():
        child_pid = int(child_pid_path.read_text(encoding="utf-8"))
        deadline = time.monotonic() + 1.0
        while time.monotonic() < deadline:
            try:
                os.kill(child_pid, 0)
            except ProcessLookupError:
                break
            time.sleep(0.02)
        with pytest.raises(ProcessLookupError):
            os.kill(child_pid, 0)


def test_pdf_skill_adapter_handler_install_partial_failure_rollbacks(
    monkeypatch,
):
    """Second handler install failure rolls back the first; caller untouched."""
    adapter = _load_pdf_adapter("coc_pdf_adapter_handler_install_rollback_test")
    flag = adapter._ShutdownFlag()
    prior_term = signal.getsignal(signal.SIGTERM)
    prior_int = signal.getsignal(signal.SIGINT)
    real_signal = signal.signal
    calls = {"n": 0}

    def flaky_signal(signum, handler):
        if handler is not prior_term and handler is not prior_int:
            # Installing new lane handlers.
            calls["n"] += 1
            if calls["n"] == 2:
                raise OSError(errno.EINVAL, "injected second handler failure")
        return real_signal(signum, handler)

    monkeypatch.setattr(signal, "signal", flaky_signal)
    with pytest.raises(
        adapter._SupervisorInvariantError, match="handler install",
    ):
        adapter._enter_producer_lane(flag)
    assert signal.getsignal(signal.SIGTERM) is prior_term
    assert signal.getsignal(signal.SIGINT) is prior_int


def test_pdf_skill_adapter_handler_restore_partial_failure_rollbacks(
    monkeypatch,
):
    """Second handler restore failure rolls back the first restore attempt."""
    adapter = _load_pdf_adapter("coc_pdf_adapter_handler_restore_rollback_test")
    flag = adapter._ShutdownFlag()
    handlers, caller_mask = adapter._enter_producer_lane(flag)
    lane_term = signal.getsignal(signal.SIGTERM)
    lane_int = signal.getsignal(signal.SIGINT)
    real_signal = signal.signal
    restore_new = {"n": 0}

    def flaky_signal(signum, handler):
        # Count restores away from the live lane handlers.
        if handler is not lane_term and handler is not lane_int:
            if signum in (signal.SIGTERM, signal.SIGINT):
                restore_new["n"] += 1
                if restore_new["n"] == 2:
                    raise OSError(errno.EINVAL, "injected second restore failure")
        return real_signal(signum, handler)

    monkeypatch.setattr(signal, "signal", flaky_signal)
    with pytest.raises(
        adapter._SupervisorInvariantError, match="signal restore",
    ):
        adapter._leave_producer_lane(handlers, caller_mask, flag)
    # Transactional restore rolls back the partial first restore so both
    # signals still carry the lane handlers (consistent pair), not a mix.
    assert signal.getsignal(signal.SIGTERM) is lane_term
    assert signal.getsignal(signal.SIGINT) is lane_int
    # Best-effort: put caller handlers/mask back for the rest of the suite.
    monkeypatch.setattr(signal, "signal", real_signal)
    signal.signal(signal.SIGTERM, handlers[signal.SIGTERM])
    signal.signal(signal.SIGINT, handlers[signal.SIGINT])
    signal.pthread_sigmask(signal.SIG_SETMASK, caller_mask)


def test_pdf_skill_adapter_handler_install_rollback_self_failure_chains(
    monkeypatch,
):
    """Install primary failure + rollback self-failure chains; no fake restore."""
    adapter = _load_pdf_adapter("coc_pdf_adapter_handler_install_rb_fail_test")
    flag = adapter._ShutdownFlag()
    prior_term = signal.getsignal(signal.SIGTERM)
    prior_int = signal.getsignal(signal.SIGINT)
    real_signal = signal.signal
    phase = {"install": 0, "rollback": 0}

    def flaky_signal(signum, handler):
        # First pass installs lane handlers; second install blows up; rollback
        # of the first install also blows up.
        if handler is not prior_term and handler is not prior_int:
            phase["install"] += 1
            if phase["install"] == 2:
                raise OSError(errno.EINVAL, "injected install failure")
            return real_signal(signum, handler)
        # Rolling back toward caller handlers.
        phase["rollback"] += 1
        if phase["rollback"] == 1:
            raise OSError(errno.EPERM, "injected rollback failure")
        return real_signal(signum, handler)

    monkeypatch.setattr(signal, "signal", flaky_signal)
    with pytest.raises(
        adapter._SupervisorInvariantError,
        match="handler install failed.*rollback failed",
    ):
        adapter._enter_producer_lane(flag)
    # Must not claim caller was cleanly restored when rollback failed.
    # TERM may still hold the partially installed lane handler.
    assert signal.getsignal(signal.SIGTERM) is not prior_term or phase["rollback"] >= 1
    # Suite hygiene under real signal().
    monkeypatch.setattr(signal, "signal", real_signal)
    signal.signal(signal.SIGTERM, prior_term)
    signal.signal(signal.SIGINT, prior_int)


def test_pdf_skill_adapter_handler_restore_rollback_self_failure_chains(
    monkeypatch,
):
    """Restore primary failure + rollback self-failure chains invariant error."""
    adapter = _load_pdf_adapter("coc_pdf_adapter_handler_restore_rb_fail_test")
    flag = adapter._ShutdownFlag()
    handlers, caller_mask = adapter._enter_producer_lane(flag)
    lane_term = signal.getsignal(signal.SIGTERM)
    lane_int = signal.getsignal(signal.SIGINT)
    real_signal = signal.signal
    counts = {"toward_caller": 0, "rollback_lane": 0}

    def flaky_signal(signum, handler):
        if handler is lane_term or handler is lane_int:
            counts["rollback_lane"] += 1
            if counts["rollback_lane"] == 1:
                raise OSError(errno.EPERM, "injected restore-rollback failure")
            return real_signal(signum, handler)
        counts["toward_caller"] += 1
        if counts["toward_caller"] == 2:
            raise OSError(errno.EINVAL, "injected restore failure")
        return real_signal(signum, handler)

    monkeypatch.setattr(signal, "signal", flaky_signal)
    with pytest.raises(
        adapter._SupervisorInvariantError,
        match="handler restore failed.*rollback failed|signal restore failed",
    ):
        adapter._leave_producer_lane(handlers, caller_mask, flag)
    # Not a clean caller restore pretence after chained failure.
    monkeypatch.setattr(signal, "signal", real_signal)
    signal.signal(signal.SIGTERM, handlers[signal.SIGTERM])
    signal.signal(signal.SIGINT, handlers[signal.SIGINT])
    signal.pthread_sigmask(signal.SIG_SETMASK, caller_mask)


def test_pdf_skill_adapter_stdio_close_wait_mask_failures_compose(
    tmp_path: Path, monkeypatch,
):
    """close/wait/mask cleanup failures compose fail-closed and still attempt all."""
    adapter = _load_pdf_adapter("coc_pdf_adapter_cleanup_compose_test")
    caller_mask = signal.pthread_sigmask(signal.SIG_BLOCK, set())
    steps: list[str] = []

    class _BoomStream:
        closed = False

        def close(self):
            steps.append("close")
            raise OSError(errno.EIO, "injected stdio close failure")

    class _FakeProc:
        pid = 424242
        returncode = None
        stdin = _BoomStream()
        stdout = _BoomStream()
        stderr = None

        def wait(self, timeout=None):
            steps.append("wait")
            raise OSError(errno.ECHILD, "injected wait failure")

    real_mask = signal.pthread_sigmask

    def flaky_mask(how, mask):
        if how == signal.SIG_SETMASK:
            steps.append("mask")
            raise OSError(errno.EINVAL, "injected mask rollback failure")
        return real_mask(how, mask)

    monkeypatch.setattr(signal, "pthread_sigmask", flaky_mask)
    monkeypatch.setattr(adapter, "_kill_process_group", lambda pgid: None)
    with pytest.raises(
        adapter._SupervisorInvariantError,
        match="spawn cleanup failed",
    ):
        adapter._cleanup_spawned_session(
            _FakeProc(),
            pgid=424242,
            restore_mask=caller_mask,
        )
    # Every cleanup step still ran despite earlier failures.
    assert steps.count("close") >= 1
    assert "wait" in steps
    assert "mask" in steps
    # Caller mask helper was not successfully applied; live mask unchanged
    # by the failed SETMASK (pthread_sigmask raises before applying).
    monkeypatch.setattr(signal, "pthread_sigmask", real_mask)
    assert signal.pthread_sigmask(signal.SIG_BLOCK, set()) == caller_mask


def test_pdf_skill_adapter_router_invariant_never_falls_back_to_pi(
    tmp_path: Path, monkeypatch,
):
    """SupervisorInvariantError on router path must not invoke Pi fallback."""
    adapter = _load_pdf_adapter("coc_pdf_adapter_router_invariant_nofallback_test")
    router = tmp_path / "router-bin"
    router.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    router.chmod(0o755)
    monkeypatch.setenv("COC_PI_PDF_INSPECTOR_COMMAND", str(router))

    def boom_session(*_a, **_k):
        raise adapter._SupervisorInvariantError("injected router invariant")

    monkeypatch.setattr(adapter, "_run_session_command", boom_session)
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    pdf = tmp_path / "module.pdf"
    pdf.write_bytes(b"%PDF fixture")
    bundle_dir = workspace / ".tmp" / "coc-source-scope" / "camp" / "job" / "staging"
    bundle_dir.mkdir(parents=True)
    task = _locator_task(workspace, bundle_dir, pdf)
    pi_calls: list[str] = []

    def fake_run_pi(*_a, **_k):
        pi_calls.append("pi")
        raise AssertionError("Pi must not run after router invariant failure")

    monkeypatch.setattr(adapter, "_run_pi", fake_run_pi)

    class _Stdin:
        buffer = io.BytesIO(json.dumps(task, ensure_ascii=False).encode())

    monkeypatch.setattr(sys, "stdin", _Stdin())
    with pytest.raises(adapter._SupervisorInvariantError, match="injected router invariant"):
        adapter._run()
    assert pi_calls == []


def test_pdf_skill_adapter_pending_term_goes_to_lane_handler_not_caller(
    monkeypatch,
):
    """TERM pending after blocked handler install is delivered to lane flag."""
    adapter = _load_pdf_adapter("coc_pdf_adapter_pending_term_test")
    caller_hits: list[int] = []

    def caller_handler(signum, _frame):
        caller_hits.append(signum)

    prev_term = signal.signal(signal.SIGTERM, caller_handler)
    prev_int = signal.getsignal(signal.SIGINT)
    prev_mask = signal.pthread_sigmask(signal.SIG_BLOCK, set())
    try:
        # Ensure TERM starts unblocked in caller mask snapshot sense; enter
        # will block, install, then unblock.
        signal.pthread_sigmask(signal.SIG_UNBLOCK, {signal.SIGTERM})
        flag = adapter._ShutdownFlag()
        real_install = adapter._install_interrupt_handlers

        def install_then_pend(flag_arg):
            handlers = real_install(flag_arg)
            # TERM is still blocked here — queue a pending signal for the
            # subsequent lane UNBLOCK to deliver to the new flag handler.
            os.kill(os.getpid(), signal.SIGTERM)
            return handlers

        monkeypatch.setattr(adapter, "_install_interrupt_handlers", install_then_pend)
        handlers, saved_mask = adapter._enter_producer_lane(flag)
        try:
            assert flag.requested is True
            assert caller_hits == []
        finally:
            # Leaving with requested flag fails closed; clear for restore.
            flag.requested = False
            adapter._leave_producer_lane(handlers, saved_mask, flag)
    finally:
        signal.signal(signal.SIGTERM, prev_term)
        signal.signal(signal.SIGINT, prev_int)
        signal.pthread_sigmask(signal.SIG_SETMASK, prev_mask)


def test_pdf_skill_adapter_exception_subset_three_consecutive_rounds(
    monkeypatch,
):
    """Core exception-path contracts pass three consecutive deterministic rounds."""
    real_killpg = os.killpg
    real_waitid = os.waitid
    for round_i in range(3):
        adapter = _load_pdf_adapter(f"coc_pdf_adapter_exc_round_{round_i}")
        monkeypatch.setattr(
            adapter, "_live_process_group_pids", lambda pgid: [pgid],
        )

        def boom_killpg(pgid, sig):
            raise PermissionError(errno.EPERM, "Operation not permitted")

        monkeypatch.setattr(os, "killpg", boom_killpg)
        with pytest.raises(adapter._SupervisorInvariantError, match="SIGKILL failed"):
            adapter._kill_process_group(1000 + round_i)
        monkeypatch.setattr(os, "killpg", real_killpg)

        def boom_waitid(*_a, **_k):
            raise OSError(errno.EINVAL, "invalid waitid")

        monkeypatch.setattr(os, "waitid", boom_waitid)
        with pytest.raises(adapter._SupervisorInvariantError, match="waitid failed"):
            adapter._leader_exited_nowait(2000 + round_i)
        monkeypatch.setattr(os, "waitid", real_waitid)


def test_pdf_skill_adapter_router_launch_oserror_falls_back(
    tmp_path: Path, monkeypatch,
):
    """Typed SessionLaunchError from missing router must fallback, not abort."""
    adapter = _load_pdf_adapter("coc_pdf_adapter_router_launch_fallback_test")
    missing = tmp_path / "missing-router-bin"
    # Path is absolute + executable bit so command discovery accepts it, but
    # the file is absent at exec time → Popen OSError → SessionLaunchError.
    missing.write_text("#!/bin/sh\n", encoding="utf-8")
    missing.chmod(0o755)
    missing.unlink()
    # Re-create as a dangling name: discovery checks is_file(); use a real
    # file then force spawn OSError via monkeypatch for determinism.
    router = tmp_path / "router-bin"
    router.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    router.chmod(0o755)
    monkeypatch.setenv("COC_PI_PDF_INSPECTOR_COMMAND", str(router))

    def boom_popen(*_a, **_k):
        raise FileNotFoundError(errno.ENOENT, "No such file or directory")

    monkeypatch.setattr(adapter.subprocess, "Popen", boom_popen)
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    pdf = tmp_path / "module.pdf"
    pdf.write_bytes(b"%PDF fixture")
    bundle_dir = workspace / ".tmp" / "coc-source-scope" / "camp" / "job" / "staging"
    bundle_dir.mkdir(parents=True)
    task = _locator_task(workspace, bundle_dir, pdf)
    pi_calls: list[str] = []

    def fake_run_pi(*_a, **_k):
        pi_calls.append("pi")
        return {
            "schema_version": 1,
            "contract_id": "coc.pi-source-scope-locator-producer-result.v1",
            "job_id": task["job_id"],
            "status": "not_located",
            "kind": task["kind"],
            "target_id": task["target_id"],
            "pdf_indices": [],
            "source_bundle_path": None,
            "failure_class": None,
        }

    monkeypatch.setattr(adapter, "_run_pi", fake_run_pi)
    monkeypatch.setattr(
        adapter,
        "_locator_receipt",
        lambda task_arg, producer: {"ok": True, "via": "pi-fallback"},
    )

    class _Stdin:
        buffer = io.BytesIO(json.dumps(task, ensure_ascii=False).encode())

    monkeypatch.setattr(sys, "stdin", _Stdin())
    # Entering lane needs real mask/handlers; only Popen is broken.
    result = adapter._run()
    assert result == {"ok": True, "via": "pi-fallback"}
    assert pi_calls == ["pi"]


def test_pdf_skill_adapter_lane_transition_restores_caller_three_rounds(
    monkeypatch,
):
    """Enter/leave must restore caller mask and handlers for three rounds."""
    adapter = _load_pdf_adapter("coc_pdf_adapter_lane_transition_rounds_test")
    # Establish a distinctive caller state: block TERM, custom handlers.
    def caller_term(_s, _f):
        return None

    def caller_int(_s, _f):
        return None

    prev_term = signal.signal(signal.SIGTERM, caller_term)
    prev_int = signal.signal(signal.SIGINT, caller_int)
    prev_mask = signal.pthread_sigmask(
        signal.SIG_BLOCK, {signal.SIGTERM},
    )
    try:
        for _round in range(3):
            before_term = signal.getsignal(signal.SIGTERM)
            before_int = signal.getsignal(signal.SIGINT)
            before_mask = signal.pthread_sigmask(signal.SIG_BLOCK, set())
            flag = adapter._ShutdownFlag()
            handlers, saved_mask = adapter._enter_producer_lane(flag)
            # Lane must be responsive: TERM/INT unblocked and flag handlers in.
            lane_mask = signal.pthread_sigmask(signal.SIG_BLOCK, set())
            assert signal.SIGTERM not in lane_mask
            assert signal.SIGINT not in lane_mask
            assert signal.getsignal(signal.SIGTERM) is not before_term
            assert signal.getsignal(signal.SIGINT) is not before_int
            adapter._leave_producer_lane(handlers, saved_mask, flag)
            assert signal.getsignal(signal.SIGTERM) is before_term
            assert signal.getsignal(signal.SIGINT) is before_int
            after_mask = signal.pthread_sigmask(signal.SIG_BLOCK, set())
            assert after_mask == before_mask
            assert signal.SIGTERM in after_mask
    finally:
        signal.signal(signal.SIGTERM, prev_term)
        signal.signal(signal.SIGINT, prev_int)
        signal.pthread_sigmask(signal.SIG_SETMASK, prev_mask)


def test_pdf_skill_adapter_termination_group_five_consecutive_rounds(
    tmp_path: Path,
):
    """Termination contracts must pass five consecutive deterministic rounds."""
    for round_i in range(5):
        round_dir = tmp_path / f"round-{round_i}"
        round_dir.mkdir()
        started = round_dir / "started"
        child_pid_path = round_dir / "child-pid"
        survivor = round_dir / "survivor"
        fake_pi = round_dir / "fake-pi"
        child_code = (
            "import os,signal,time,pathlib;"
            "signal.signal(signal.SIGTERM,signal.SIG_IGN);"
            f"pathlib.Path({str(child_pid_path)!r}).write_text(str(os.getpid()));"
            "time.sleep(3);"
            f"pathlib.Path({str(survivor)!r}).write_text('survived')"
        )
        fake_pi.write_text(
            f"""#!{os.fspath(Path(os.sys.executable).resolve())}
import os
import signal
import subprocess
import sys
import time
from pathlib import Path
if sys.argv[1:] == ["--version"]:
    raise SystemExit(0)
signal.signal(signal.SIGTERM, signal.SIG_DFL)
subprocess.Popen([sys.executable, "-c", {child_code!r}])
Path({str(started)!r}).write_text(str(os.getpid()))
time.sleep(20)
""",
            encoding="utf-8",
        )
        fake_pi.chmod(0o755)
        workspace = round_dir / "workspace"
        workspace.mkdir()
        task = _locator_termination_task(
            round_dir, workspace, tag=f"term5-{round_i}",
        )
        pdf_skill = round_dir / "pdf-skill" / "SKILL.md"
        pdf_skill.parent.mkdir()
        pdf_skill.write_text("# term5 fixture\n", encoding="utf-8")
        env = {
            **os.environ,
            "COC_PI_COMMAND": str(fake_pi),
            "COC_PI_PDF_SKILL": str(pdf_skill),
        }
        env.pop("COC_PI_PDF_INSPECTOR_COMMAND", None)
        adapter = PLUGIN / "pi/bin/coc-pdf-skill-adapter.py"
        process = subprocess.Popen(
            [os.sys.executable, str(adapter), "--run"],
            cwd=ROOT,
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            start_new_session=True,
        )
        assert process.stdin is not None
        process.stdin.write(json.dumps(task))
        process.stdin.close()
        deadline = time.monotonic() + 3
        while not started.is_file() and time.monotonic() < deadline:
            time.sleep(0.02)
        assert started.is_file(), f"round {round_i} leader did not start"
        deadline = time.monotonic() + 3
        while not child_pid_path.is_file() and time.monotonic() < deadline:
            time.sleep(0.02)
        assert child_pid_path.is_file(), f"round {round_i} grandchild missing"
        child_pid = int(child_pid_path.read_text(encoding="utf-8"))
        process.send_signal(signal.SIGTERM)
        assert process.wait(timeout=5) != 0, f"round {round_i} exit code"
        deadline = time.monotonic() + 1.0
        while time.monotonic() < deadline:
            try:
                os.kill(child_pid, 0)
            except ProcessLookupError:
                break
            time.sleep(0.02)
        with pytest.raises(ProcessLookupError):
            os.kill(child_pid, 0)
        assert not survivor.exists(), f"round {round_i} survivor leaked"


def test_pdf_skill_adapter_uses_one_shot_pi_grok_pdf_skill_argv(
    tmp_path: Path, monkeypatch,
):
    argv_path = tmp_path / "argv.json"
    fake_pi = tmp_path / "fake-pi"
    fake_pi.write_text(
        f"""#!{os.fspath(Path(os.sys.executable).resolve())}
import json
import sys
from pathlib import Path
args = sys.argv[1:]
Path({str(argv_path)!r}).write_text(json.dumps(args))
print('{{"status":"ok"}}')
""",
        encoding="utf-8",
    )
    fake_pi.chmod(0o755)
    monkeypatch.setenv("COC_PI_COMMAND", str(fake_pi))
    skill = tmp_path / "pdf"
    skill.mkdir()
    (skill / "SKILL.md").write_text("# fixture\n", encoding="utf-8")
    monkeypatch.setenv("COC_PI_PDF_SKILL", str(skill))
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    adapter = _load_pdf_adapter("coc_pdf_adapter_pi_argv_test")

    result = adapter._run_pi("closed task", workspace, timeout=10)

    assert result == {"status": "ok"}
    argv = json.loads(argv_path.read_text(encoding="utf-8"))
    assert argv == [
        "--mode", "text", "-p", "--no-session",
        "--no-extensions", "--no-skills", "--no-prompt-templates",
        "--no-context-files", "--approve",
        "--tools", "read,bash,write",
        "--model", "xai/grok-4.5",
        "--thinking", "low",
        "--skill", str(skill.resolve()),
        "closed task",
    ]
    assert "resume" not in argv
    assert all("codex" not in arg.lower() for arg in argv)


def test_pdf_skill_adapter_resolves_default_skill_from_codex_home(
    tmp_path: Path, monkeypatch,
):
    codex_home = tmp_path / "portable-codex-home"
    skill = codex_home / "skills" / "pdf"
    skill.mkdir(parents=True)
    (skill / "SKILL.md").write_text("# portable fixture\n", encoding="utf-8")
    monkeypatch.delenv("COC_PI_PDF_SKILL", raising=False)
    monkeypatch.setenv("CODEX_HOME", str(codex_home))
    adapter = _load_pdf_adapter("coc_pdf_adapter_portable_skill_test")

    assert adapter._pdf_skill() == skill.resolve()




def _locator_task(workspace: Path, bundle_dir: Path, pdf: Path) -> dict:
    return {
        "schema_version": 1,
        "contract_id": "coc.pi-source-scope-locator-task.v1",
        "adapter_mode": "pi_external_pdf_skill_lifecycle",
        "model_policy": "pinned_xai_grok_4_5_thinking_low",
        "max_selected_pages": 3,
        "workspace_root": str(workspace),
        "asset_root_id": "raw-pdf-bind:camp",
        "job_id": "job-locator-receipt",
        "kind": "raw_pdf_bind_first_bundle",
        "target_id": "pdf:module",
        "target_label": "module.pdf",
        "source_bundle_path": str(bundle_dir),
        "cached_pdf_indices": [],
        "source": {
            "path": str(pdf),
            "source_id": "pdf:module",
            "title": "module.pdf",
            "file_sha256": hashlib.sha256(pdf.read_bytes()).hexdigest(),
        },
    }


def _locator_bundle(root: Path, pdf: Path, pdf_indices: list[int]) -> None:
    """Write a load_host_bundle-valid codex-pdf-skill bundle."""
    pages = root / "pages"
    pages.mkdir(parents=True)
    manifest_pages = []
    for index in pdf_indices:
        page_bytes = (
            f"# Page {index + 1}  \r\n\r\nExtracted text {index}.   \r\n"
        ).encode()
        (pages / f"{index:04d}.md").write_bytes(page_bytes)
        manifest_pages.append({
            "pdf_index": index,
            "printed_page": index + 1,
            "markdown_path": f"pages/{index:04d}.md",
            "text_sha256": hashlib.sha256(page_bytes).hexdigest(),
            "review_state": "manual_accepted",
            "parse_confidence": 0.93,
            "grep_anchors": [f"Extracted text {index}."],
        })
    manifest = {
        "schema_version": 1,
        "producer": "codex-pdf-skill",
        "source": {
            "source_id": "pdf:module",
            "title": "module.pdf",
            "path": str(pdf),
            "file_sha256": hashlib.sha256(pdf.read_bytes()).hexdigest(),
            "page_count": 48,
        },
        "pages": manifest_pages,
        "assets": [],
    }
    (root / "manifest.json").write_text(
        json.dumps(manifest), encoding="utf-8",
    )


def test_pdf_skill_adapter_locator_run_uses_shared_pi_timeout_budget(
    tmp_path: Path, monkeypatch,
):
    """The locator child shares the 900s producer budget with the opening
    review and full-parse lanes. The old 240s hard budget killed children
    whose wall time was dominated by model-API latency (observed 82-380s
    and past 240s on the same Cold Harvest PDF), always before the
    extension's outer budget could take over."""
    adapter = _load_pdf_adapter("coc_pdf_adapter_locator_timeout_test")
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    bundle_dir = (
        workspace / ".tmp" / "coc-source-scope" / "camp" / "job" / "staging"
    )
    bundle_dir.mkdir(parents=True)
    pdf = tmp_path / "module.pdf"
    pdf.write_bytes(b"%PDF fixture")
    task = _locator_task(workspace, bundle_dir, pdf)
    captured: dict = {}

    def fake_run_pi(
        prompt, cwd, *, timeout, allow_non_json_receipt=False, shutdown=None,
    ):
        captured["timeout"] = timeout
        captured["allow_non_json_receipt"] = allow_non_json_receipt
        captured["shutdown"] = shutdown
        return None

    def fake_receipt(task, producer_result):
        return {"receipt": "ok"}

    monkeypatch.setattr(adapter, "_run_pi", fake_run_pi)
    monkeypatch.setattr(adapter, "_locator_receipt", fake_receipt)

    class _Stdin:
        buffer = io.BytesIO(json.dumps(task, ensure_ascii=False).encode())

    monkeypatch.setattr(sys, "stdin", _Stdin())
    result = adapter._run()
    assert result == {"receipt": "ok"}
    assert captured["allow_non_json_receipt"] is True
    assert captured["timeout"] == adapter.PI_TIMEOUT_SECONDS
    assert captured["timeout"] > 240


def test_pdf_skill_adapter_locator_receipt_emits_printed_scope_from_bundle(
    tmp_path: Path,
):
    """The child declares printed page numbers (1-based, the task's
    pdf_index_caliber) while the bundle manifest pdf_index is zero-based.
    The receipt must emit the bundle scope converted to 1-based, and must
    not reject a valid bundle over the declaration drift (observed in
    reproduction: child declared [1,2,3] while writing pages [0,1,2])."""
    adapter = _load_pdf_adapter("coc_pdf_adapter_locator_caliber_test")
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    bundle_dir = (
        workspace / ".tmp" / "coc-source-scope" / "camp" / "job" / "staging"
    )
    bundle_dir.mkdir(parents=True)
    pdf = tmp_path / "module.pdf"
    pdf.write_bytes(b"%PDF fixture")
    _locator_bundle(bundle_dir, pdf, [0, 1, 2])
    task = _locator_task(workspace, bundle_dir, pdf)
    producer = {
        "schema_version": 1,
        "contract_id": "coc.pi-source-scope-locator-producer-result.v1",
        "job_id": task["job_id"],
        "status": "located",
        "kind": task["kind"],
        "target_id": task["target_id"],
        "pdf_indices": [1, 2, 3],
        "source_bundle_path": task["source_bundle_path"],
        "failure_class": None,
    }

    receipt = adapter._locator_receipt(task, producer)
    assert receipt["status"] == "located"
    assert receipt["pdf_indices"] == [1, 2, 3]


def test_pdf_skill_adapter_locator_receipt_trusts_bundle_over_drifted_declaration(
    tmp_path: Path,
):
    """The validated bundle is the authoritative selected scope; a
    well-formed but drifted self-declaration must not discard a valid
    bundle (reproduction: child declared [4,5,6]-style set while writing
    [3,4,5], which hard-failed the whole 102s run under the old raw
    comparison)."""
    adapter = _load_pdf_adapter("coc_pdf_adapter_locator_authority_test")
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    bundle_dir = (
        workspace / ".tmp" / "coc-source-scope" / "camp" / "job" / "staging"
    )
    bundle_dir.mkdir(parents=True)
    pdf = tmp_path / "module.pdf"
    pdf.write_bytes(b"%PDF fixture")
    _locator_bundle(bundle_dir, pdf, [3, 4, 5])
    task = _locator_task(workspace, bundle_dir, pdf)
    producer = {
        "schema_version": 1,
        "contract_id": "coc.pi-source-scope-locator-producer-result.v1",
        "job_id": task["job_id"],
        "status": "located",
        "kind": task["kind"],
        "target_id": task["target_id"],
        "pdf_indices": [4, 5, 6],
        "source_bundle_path": task["source_bundle_path"],
        "failure_class": None,
    }

    receipt = adapter._locator_receipt(task, producer)
    assert receipt["status"] == "located"
    assert receipt["pdf_indices"] == [4, 5, 6]


def test_pdf_skill_adapter_locator_receipt_requires_bundle_for_located(
    tmp_path: Path,
):
    """A located claim without a written bundle is still a hard failure."""
    adapter = _load_pdf_adapter("coc_pdf_adapter_locator_no_bundle_test")
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    bundle_dir = (
        workspace / ".tmp" / "coc-source-scope" / "camp" / "job" / "staging"
    )
    bundle_dir.mkdir(parents=True)
    pdf = tmp_path / "module.pdf"
    pdf.write_bytes(b"%PDF fixture")
    task = _locator_task(workspace, bundle_dir, pdf)
    producer = {
        "schema_version": 1,
        "contract_id": "coc.pi-source-scope-locator-producer-result.v1",
        "job_id": task["job_id"],
        "status": "located",
        "kind": task["kind"],
        "target_id": task["target_id"],
        "pdf_indices": [1],
        "source_bundle_path": task["source_bundle_path"],
        "failure_class": None,
    }

    with pytest.raises(RuntimeError, match="located result bundle is unavailable"):
        adapter._locator_receipt(task, producer)


def _fake_pdf_inspector(
    path: Path,
    *,
    status: str = "ok",
    write_bundle: bool = True,
    source_bundle_path: str | None = None,
    rendered_pdf_indices: list[int] | None = None,
    exit_code: int = 0,
    stdout: str | None = None,
    bad_json: bool = False,
    page_count: int = 48,
    request_log: Path | None = None,
) -> Path:
    """Write a hermetic external router executable for adapter tests."""
    payload = {
        "status": status,
        "write_bundle": write_bundle,
        "source_bundle_path": source_bundle_path,
        "rendered_pdf_indices": rendered_pdf_indices,
        "exit_code": exit_code,
        "stdout": stdout,
        "bad_json": bad_json,
        "page_count": page_count,
        "request_log": None if request_log is None else str(request_log),
        # unicode_escape turns these into CR/LF inside the child process.
        "page_template": "# Page {n}  \\r\\n\\r\\nExtracted text {i}.   \\r\\n",
    }
    config_literal = json.dumps(payload, ensure_ascii=False)
    script = (
        f"#!{os.fspath(Path(os.sys.executable).resolve())}\n"
        "import hashlib\n"
        "import json\n"
        "import sys\n"
        "from pathlib import Path\n"
        f"CFG = json.loads({config_literal!r})\n"
        "raw = sys.stdin.read()\n"
        "req = json.loads(raw)\n"
        "if CFG.get('request_log'):\n"
        "    Path(CFG['request_log']).write_text(raw, encoding='utf-8')\n"
        "if CFG.get('bad_json'):\n"
        "    sys.stdout.write('not-json')\n"
        "    raise SystemExit(int(CFG['exit_code']))\n"
        "if CFG.get('stdout') is not None:\n"
        "    sys.stdout.write(str(CFG['stdout']))\n"
        "    raise SystemExit(int(CFG['exit_code']))\n"
        "bundle_path = CFG.get('source_bundle_path') or req['source_bundle_path']\n"
        "rendered = CFG.get('rendered_pdf_indices')\n"
        "if rendered is None:\n"
        "    rendered = (\n"
        "        [0, 1, 2]\n"
        "        if req.get('mode') == 'locator_first_bundle'\n"
        "        else list(req.get('missing_pdf_indices') or [0])\n"
        "    )\n"
        "if CFG.get('write_bundle') and CFG.get('status') == 'ok':\n"
        "    root = Path(bundle_path)\n"
        "    pages = root / 'pages'\n"
        "    pages.mkdir(parents=True, exist_ok=True)\n"
        "    source = req['source']\n"
        "    page_template = CFG['page_template'].encode('utf-8').decode('unicode_escape')\n"
        "    manifest_pages = []\n"
        "    for index in rendered:\n"
        "        page_bytes = page_template.format(n=index + 1, i=index).encode()\n"
        "        (pages / f'{index:04d}.md').write_bytes(page_bytes)\n"
        "        manifest_pages.append({\n"
        "            'pdf_index': index,\n"
        "            'printed_page': index + 1,\n"
        "            'markdown_path': f'pages/{index:04d}.md',\n"
        "            'text_sha256': hashlib.sha256(page_bytes).hexdigest(),\n"
        "            'review_state': 'manual_accepted',\n"
        "            'parse_confidence': 0.93,\n"
        "            'grep_anchors': [f'Extracted text {index}.'],\n"
        "        })\n"
        "    manifest = {\n"
        "        'schema_version': 1,\n"
        "        'producer': req.get('manifest_producer_literal') or 'codex-pdf-skill',\n"
        "        'source': {\n"
        "            'source_id': source['source_id'],\n"
        "            'title': source['title'],\n"
        "            'path': source['path'],\n"
        "            'file_sha256': source['file_sha256'],\n"
        "            'page_count': CFG['page_count'],\n"
        "        },\n"
        "        'pages': manifest_pages,\n"
        "        'assets': [],\n"
        "    }\n"
        "    (root / 'manifest.json').write_text(\n"
        "        json.dumps(manifest), encoding='utf-8',\n"
        "    )\n"
        "result = {\n"
        "    'schema_version': 1,\n"
        "    'contract_id': 'coc.pi-pdf-inspector-result.v1',\n"
        "    'status': CFG['status'],\n"
        "    'reason': 'fixture',\n"
        "    'source_bundle_path': bundle_path,\n"
        "    'rendered_pdf_indices': rendered,\n"
        "}\n"
        "sys.stdout.write(\n"
        "    json.dumps(result, ensure_ascii=False, separators=(',', ':'))\n"
        ")\n"
        "raise SystemExit(int(CFG['exit_code']))\n"
    )
    path.write_text(script, encoding="utf-8")
    path.chmod(0o755)
    return path



def _full_parse_task(
    workspace: Path, bundle_dir: Path, pdf: Path, *,
    page_count: int = 3, cached: list[int] | None = None, batch_limit: int = 3,
) -> dict:
    return {
        "schema_version": 1,
        "contract_id": "coc.pi-full-parse-render-task.v1",
        "workspace_root": str(workspace),
        "campaign_id": "camp",
        "asset_root_id": "raw-pdf-bind:camp",
        "job_id": "job-full-parse",
        "source_bundle_path": str(bundle_dir),
        "page_count": page_count,
        "batch_limit": batch_limit,
        "requested_pdf_indices": list(range(page_count)),
        "cached_pdf_indices": list(cached or []),
        "source": {
            "path": str(pdf),
            "source_id": "pdf:module",
            "title": "module.pdf",
            "file_sha256": hashlib.sha256(pdf.read_bytes()).hexdigest(),
        },
        "source_bundle_manifest_contract": {"schema_version": 1},
        "register_operation": {"operation": "module.register_source_bundle"},
        "fulfill_operation": {"operation": "module.fulfill_full_parse"},
    }


def test_pdf_skill_adapter_has_no_repository_pdf_parser_imports():
    source = (
        PLUGIN / "pi/bin/coc-pdf-skill-adapter.py"
    ).read_text(encoding="utf-8")
    assert '"repository_pdf_parser": False' in source
    forbidden = (
        "import pypdf", "from pypdf", "import pdfminer", "from pdfminer",
        "import fitz", "from fitz", "import pymupdf", "from pymupdf",
        "import pdf2image", "from pdf2image", "import firecrawl",
        "from firecrawl", "import pdfplumber", "from pdfplumber",
    )
    lowered = source.lower()
    for token in forbidden:
        assert token not in lowered
    assert "COC_PI_PDF_INSPECTOR_COMMAND" in source
    assert "_try_external_pdf_router" in source


def test_pdf_inspector_command_env_requires_absolute_executable(
    tmp_path: Path, monkeypatch,
):
    adapter = _load_pdf_adapter("coc_pdf_adapter_inspector_env_test")
    monkeypatch.delenv("COC_PI_PDF_INSPECTOR_COMMAND", raising=False)
    assert adapter._pdf_inspector_command() is None

    relative = tmp_path / "router"
    relative.write_text("#!/bin/sh\n", encoding="utf-8")
    relative.chmod(0o755)
    monkeypatch.setenv("COC_PI_PDF_INSPECTOR_COMMAND", "router")
    assert adapter._pdf_inspector_command() is None

    not_exec = tmp_path / "not-exec"
    not_exec.write_text("#!/bin/sh\n", encoding="utf-8")
    not_exec.chmod(0o644)
    monkeypatch.setenv("COC_PI_PDF_INSPECTOR_COMMAND", str(not_exec))
    assert adapter._pdf_inspector_command() is None

    good = tmp_path / "good-router"
    good.write_text("#!/bin/sh\n", encoding="utf-8")
    good.chmod(0o755)
    monkeypatch.setenv("COC_PI_PDF_INSPECTOR_COMMAND", str(good))
    assert adapter._pdf_inspector_command() == str(good)


def test_pdf_skill_adapter_locator_router_success_skips_run_pi(
    tmp_path: Path, monkeypatch,
):
    adapter = _load_pdf_adapter("coc_pdf_adapter_locator_router_ok_test")
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    bundle_dir = (
        workspace / ".tmp" / "coc-source-scope" / "camp" / "job" / "staging"
    )
    bundle_dir.mkdir(parents=True)
    pdf = tmp_path / "module.pdf"
    pdf.write_bytes(b"%PDF fixture")
    task = _locator_task(workspace, bundle_dir, pdf)
    request_log = tmp_path / "router-request.json"
    router = _fake_pdf_inspector(
        tmp_path / "router",
        rendered_pdf_indices=[0, 1, 2],
        request_log=request_log,
    )
    monkeypatch.setenv("COC_PI_PDF_INSPECTOR_COMMAND", str(router))
    calls: list[str] = []

    def boom_run_pi(*_args, **_kwargs):
        calls.append("run_pi")
        raise AssertionError("_run_pi must not be called on router ok")

    monkeypatch.setattr(adapter, "_run_pi", boom_run_pi)

    class _Stdin:
        buffer = io.BytesIO(json.dumps(task, ensure_ascii=False).encode())

    monkeypatch.setattr(sys, "stdin", _Stdin())
    result = adapter._run()
    assert calls == []
    assert result["status"] == "located"
    assert result["pdf_indices"] == [1, 2, 3]
    assert result["source_bundle_path"] == task["source_bundle_path"]
    request = json.loads(request_log.read_text(encoding="utf-8"))
    assert request["contract_id"] == "coc.pi-pdf-inspector-request.v1"
    assert request["mode"] == "locator_first_bundle"
    assert request["manifest_producer_literal"] == "codex-pdf-skill"
    assert request["source_bundle_path"] == task["source_bundle_path"]
    assert request["source"]["file_sha256"] == task["source"]["file_sha256"]


def test_pdf_skill_adapter_locator_router_fallback_uses_pdf_skill(
    tmp_path: Path, monkeypatch,
):
    adapter = _load_pdf_adapter("coc_pdf_adapter_locator_router_fallback_test")
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    bundle_dir = (
        workspace / ".tmp" / "coc-source-scope" / "camp" / "job" / "staging"
    )
    bundle_dir.mkdir(parents=True)
    pdf = tmp_path / "module.pdf"
    pdf.write_bytes(b"%PDF fixture")
    task = _locator_task(workspace, bundle_dir, pdf)

    for status in ("fallback", "needs_ocr", "unsupported", "failed"):
        router = _fake_pdf_inspector(
            tmp_path / f"router-{status}",
            status=status,
            write_bundle=False,
        )
        monkeypatch.setenv("COC_PI_PDF_INSPECTOR_COMMAND", str(router))
        calls: list[str] = []

        def fake_run_pi(*_args, **_kwargs):
            calls.append("run_pi")
            return {"from": "skill"}

        def fake_receipt(_task, producer_result):
            return {"receipt": producer_result}

        monkeypatch.setattr(adapter, "_run_pi", fake_run_pi)
        monkeypatch.setattr(adapter, "_locator_receipt", fake_receipt)

        class _Stdin:
            buffer = io.BytesIO(json.dumps(task, ensure_ascii=False).encode())

        monkeypatch.setattr(sys, "stdin", _Stdin())
        result = adapter._run()
        assert calls == ["run_pi"], status
        assert result == {"receipt": {"from": "skill"}}, status


@pytest.mark.parametrize(
    "fault",
    ("bad_json", "nonzero", "path_drift", "illegal_bundle", "unset"),
)
def test_pdf_skill_adapter_locator_router_faults_fall_back(
    tmp_path: Path, monkeypatch, fault: str,
):
    adapter = _load_pdf_adapter(f"coc_pdf_adapter_locator_router_{fault}_test")
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    bundle_dir = (
        workspace / ".tmp" / "coc-source-scope" / "camp" / "job" / "staging"
    )
    bundle_dir.mkdir(parents=True)
    pdf = tmp_path / "module.pdf"
    pdf.write_bytes(b"%PDF fixture")
    task = _locator_task(workspace, bundle_dir, pdf)

    if fault == "unset":
        monkeypatch.delenv("COC_PI_PDF_INSPECTOR_COMMAND", raising=False)
    elif fault == "bad_json":
        router = _fake_pdf_inspector(tmp_path / "router", bad_json=True)
        monkeypatch.setenv("COC_PI_PDF_INSPECTOR_COMMAND", str(router))
    elif fault == "nonzero":
        router = _fake_pdf_inspector(
            tmp_path / "router", status="ok", exit_code=2, write_bundle=False,
        )
        monkeypatch.setenv("COC_PI_PDF_INSPECTOR_COMMAND", str(router))
    elif fault == "path_drift":
        other = str(tmp_path / "other-bundle")
        router = _fake_pdf_inspector(
            tmp_path / "router",
            source_bundle_path=other,
            write_bundle=False,
        )
        monkeypatch.setenv("COC_PI_PDF_INSPECTOR_COMMAND", str(router))
    else:
        # ok status but empty/missing bundle contents
        router = _fake_pdf_inspector(
            tmp_path / "router", status="ok", write_bundle=False,
        )
        monkeypatch.setenv("COC_PI_PDF_INSPECTOR_COMMAND", str(router))

    calls: list[str] = []

    def fake_run_pi(*_args, **_kwargs):
        calls.append("run_pi")
        return {"from": "skill"}

    def fake_receipt(_task, producer_result):
        return {"receipt": producer_result}

    monkeypatch.setattr(adapter, "_run_pi", fake_run_pi)
    monkeypatch.setattr(adapter, "_locator_receipt", fake_receipt)

    class _Stdin:
        buffer = io.BytesIO(json.dumps(task, ensure_ascii=False).encode())

    monkeypatch.setattr(sys, "stdin", _Stdin())
    result = adapter._run()
    assert calls == ["run_pi"]
    assert result == {"receipt": {"from": "skill"}}


def test_pdf_skill_adapter_full_parse_router_success_registers_bundle(
    tmp_path: Path, monkeypatch,
):
    adapter = _load_pdf_adapter("coc_pdf_adapter_full_parse_router_ok_test")
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    bundle_dir = (
        workspace / ".tmp" / "coc-full-parse" / "camp" / "job" / "staging"
    )
    bundle_dir.mkdir(parents=True)
    pdf = tmp_path / "module.pdf"
    pdf.write_bytes(b"%PDF fixture")
    task = _full_parse_task(workspace, bundle_dir, pdf, page_count=3)
    router = _fake_pdf_inspector(
        tmp_path / "router",
        rendered_pdf_indices=[0, 1, 2],
        page_count=3,
    )
    monkeypatch.setenv("COC_PI_PDF_INSPECTOR_COMMAND", str(router))
    calls: list[str] = []
    registered: list[tuple] = []

    def boom_run_pi(*_args, **_kwargs):
        calls.append("run_pi")
        raise AssertionError("_run_pi must not be called on router ok")

    class _Assets:
        @staticmethod
        def register_source_bundle(ws, output, *, asset_root_id, record_drift):
            registered.append(
                (Path(ws), Path(output), asset_root_id, record_drift),
            )
            return {"ok": True}

        @staticmethod
        def read_full_parse_state(ws, asset_root_id):
            return {"complete": True}

    class _PdfBundle:
        @staticmethod
        def load_host_bundle(path):
            # Delegate to the real validator so the half-chain stays honest.
            scripts = PLUGIN / "scripts"
            if str(scripts) not in sys.path:
                sys.path.insert(0, str(scripts))
            import coc_pdf_bundle
            return coc_pdf_bundle.load_host_bundle(path)

    monkeypatch.setattr(adapter, "_run_pi", boom_run_pi)
    monkeypatch.setattr(
        adapter,
        "_runtime_modules",
        lambda: (None, _PdfBundle, None, _Assets),
    )

    class _Stdin:
        buffer = io.BytesIO(json.dumps(task, ensure_ascii=False).encode())

    monkeypatch.setattr(sys, "stdin", _Stdin())
    result = adapter._run_full_parse_batch()
    assert calls == []
    assert len(registered) == 1
    assert registered[0][0] == workspace.resolve()
    assert registered[0][1] == bundle_dir.resolve()
    assert registered[0][2] == task["asset_root_id"]
    assert registered[0][3] is True
    pack = result["results"][0]["pack"]
    assert pack["status"] == "complete"
    assert pack["rendered_pdf_indices"] == [0, 1, 2]


def test_pdf_skill_adapter_full_parse_router_fallback_uses_pdf_skill(
    tmp_path: Path, monkeypatch,
):
    adapter = _load_pdf_adapter("coc_pdf_adapter_full_parse_router_fallback_test")
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    bundle_dir = (
        workspace / ".tmp" / "coc-full-parse" / "camp" / "job" / "staging"
    )
    bundle_dir.mkdir(parents=True)
    pdf = tmp_path / "module.pdf"
    pdf.write_bytes(b"%PDF fixture")
    task = _full_parse_task(workspace, bundle_dir, pdf, page_count=2)
    router = _fake_pdf_inspector(
        tmp_path / "router", status="needs_ocr", write_bundle=False,
    )
    monkeypatch.setenv("COC_PI_PDF_INSPECTOR_COMMAND", str(router))
    calls: list[str] = []

    def fake_run_pi(*_args, **_kwargs):
        calls.append("run_pi")
        return {
            "schema_version": 1,
            "contract_id": "coc.pi-full-parse-render-producer-result.v1",
            "status": "failed",
            "rendered_pdf_indices": [],
            "failure_class": "skill_fallback_path",
            "source_bundle_path": None,
        }

    monkeypatch.setattr(adapter, "_run_pi", fake_run_pi)

    class _Stdin:
        buffer = io.BytesIO(json.dumps(task, ensure_ascii=False).encode())

    monkeypatch.setattr(sys, "stdin", _Stdin())
    result = adapter._run_full_parse_batch()
    assert calls == ["run_pi"]
    assert result["results"][0]["pack"]["status"] == "failed"
    assert result["results"][0]["pack"]["failure_class"] == "skill_fallback_path"


def test_pdf_skill_adapter_opening_review_does_not_call_router(
    tmp_path: Path, monkeypatch,
):
    adapter = _load_pdf_adapter("coc_pdf_adapter_opening_no_router_test")
    router_calls: list[str] = []

    def track_router(*_args, **_kwargs):
        router_calls.append("router")
        return {"should": "not-be-used"}

    monkeypatch.setattr(adapter, "_try_external_pdf_router", track_router)

    # Fail closed early in opening review before any producer work. The
    # assertion under test is only that the router helper is never entered.
    class _Stdin:
        buffer = io.BytesIO(b"{")

    monkeypatch.setattr(sys, "stdin", _Stdin())
    with pytest.raises((RuntimeError, json.JSONDecodeError, ValueError)):
        adapter._run_opening_review()
    assert router_calls == []

    source = (
        PLUGIN / "pi/bin/coc-pdf-skill-adapter.py"
    ).read_text(encoding="utf-8")
    # Opening lane must not invoke the external router helper.
    opening_fn = source.split("def _run_opening_review", 1)[1].split(
        "\ndef _validate_full_parse_task", 1,
    )[0]
    assert "_try_external_pdf_router" not in opening_fn
    assert "_run_pi" in opening_fn


def test_extension_locator_environment_whitelists_pdf_inspector_command():
    source = (PLUGIN / "pi/extensions/index.ts").read_text(encoding="utf-8")
    block = source.split("function locatorEnvironment", 1)[1].split(
        "export function validatePiSourceScopeLocatorTask", 1,
    )[0]
    assert "COC_PI_PDF_INSPECTOR_COMMAND" in block
    assert "COC_PI_COMMAND" in block
    assert "COC_PI_PDF_SKILL" in block


def _load_assets_module():
    scripts = PLUGIN / "scripts"
    sys.path.insert(0, str(scripts))
    import coc_module_assets
    return coc_module_assets












def test_pdf_skill_adapter_validates_bundle_bound_opening_facts(tmp_path: Path):
    adapter = _load_pdf_adapter("coc_pdf_adapter_strict_receipt_test")
    task = {
        "campaign_id": "campaign-a",
        "scenario_id": "scenario-a",
        "source_bundle_path": str(tmp_path / "bundle"),
        "source": {"source_id": "pdf:scenario-a"},
    }
    refs = [{"source_id": "pdf:scenario-a", "pdf_index": 3}]
    source = lambda value: {
        "status": "source", "value": value, "source_refs": refs,
    }
    unresolved = {
        "status": "unresolved", "inspected_source_refs": refs,
    }
    facts = {
        "schema_version": 1,
        "contract_id": "coc.opening-fast-facts.v1",
        "era": source("1920s"),
        "place": source("Boston"),
        "investigator_hook": unresolved,
        "investigator_constraints": unresolved,
        "player_safe_summary": unresolved,
        "content_flags": source(["haunting"]),
    }
    l0 = {
        "schema_version": 1,
        "secrecy": "keeper_only",
        "module_meta": {
            "title_zh": "测试模组", "title_en": "Test Module",
            "authors": [], "translator": [], "era": "1920s",
            "locale": "Boston", "party_size": "1-4",
            "duration_hint": "one session", "tone_tags": ["mystery"],
            "mythos_entities": [], "campaign_hooks": ["letter"],
            "warnings": [], "safety_notes": None,
            "structure_type": "linear_investigation",
        },
        "pregens": [],
        "opening_hooks": [{
            "id": "letter", "audience": "player",
            "text": "A letter arrives.", "variant_of": None,
        }],
        "chargen_deltas": [],
        "opening_handouts": [],
    }
    valid = {
        "schema_version": 1,
        "contract_id": "coc.pi-opening-pdf-producer-result.v1",
        "status": "reviewed",
        "campaign_id": "campaign-a",
        "scenario_id": "scenario-a",
        "selected_opening_pdf_indices": [10, 11],
        "fact_evidence_pdf_indices": [3, 4],
        "source_bundle_path": str(tmp_path / "bundle"),
        "failure_class": None,
        "facts": facts,
        "module_init_l0": l0,
    }
    assert adapter._validate_opening_result(valid, task) == valid
    with pytest.raises(RuntimeError, match="invalid"):
        adapter._validate_opening_result({
            **valid,
            "selected_opening_pdf_indices": [10, 12],
        }, task)
    with pytest.raises(RuntimeError, match="invalid"):
        adapter._validate_opening_result({
            **valid,
            "scenario_id": "foreign",
        }, task)
    with pytest.raises(RuntimeError, match="shape invalid"):
        adapter._validate_opening_result({
            **valid,
            "facts": {
                **facts,
                "era": {
                    **facts["era"],
                    "raw_excerpt": "RAW_SOURCE_TEXT must never cross",
                },
            },
        }, task)
    with pytest.raises(RuntimeError, match="outside final reviewed bundle"):
        adapter._validate_opening_result({
            **valid,
            "facts": {
                **facts,
                "place": {
                    "status": "source",
                    "value": "Boston",
                    "source_refs": [
                        {"source_id": "pdf:foreign", "pdf_index": 3}
                    ],
                },
            },
        }, task)
    with pytest.raises(RuntimeError, match="value invalid"):
        adapter._validate_opening_result({
            **valid,
            "facts": {
                **facts,
                "era": {
                    "status": "source",
                    "value": "x" * 129,
                    "source_refs": refs,
                },
            },
        }, task)
    with pytest.raises(RuntimeError, match="reviewed.*invalid"):
        adapter._validate_opening_result({
            **valid,
            "fact_evidence_pdf_indices": list(range(9)),
        }, task)
    with pytest.raises(RuntimeError, match="outside final reviewed bundle"):
        adapter._validate_opening_result({
            **valid,
            "facts": {
                **facts,
                "place": {
                    "status": "source",
                    "value": "Boston",
                    "source_refs": [
                        {"source_id": "pdf:scenario-a", "pdf_index": 8}
                    ],
                },
            },
        }, task)
    failed = {
        **valid,
        "status": "failed",
        "selected_opening_pdf_indices": [],
        "fact_evidence_pdf_indices": [],
        "source_bundle_path": None,
        "failure_class": "pdf_failed",
        "facts": None,
        "module_init_l0": None,
    }
    assert adapter._validate_opening_result(failed, task) == failed
    with pytest.raises(RuntimeError, match="failed.*invalid"):
        adapter._validate_opening_result({
            **failed, "facts": facts,
        }, task)


def test_opening_producer_task_does_not_launder_placeholder_era(
    tmp_path: Path, monkeypatch,
):
    adapter = _load_pdf_adapter("coc_pdf_adapter_no_placeholder_era_test")
    monkeypatch.setattr(
        adapter,
        "_preseed_reusable_bound_source",
        lambda output, private, pdf_bundle: {"manifest": {}, "normalized_pages": []},
    )
    task = adapter._opening_producer_task(
        tmp_path,
        {"campaign_id": "campaign-a"},
        {
            "title": "Scenario A",
            "source": {"path": str(tmp_path / "source.pdf")},
        },
        {
            "era": "1920s",
            "era_source": "unestablished",
            "play_language": "zh-Hans",
        },
        {
            "scenario_id": "scenario-a",
            "source_id": "pdf:scenario-a",
            "source_file_sha256": "a" * 64,
            "allowed_pdf_indices": [0],
        },
        object(),
    )
    assert "era" not in task
    assert task["max_fact_evidence_pages"] == 8
    assert task["opening_fast_facts_schema"]["additionalProperties"] is False
    assert task["opening_fast_facts_schema"]["properties"]["era"][
        "additionalProperties"
    ] is False
    assert task["module_init_l0_schema"]["secrecy"] == "keeper_only"
    assert task["module_init_l0_schema"]["additional_properties_allowed"] is True


def _splice_page(pdf_index, body):
    return {
        "pdf_index": pdf_index,
        "markdown_path": f"pages/{pdf_index:04d}.md",
        "text_sha256": hashlib.sha256(body.encode("utf-8")).hexdigest(),
        "review_state": "manual_accepted",
        "parse_confidence": 0.9,
        "grep_anchors": ["accepted", "bound"],
    }


_RETAINED_BODY = "# Retained page\n"
_PRODUCED_BODY = "# New page\n"
_RETAINED_PAGE = _splice_page(0, _RETAINED_BODY)
_PRODUCED_PAGE = _splice_page(1, _PRODUCED_BODY)


def _splice_task(tmp_path, producer_pages, retained_pages=(_RETAINED_PAGE,)):
    bundle_root = tmp_path / "reviewed"
    (bundle_root / "pages").mkdir(parents=True, exist_ok=True)
    for row, body in (
        (_RETAINED_PAGE, _RETAINED_BODY), (_PRODUCED_PAGE, _PRODUCED_BODY),
    ):
        (bundle_root / row["markdown_path"]).write_text(body, encoding="utf-8")
    for row in retained_pages:
        target = bundle_root / row["markdown_path"]
        if not target.is_file():
            target.write_text(_RETAINED_BODY, encoding="utf-8")
    (bundle_root / "manifest.json").write_text(
        json.dumps({
            "schema_version": 1,
            "producer": "codex-pdf-skill",
            "source": {"source_id": "pdf:scenario-a"},
            "pages": list(producer_pages),
        }, ensure_ascii=False),
        encoding="utf-8",
    )
    return {
        "source_bundle_path": str(bundle_root),
        "reusable_bound_source": {
            "manifest": {"pages": [dict(row) for row in retained_pages]},
            "normalized_pages": [],
        },
    }


@pytest.mark.parametrize(
    "echoed_page",
    [
        # Byte-for-byte echo is not a capability a producer has. Each of these
        # re-serializations of the retained page-0 row used to fail the whole
        # opening review with "reusable bound page 0 drift".
        {**_RETAINED_PAGE, "assets": []},
        {**_RETAINED_PAGE, "grep_anchors": ["bound", "accepted"]},
        {**_RETAINED_PAGE, "parse_confidence": 0.91},
        {**_RETAINED_PAGE, "markdown_path": "pages/retranscribed.md"},
        {"markdown_path": "pages/0000.md", "pdf_index": 0},
    ],
)
def test_opening_manifest_splices_retained_row_over_producer_echo(
    tmp_path, echoed_page,
):
    """The repository owns the retained rows; whatever the producer wrote for
    an already-bound page is replaced, never compared."""
    adapter = _load_pdf_adapter("coc_pdf_adapter_splice_echo_test")
    task = _splice_task(tmp_path, [echoed_page, _PRODUCED_PAGE])
    manifest = adapter._splice_retained_bound_pages(task, [0, 1], [0])
    assert manifest["pages"] == [_RETAINED_PAGE, _PRODUCED_PAGE]
    on_disk = json.loads(
        (tmp_path / "reviewed" / "manifest.json").read_text(encoding="utf-8"),
    )
    assert on_disk["pages"] == [_RETAINED_PAGE, _PRODUCED_PAGE]
    assert on_disk["source"] == {"source_id": "pdf:scenario-a"}


def test_opening_manifest_splice_needs_no_row_for_a_retained_page(tmp_path):
    """A producer that omits the retained rows entirely is correct now."""
    adapter = _load_pdf_adapter("coc_pdf_adapter_splice_omitted_test")
    task = _splice_task(tmp_path, [_PRODUCED_PAGE])
    manifest = adapter._splice_retained_bound_pages(task, [0, 1], [])
    assert manifest["pages"] == [_RETAINED_PAGE, _PRODUCED_PAGE]


def test_opening_manifest_splice_drops_unselected_preseed_rows(tmp_path):
    adapter = _load_pdf_adapter("coc_pdf_adapter_splice_unselected_test")
    other = {**_RETAINED_PAGE, "pdf_index": 5, "markdown_path": "pages/0005.md"}
    task = _splice_task(
        tmp_path, [_PRODUCED_PAGE], retained_pages=(_RETAINED_PAGE, other),
    )
    manifest = adapter._splice_retained_bound_pages(task, [1], [])
    assert manifest["pages"] == [_PRODUCED_PAGE]


def test_opening_manifest_splice_rejects_a_missing_produced_page(tmp_path):
    adapter = _load_pdf_adapter("coc_pdf_adapter_splice_missing_test")
    task = _splice_task(tmp_path, [_PRODUCED_PAGE])
    with pytest.raises(RuntimeError, match="missing page 4"):
        adapter._splice_retained_bound_pages(task, [1, 4], [])


def test_opening_manifest_splice_rejects_a_rewritten_retained_page(tmp_path):
    """Splicing the row must not launder an edited retained page."""
    adapter = _load_pdf_adapter("coc_pdf_adapter_splice_rewritten_test")
    task = _splice_task(tmp_path, [_PRODUCED_PAGE])
    (tmp_path / "reviewed" / _RETAINED_PAGE["markdown_path"]).write_text(
        "# Retranscribed\n", encoding="utf-8",
    )
    with pytest.raises(RuntimeError, match="reusable bound page 0 was modified"):
        adapter._splice_retained_bound_pages(task, [0, 1], [])


def test_opening_manifest_splice_rejects_duplicate_producer_indices(tmp_path):
    adapter = _load_pdf_adapter("coc_pdf_adapter_splice_duplicate_test")
    task = _splice_task(tmp_path, [_PRODUCED_PAGE, dict(_PRODUCED_PAGE)])
    with pytest.raises(RuntimeError, match="opening source manifest pages"):
        adapter._splice_retained_bound_pages(task, [1], [])


_PLAYTEST_ORIGINAL_ANCHORS = [
    "CALL OF CTHULHU", "23134", "RIPPLES FROM CARCOSA",
    "THREE SCENARIOS EXPLORING HASTUR, CARCOSA, & THE KING IN YELLOW",
    "OSCAR RIOS",
]
_PLAYTEST_CACHE_SORTED_ANCHORS = [
    "23134", "CALL OF CTHULHU", "OSCAR RIOS",
    "RIPPLES FROM CARCOSA",
    "THREE SCENARIOS EXPLORING HASTUR, CARCOSA, & THE KING IN YELLOW",
]


def _reuse_page(anchors):
    return {
        "pdf_index": 0,
        "markdown_path": "pages/0000.md",
        "text_sha256": "a" * 64,
        "review_state": "manual_accepted",
        "parse_confidence": 0.93,
        "grep_anchors": anchors,
    }


def _reuse_task(adapter, retained_raw, retained_normalized):
    return {
        "reusable_bound_source": {
            "manifest": {"pages": [retained_raw]},
            "normalized_pages": [retained_normalized],
        },
    }


def _assert_no_reuse_drift(adapter, page, task):
    adapter._validate_reused_bound_pages({"pages": [page]}, task)


@pytest.mark.parametrize(
    "retained_anchors,final_anchors",
    [
        (_PLAYTEST_ORIGINAL_ANCHORS, _PLAYTEST_CACHE_SORTED_ANCHORS),
        (_PLAYTEST_CACHE_SORTED_ANCHORS, _PLAYTEST_ORIGINAL_ANCHORS),
        (["b", "a", "c"], ["a", "b", "c"]),
        (["anchor", "anchor"], ["anchor"]),
    ],
)
def test_reused_page_accepts_grep_anchor_order_shuffle(
    retained_anchors, final_anchors,
):
    """grep_anchors are set-semantic; ordering/duplicate spelling must not
    trigger transport drift, matching the bundle identity digest and the
    module cache canonical form sorted(set(...))."""
    adapter = _load_pdf_adapter("coc_pdf_adapter_anchor_shuffle_test")
    retained = _reuse_page(retained_anchors)
    final = _reuse_page(final_anchors)
    task = _reuse_task(
        adapter, retained, adapter._reusable_page_row(retained),
    )
    _assert_no_reuse_drift(adapter, final, task)
    # Both orientations of the final manifest are accepted.
    task = _reuse_task(
        adapter, final, adapter._reusable_page_row(final),
    )
    _assert_no_reuse_drift(adapter, retained, task)


@pytest.mark.parametrize(
    "final_anchors",
    [
        ["a", "c"],
        ["a"],
        ["a", "b", "c"],
        ["a", "a", "c"],
    ],
)
def test_reused_page_rejects_grep_anchor_membership_drift(final_anchors):
    """A genuinely different anchor set is real drift and must be rejected;
    ordering normalization must not mask membership changes."""
    adapter = _load_pdf_adapter("coc_pdf_adapter_anchor_membership_drift_test")
    retained = _reuse_page(["a", "b"])
    final = _reuse_page(final_anchors)
    task = _reuse_task(
        adapter, retained, adapter._reusable_page_row(retained),
    )
    with pytest.raises(RuntimeError, match="reusable bound page 0 drift"):
        _assert_no_reuse_drift(adapter, final, task)


def test_reused_page_accepts_play08_sample_replay():
    """Replay the .tmp/pi-coc-full-20260802 evidence: first bundle keeps
    original anchor order while the reviewed bundle copied the module-cache
    sorted rows; the transport must accept the reuse."""
    adapter = _load_pdf_adapter("coc_pdf_adapter_play08_replay_test")
    first_bundle = _reuse_page(_PLAYTEST_ORIGINAL_ANCHORS)
    reviewed_bundle = _reuse_page(_PLAYTEST_CACHE_SORTED_ANCHORS)
    task = _reuse_task(
        adapter, first_bundle, adapter._reusable_page_row(first_bundle),
    )
    _assert_no_reuse_drift(adapter, reviewed_bundle, task)


def test_secrets_example_contains_key_name_only():
    assert (PLUGIN / "pi/secrets.env.example").read_text(encoding="utf-8") == "BAIDUOCR_TOKEN=\n"


def test_clean_packed_package_loads_runtime_mcp_and_compiler_resolution(tmp_path: Path):
    pack_dir = tmp_path / "pack"
    pack_dir.mkdir()
    packed = subprocess.run(
        ["npm", "pack", "--json", "--pack-destination", str(pack_dir)],
        cwd=ROOT, check=True, capture_output=True, text=True,
    )
    filename = json.loads(packed.stdout)[0]["filename"]
    archive = pack_dir / filename
    unpack = tmp_path / "unpack"
    unpack.mkdir()
    with tarfile.open(archive, "r:gz") as tar:
        tar.extractall(unpack, filter="data")
    package = unpack / "package"
    campaign = tmp_path / "campaign"
    campaign.mkdir()
    uv_path = shutil.which("uv")
    assert uv_path is not None
    shim_dir = tmp_path / "shim"
    shim_dir.mkdir()
    uv_args_path = tmp_path / "uv-args.txt"
    uv_shim = shim_dir / "uv"
    uv_shim.write_text(
        "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$COC_PI_UV_ARGS\"\nexec "
        + shlex.quote(uv_path) + " \"$@\"\n",
        encoding="utf-8",
    )
    uv_shim.chmod(0o700)
    packed_env = dict(os.environ)
    packed_env["PATH"] = str(shim_dir) + os.pathsep + packed_env.get("PATH", "")
    packed_env["COC_PI_UV_ARGS"] = str(uv_args_path)
    smoke = _node(
        ROOT / "tests/pi/packed-smoke.mjs", str(package), str(campaign),
        env=packed_env,
    )
    assert "coc_capabilities" in smoke["tools"]
    assert "coc-main" in smoke["skills"]
    assert Path(smoke["runtimeRoot"]) == package / "runtime"
    assert smoke["gateway"] == {"ok": True, "host": "pi"}
    assert uv_args_path.read_text(encoding="utf-8").splitlines()[:4] == [
        "run", "--project", str(package), "--frozen",
    ]

    env = dict(os.environ)
    env.update({"COC_RUNTIME_ROOT": str(package / "runtime"), "COC_PROJECT_ROOT": str(campaign), "COC_HOST": "pi"})
    hydration = package / "plugins/coc-keeper/scripts/coc_scenario_hydration.py"
    code = (
        "import importlib.util, pathlib; "
        f"p=pathlib.Path({str(hydration)!r}); "
        "s=importlib.util.spec_from_file_location('packed_hydration',p); "
        "m=importlib.util.module_from_spec(s); s.loader.exec_module(m); "
        "assert m.COMPILER_ADAPTER_PATH.is_file(); print(m.COMPILER_ADAPTER_PATH)"
    )
    resolved = subprocess.run(
        ["uv", "run", "--frozen", "python", "-c", code],
        cwd=ROOT, env=env, check=True, capture_output=True, text=True,
    )
    assert str(package / "runtime/adapters/compiler/adapter.py") in resolved.stdout

    handshake = subprocess.run(
        [str(package / "plugins/coc-keeper/mcp/launch")],
        cwd=campaign, env=env,
        input='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05"}}\n',
        check=True, capture_output=True, text=True, timeout=30,
    )
    assert json.loads(handshake.stdout)["result"]["serverInfo"]["name"] == "coc-keeper"
