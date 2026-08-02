from __future__ import annotations

import importlib.util
import hashlib
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
        ),
        encoding="utf-8",
    )
    fake_pi.chmod(0o755)
    return agent_dir, fake_bin


def _run_pi_coc(
    tmp_path: Path,
    *,
    settings: dict,
    models: dict,
    args: list[str],
    new: bool = True,
    extra_env: dict[str, str] | None = None,
) -> tuple[subprocess.CompletedProcess[str], Path]:
    agent_dir, fake_bin = _pi_coc_test_home(
        tmp_path, settings=settings, models=models,
    )
    args_path = tmp_path / "pi-args.txt"
    env = {
        **os.environ,
        "PATH": f"{fake_bin}{os.pathsep}{os.environ['PATH']}",
        "PI_COC_AGENT_DIR": str(agent_dir),
        "PI_COC_TEST_ARGS": str(args_path),
        "PI_COC_TEST_CAMPAIGN": str(tmp_path / "campaign-id.txt"),
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


def test_pi_auto_dispatch_uses_named_paths_and_bounded_pending_queues():
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
    assert pi["max_source_coordinator_leaves"] == 4
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
            "timeout_and_abort_remain_retryable": True,
            "exact_hidden_facts_card": True,
            "misaligned_state_still_delivers_reviewed_adopt_card": True,
            "misaligned_state_keeps_real_failure_class": True,
            "no_raw_source_leakage": True,
        },
    }


def test_pdf_skill_adapter_reaps_term_resistant_pi_process_group(
    tmp_path: Path,
):
    started = tmp_path / "pi-started"
    child_pid_path = tmp_path / "child-pid"
    survivor = tmp_path / "descendant-survived"
    fake_pi = tmp_path / "fake-pi"
    child_code = (
        "import os,signal,time,pathlib;"
        "signal.signal(signal.SIGTERM,signal.SIG_IGN);"
        f"pathlib.Path({str(child_pid_path)!r}).write_text(str(os.getpid()));"
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
signal.signal(signal.SIGTERM, signal.SIG_IGN)
subprocess.Popen([sys.executable, "-c", {child_code!r}])
Path({str(started)!r}).write_text(str(os.getpid()))
time.sleep(10)
""",
        encoding="utf-8",
    )
    fake_pi.chmod(0o755)
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    task = {
        "schema_version": 1,
        "contract_id": "coc.pi-source-scope-locator-task.v1",
        "adapter_mode": "pi_external_pdf_skill_lifecycle",
        "model_policy": "pinned_xai_grok_4_5_thinking_low",
        "max_selected_pages": 3,
        "workspace_root": str(workspace),
        "asset_root_id": "adapter-termination",
        "job_id": "job-adapter-termination",
        "kind": "location",
        "target_id": "archive",
        "target_label": "Archive",
        "source_bundle_path": str(
            workspace
            / ".tmp"
            / "coc-source-scope"
            / "camp"
            / "job"
            / "staging"
        ),
        "cached_pdf_indices": [],
        "source": {
            "path": str(tmp_path / "module.pdf"),
            "source_id": "pdf:adapter-termination",
            "title": "Adapter Termination",
            "file_sha256": "a" * 64,
        },
    }
    env = {
        **os.environ,
        "COC_PI_COMMAND": str(fake_pi),
    }
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
    process.send_signal(signal.SIGTERM)
    assert process.wait(timeout=5) != 0
    time.sleep(1.3)
    assert not survivor.exists()
    child_pid = int(child_pid_path.read_text(encoding="utf-8"))
    with pytest.raises(ProcessLookupError):
        os.kill(child_pid, 0)


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

    def fake_run_pi(prompt, cwd, *, timeout, allow_non_json_receipt=False):
        captured["timeout"] = timeout
        captured["allow_non_json_receipt"] = allow_non_json_receipt
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


def test_reused_page_accepts_absent_and_empty_assets_as_equivalent():
    adapter = _load_pdf_adapter("coc_pdf_adapter_empty_assets_reuse_test")
    page = {
        "pdf_index": 0,
        "markdown_path": "pages/0000.md",
        "text_sha256": "a" * 64,
        "review_state": "manual_accepted",
        "parse_confidence": 0.9,
        "grep_anchors": ["accepted"],
    }
    retained = {**page, "assets": []}
    task = {
        "reusable_bound_source": {
            "manifest": {"pages": [retained]},
            "normalized_pages": [adapter._reusable_page_row(page)],
        },
    }
    adapter._validate_reused_bound_pages(
        {"pages": [page]},
        {"pages": [dict(page)]},
        task,
    )


@pytest.mark.parametrize(
    "final_page",
    [
        {
            "pdf_index": 0,
            "markdown_path": "pages/0000.md",
            "text_sha256": "a" * 64,
            "review_state": "manual_accepted",
            "parse_confidence": 0.9,
            "grep_anchors": ["accepted"],
            "assets": [{"path": "assets/map.png", "sha256": "b" * 64}],
        },
        {
            "pdf_index": 0,
            "markdown_path": "pages/changed.md",
            "text_sha256": "a" * 64,
            "review_state": "manual_accepted",
            "parse_confidence": 0.9,
            "grep_anchors": ["accepted"],
        },
    ],
)
def test_reused_page_still_rejects_nonempty_assets_or_other_drift(final_page):
    adapter = _load_pdf_adapter("coc_pdf_adapter_reuse_drift_test")
    page = {
        "pdf_index": 0,
        "markdown_path": "pages/0000.md",
        "text_sha256": "a" * 64,
        "review_state": "manual_accepted",
        "parse_confidence": 0.9,
        "grep_anchors": ["accepted"],
    }
    task = {
        "reusable_bound_source": {
            "manifest": {"pages": [{**page, "assets": []}]},
            "normalized_pages": [adapter._reusable_page_row(page)],
        },
    }
    with pytest.raises(RuntimeError, match="reusable bound page 0 drift"):
        adapter._validate_reused_bound_pages(
            {"pages": [page]},
            {"pages": [final_page]},
            task,
        )


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
    adapter._validate_reused_bound_pages(
        {"pages": [final]},
        {"pages": [dict(final)]},
        task,
    )
    # Both orientations of the final manifest are accepted.
    task = _reuse_task(
        adapter, final, adapter._reusable_page_row(final),
    )
    adapter._validate_reused_bound_pages(
        {"pages": [retained]},
        {"pages": [dict(retained)]},
        task,
    )


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
        adapter._validate_reused_bound_pages(
            {"pages": [final]},
            {"pages": [dict(final)]},
            task,
        )


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
    adapter._validate_reused_bound_pages(
        {"pages": [reviewed_bundle]},
        {"pages": [dict(reviewed_bundle)]},
        task,
    )


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
