from __future__ import annotations

import importlib.util
import hashlib
import json
import os
from pathlib import Path
import signal
import shlex
import shutil
import subprocess
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


def test_real_canonical_briefing_receipt_owns_exact_pi_visible_bytes(
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
        '#!/bin/sh\nfor arg in "$@"; do printf "%s\\n" "$arg"; done > "$PI_COC_TEST_ARGS"\n',
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
    }
    completed = subprocess.run(
        [str(PLUGIN / "pi" / "bin" / "pi-coc"), "--new", *args],
        cwd=ROOT,
        env=env,
        check=False,
        capture_output=True,
        text=True,
    )
    return completed, args_path


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
    assert result["startupInitializedBeforeTrigger"] is True
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


def test_pi_auto_dispatch_uses_named_paths_and_bounded_pending_queues():
    completed = subprocess.run(
        ["node", "--experimental-strip-types", str(ROOT / "tests/pi/auto-dispatch-smoke.mjs"), str(ROOT)],
        cwd=ROOT, check=True, capture_output=True, text=True,
    )
    assert completed.stdout.strip() == "auto-dispatch smoke OK"


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


def test_pi_source_scope_locator_external_lifecycle_is_fail_closed():
    result = _node(
        ROOT / "tests/pi/source-scope-locator-smoke.mjs",
        str(ROOT),
    )
    assert result == {
        "ok": True,
        "checks": {
            "strict_preflight_and_receipt": True,
            "source_title_contract_enforced": True,
            "locate_resolve_replacement_chain": True,
            "duplicate_suppressed": True,
            "stable_bundle_not_overwritten": True,
            "published_unregistered_recovered": True,
            "stale_publish_lock_recovered": True,
            "active_publish_lock_preserved": True,
            "crashed_publish_lock_recovered": True,
            "concurrent_publish_recovery_serialized": True,
            "active_empty_publish_lock_preserved": True,
            "symlink_staging_rejected": True,
            "session_abort_kills_descendants": True,
            "missing_command_no_mutation": True,
            "invalid_handshake_no_mutation": True,
            "invalid_receipt_no_mutation": True,
            "timeout_no_mutation": True,
        },
    }
    pi = json.loads(
        (PLUGIN / "references/host-capabilities.json").read_text(
            encoding="utf-8",
        )
    )["pi"]
    assert pi["coc_source_scope_locator_v1"] is False
    assert pi["coc_source_scope_locator_v1_status"] == (
        "unavailable_dynamic_preflight"
    )
    assert pi["coc_source_scope_locator_v1_adapter"] == (
        "pi_external_pdf_skill_lifecycle"
    )
    assert pi["coc_source_scope_locator_v1_dynamic_gate"] == (
        "absolute_executable_COC_PI_SOURCE_SCOPE_LOCATOR_COMMAND"
    )


def test_pdf_skill_adapter_reaps_term_resistant_codex_process_group(
    tmp_path: Path,
):
    started = tmp_path / "codex-started"
    child_pid_path = tmp_path / "child-pid"
    survivor = tmp_path / "descendant-survived"
    fake_codex = tmp_path / "fake-codex"
    child_code = (
        "import os,signal,time,pathlib;"
        "signal.signal(signal.SIGTERM,signal.SIG_IGN);"
        f"pathlib.Path({str(child_pid_path)!r}).write_text(str(os.getpid()));"
        "time.sleep(1.2);"
        f"pathlib.Path({str(survivor)!r}).write_text('survived')"
    )
    fake_codex.write_text(
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
    fake_codex.chmod(0o755)
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    task = {
        "schema_version": 1,
        "contract_id": "coc.pi-source-scope-locator-task.v1",
        "adapter_mode": "pi_external_pdf_skill_lifecycle",
        "model_policy": "external_codex_cli_configured_default",
        "max_selected_pages": 3,
        "workspace_root": str(workspace),
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
        "source": {
            "path": str(tmp_path / "module.pdf"),
            "source_id": "pdf:adapter-termination",
            "title": "Adapter Termination",
            "file_sha256": "a" * 64,
        },
    }
    env = {
        **os.environ,
        "COC_CODEX_COMMAND": str(fake_codex),
    }
    # This test owns only process-tree termination. The fake Codex never reads
    # the adapter's required external-skill path, so keep the fixture hermetic.
    pdf_skill = tmp_path / "pdf-skill" / "SKILL.md"
    pdf_skill.parent.mkdir()
    pdf_skill.write_text("# process-tree fixture\n", encoding="utf-8")
    env["COC_CODEX_PDF_SKILL"] = str(pdf_skill)
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
