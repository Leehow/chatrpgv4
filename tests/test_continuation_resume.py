"""Durable per-turn continuation and host-context recovery contracts."""
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
PLUGIN = ROOT / "plugins" / "coc-keeper"
SCRIPTS = PLUGIN / "scripts"
HOOK = PLUGIN / "hooks" / "coc_context_hook.py"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import coc_continuation
import coc_host_context
import coc_starter
import coc_toolbox


def test_canonical_projection_carries_authoritative_backend_clock(
    tmp_path: Path,
) -> None:
    campaign = tmp_path / "campaign"
    _write_json(campaign / "save" / "time-state.json", {
        "schema_version": 1,
        "clock": {
            "elapsed_minutes": 271,
            "calendar_mode": "relative",
            "day_phase_hint": "afternoon",
            "appearance_mode": "perpetual_daylight",
        },
    })
    projection = coc_continuation._canonical_projection(
        campaign, revision_vector=None, revision_token=None,
    )
    assert projection["time"]["elapsed_minutes"] == 271
    assert projection["time"]["day_phase_hint"] == "afternoon"
    assert projection["time"]["appearance_mode"] == "perpetual_daylight"


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def _workspace(tmp_path: Path, campaign_id: str) -> dict[str, object]:
    workspace = tmp_path / "workspace"
    coc_root = workspace / ".coc"
    _write_json(
        coc_root / "runtime.json",
        {
            "schema_version": 2,
            "planner": {"kind": "deterministic"},
            "rules": {"kind": "deterministic"},
            "narrator": {"kind": "template"},
            "player": {"kind": "human"},
        },
    )
    quick = coc_starter.quick_start(
        coc_root,
        "the-haunting",
        "thomas-hayes",
        campaign_id=campaign_id,
        title="Continuation Contract",
    )
    return {
        "workspace": workspace,
        "campaign_id": campaign_id,
        "campaign_dir": Path(quick["campaign_dir"]),
        "investigator_id": str(quick["investigator_id"]),
    }


def _call(ws: dict[str, object], tool: str, args: dict | None = None) -> dict:
    result = coc_toolbox.run_tool(
        tool,
        Path(ws["workspace"]),
        str(ws["campaign_id"]),
        dict(args or {}),
    )
    assert result["ok"] is True, result
    return result


def _journal(
    ws: dict[str, object],
    *,
    decision_id: str,
    player_text: str,
    continuation: dict | None = None,
) -> dict:
    args = {
        "summary": f"玩家行动已在 {decision_id} 中得到连续回应。",
        "player_action": "按当前场景中的既定方法继续调查",
        "player_text": player_text,
        "player_speaker": "玩家",
        "run_id": "continuation-test-run",
        "intent_class": "investigate",
        "decision_id": decision_id,
    }
    if continuation is not None:
        args["continuation"] = continuation
    return _call(ws, "state.journal", args)


def _finalize(ws: dict[str, object], *, decision_id: str) -> dict:
    output = _call(ws, "turn.output_context")["data"]
    setup = "调查员把刚才声明的方法落实在眼前的场景里。"
    consequence = "环境与在场人物据此给出明确、连续而带有自身立场的回应。"
    draft = setup + "\n\n" + consequence
    coverage = [
        {
            "obligation_id": row["obligation_id"],
            "realization": "fictional_beat",
            "action_realization": "调查员的具体方法已经在场景中发生",
            "response": "场景和相关人物作出了有因果联系的回应",
            "causal_explanation": "回应直接来自本轮已记录的玩家行动",
            "persona_fit": "保持调查员与在场人物既有的身份和立场",
            "player_input_handling": "specific_preserved",
            "exact_excerpt": consequence,
            "exceptional_beat": (
                "特殊结果已经造成与来源行动直接相连的实质改变"
                if row["exceptional_required"]
                else ""
            ),
        }
        for row in output["obligations"]
    ]
    placements = []
    for segment_type, source_key, after in (
        ("public_check", "roll_id", 0),
        ("state_delta", "effect_id", 1),
        ("exceptional_effect", "event_id", 1),
    ):
        rows = output["mechanics_bundle"].get(segment_type) or []
        if rows:
            placements.append({
                "after_paragraph": after,
                "segment_type": segment_type,
                "source_ids": [str(row[source_key]) for row in rows],
            })
    return _call(
        ws,
        "turn.finalize",
        {
            "draft": draft,
            "coverage": coverage,
            "mechanics_placements": placements,
            "decision_id": decision_id,
        },
    )


def test_finalize_publishes_checkpoint_and_player_reply_confirms_delivery(
    tmp_path: Path,
) -> None:
    ws = _workspace(tmp_path, "continuation-finalized")
    _journal(
        ws,
        decision_id="journal-one",
        player_text="我把灯压低，沿着墙根检查那些新鲜划痕。",
        continuation={
            "unresolved_intent": "确认划痕通向哪里，但尚未离开当前房间",
            "open_threads": [{
                "thread_id": "scratch-route",
                "summary": "墙根划痕的去向仍待确认",
                "reason": "本轮只建立了痕迹存在，尚未追到终点",
                "status": "active",
            }],
            "confirmed_decisions": [{
                "decision_id": "keep-lamp-low",
                "summary": "调查员选择压低灯光谨慎检查",
                "reason": "这是玩家明确声明且已经发生的方法",
            }],
            "style_commitments": ["这段阴森调查中保留克制的桌边冷幽默。"],
        },
    )
    finalized = _finalize(ws, decision_id="finalize-one")
    assert finalized["continuation"]["turn_number"] == 1

    checkpoint = coc_continuation.load_latest_checkpoint(
        Path(ws["campaign_dir"])
    )
    assert checkpoint is not None
    assert checkpoint["source"]["finalization_id"] == finalized["data"]["finalization_id"]
    assert checkpoint["semantic_capsule"]["unresolved_intent"].startswith("确认划痕")
    assert checkpoint["semantic_capsule"]["threads"][0]["thread_id"] == "scratch-route"
    assert any("桌边冷幽默" in row for row in checkpoint["semantic_capsule"]["style_commitments"])
    assert [row["role"] for row in checkpoint["transcript_tail"]] == ["player", "keeper"]
    assert all("text" not in row for row in checkpoint["transcript_tail"])
    assert all(row["text_char_count"] > 0 for row in checkpoint["transcript_tail"])
    assert all(row["text_ref"].startswith("logs/table-transcript.jsonl#") for row in checkpoint["transcript_tail"])

    resumed = _call(ws, "session.resume")["data"]
    assert resumed["mode"] == "awaiting_player"
    assert resumed["current_turn"]["meaningful_row_count"] == 0
    assert resumed["delivery"]["status"] == "unconfirmed"
    assert resumed["delivery"]["exact_text"] == finalized["data"]["rendered_text"]
    assert "semantic_capsule" not in resumed["checkpoint"]
    assert "transcript_tail" not in resumed["checkpoint"]
    assert resumed["semantic_capsule"]["threads"][0]["thread_id"] == "scratch-route"
    exact_delivery = _call(ws, "session.delivery_text", {
        "finalization_id": resumed["delivery"]["finalization_id"],
        "rendered_sha256": resumed["delivery"]["rendered_sha256"],
    })
    assert exact_delivery["data"]["exact_text"] == finalized["data"]["rendered_text"]
    wrong_hash = coc_toolbox.run_tool(
        "session.delivery_text",
        Path(ws["workspace"]),
        str(ws["campaign_id"]),
        {
            "finalization_id": resumed["delivery"]["finalization_id"],
            "rendered_sha256": "0" * 64,
        },
    )
    assert wrong_hash["ok"] is False
    assert wrong_hash["error"]["code"] == "delivery_conflict"

    _journal(
        ws,
        decision_id="journal-two",
        player_text="我顺着划痕继续看，但不碰墙上的东西。",
        continuation={
            "clear_unresolved_intent": True,
            "open_threads": [{
                "thread_id": "scratch-route",
                "summary": "划痕去向已在第二轮得到确认",
                "reason": "玩家继续追踪并完成了原先未决目标",
                "status": "resolved",
            }],
        },
    )
    pending_resume = _call(ws, "session.resume")["data"]
    assert pending_resume["mode"] == "pending_finalization"
    assert pending_resume["delivery"]["status"] == "confirmed"
    assert pending_resume["next_operations"] == ["turn.finalize"]
    _finalize(ws, decision_id="finalize-two")
    merged = coc_continuation.load_latest_checkpoint(Path(ws["campaign_dir"]))
    assert merged is not None
    assert merged["semantic_capsule"]["unresolved_intent"] is None
    assert merged["semantic_capsule"]["threads"][0]["status"] == "resolved"


def test_resume_projection_has_a_fixed_total_byte_budget() -> None:
    oversized = {
        "host_input": {"text": "玩家未分类输入" * 6000},
        "host_context": {"before_resume": {"session_id": "budget-host"}},
        "delivery": {
            "finalization_id": "finalization-budget",
            "rendered_sha256": "a" * 64,
            "exact_text": "尚未确认送达的精确台词" * 6000,
        },
        "current_turn": {
            "rows": [{
                "call_index": 1,
                "tool": "actions.advise",
                "ok": True,
                "data": {"large_projection": "候选资料" * 10000},
            }],
        },
        "scene_context": {
            "campaign_id": "budget-campaign",
            "active_scene_id": "budget-scene",
            "scene": {"scene_id": "budget-scene", "title": "预算场景"},
            "party": [],
            "time": {"elapsed_minutes": 0},
            "large_optional_projection": "按需回读" * 10000,
        },
        "semantic_capsule": {
            "recent_summaries": ["旧摘要" * 2000 for _ in range(5)],
        },
        "pending_output_context": {"large_projection": "结算上下文" * 10000},
    }
    bounded = coc_toolbox._bound_session_resume_data(oversized)
    assert coc_toolbox._wire_bytes(bounded) <= coc_toolbox._SESSION_RESUME_DATA_MAX_BYTES
    budget = bounded["resume_budget"]
    assert budget["max_data_bytes"] == 40 * 1024
    assert budget["canonical_sources_unchanged"] is True
    assert "delivery_text_to_typed_read" in budget["reductions"]
    assert bounded["delivery"]["exact_text"] is None
    assert bounded["delivery"]["replay_operation"]["operation"] == "session.delivery_text"


def test_resume_repairs_missing_compiled_archive_once_per_context(
    tmp_path: Path,
) -> None:
    ws = _workspace(tmp_path, "continuation-archive-repair")
    archive_dir = (
        Path(ws["campaign_dir"])
        / "save"
        / coc_toolbox.coc_compiled_archive.ARCHIVE_DIRNAME
    )
    shutil.rmtree(archive_dir)

    resumed = _call(ws, "session.resume")
    recovery = resumed["data"]["compiled_archive_recovery"]
    assert recovery["status"] == "published"
    assert recovery["canonical_sources_unchanged"] is True
    assert resumed["data"]["scene_context"]["compiled_archive"]["source"] == "compiled_archive"
    again = _call(ws, "session.resume")
    assert again["data"]["compiled_archive_recovery"]["status"] == "reused"


def test_checkpoint_cache_keeps_a_bounded_rebuildable_ring(tmp_path: Path) -> None:
    ws = _workspace(tmp_path, "continuation-ring")
    total_turns = coc_continuation.CHECKPOINT_RETENTION + 3
    for turn in range(1, total_turns + 1):
        _journal(
            ws,
            decision_id=f"ring-journal-{turn}",
            player_text=f"第 {turn} 轮，我继续沿当前线索推进。",
        )
        _finalize(ws, decision_id=f"ring-finalize-{turn}")

    checkpoint_dir = (
        Path(ws["campaign_dir"]) / coc_continuation.CHECKPOINT_DIR
    )
    checkpoints = sorted(checkpoint_dir.glob("turn-*.json"))
    assert len(checkpoints) == coc_continuation.CHECKPOINT_RETENTION
    latest = coc_continuation.load_latest_checkpoint(Path(ws["campaign_dir"]))
    assert latest is not None
    assert latest["turn_number"] == total_turns
    assert any(
        latest["checkpoint_id"] in path.read_text(encoding="utf-8")
        for path in checkpoints
    )


def test_resume_recovers_successful_open_turn_receipt_without_reroll(
    tmp_path: Path,
) -> None:
    ws = _workspace(tmp_path, "continuation-open-turn")
    first = _call(
        ws,
        "rules.roll",
        {
            "investigator": ws["investigator_id"],
            "skill": "Library Use",
            "difficulty": "regular",
            "goal": "从目录中找到房屋旧档案",
            "stakes": {
                "on_success": "找到对应卷宗",
                "on_failure": "暂时找不到卷宗",
            },
            "difficulty_basis": "keeper_judgment",
            "seed": 11,
            "decision_id": "open-turn-roll",
        },
    )
    resumed = _call(ws, "session.resume")["data"]
    assert resumed["mode"] == "open_turn_recovery"
    roll_rows = [
        row for row in resumed["current_turn"]["rows"]
        if row["tool"] == "rules.roll" and row["ok"] is True
    ]
    assert len(roll_rows) == 1
    assert roll_rows[0]["data"]["roll_id"] == first["data"]["roll_id"]
    assert roll_rows[0]["data"]["roll"] == first["data"]["roll"]

    again = _call(ws, "session.resume")["data"]
    again_rows = [
        row for row in again["current_turn"]["rows"]
        if row["tool"] == "rules.roll"
    ]
    assert len(again_rows) == 1
    assert again_rows[0]["data"]["roll_id"] == first["data"]["roll_id"]
    assert again["current_turn"]["operational_row_count"] >= 1


def test_invalid_checkpoint_is_rebuilt_from_immutable_finalization(
    tmp_path: Path,
) -> None:
    ws = _workspace(tmp_path, "continuation-rebuild")
    _journal(
        ws,
        decision_id="journal-rebuild",
        player_text="我先确认门缝里有没有光。",
        continuation={
            "open_threads": [{
                "thread_id": "door-light",
                "summary": "门缝后的光源仍未确认",
                "reason": "本轮只观察到光，没有打开门",
                "status": "active",
            }],
        },
    )
    finalized = _finalize(ws, decision_id="finalize-rebuild")
    campaign_dir = Path(ws["campaign_dir"])
    finalization_path = campaign_dir / "logs" / "turn-finalizations.jsonl"
    immutable_before = finalization_path.read_bytes()
    pointer = json.loads(
        (campaign_dir / "save" / "continuation" / "latest.json").read_text(
            encoding="utf-8"
        )
    )
    checkpoint_path = campaign_dir / pointer["checkpoint_path"]
    broken = json.loads(checkpoint_path.read_text(encoding="utf-8"))
    broken["status"] = "broken-cache-only"
    _write_json(checkpoint_path, broken)

    resumed = _call(ws, "session.resume")
    assert any(
        "ignored invalid continuation cache" in warning
        for warning in resumed["warnings"]
    )
    rebuilt = resumed["data"]["checkpoint"]
    assert rebuilt["status"] == "awaiting_player"
    assert rebuilt["source"]["finalization_id"] == finalized["data"]["finalization_id"]
    assert resumed["data"]["semantic_capsule"]["threads"][0]["thread_id"] == "door-light"
    assert finalization_path.read_bytes() == immutable_before


def test_host_epoch_advises_resume_and_preserves_unclassified_input(
    tmp_path: Path,
) -> None:
    ws = _workspace(tmp_path, "continuation-host-epoch")
    workspace = Path(ws["workspace"])
    session_id = "grok-session-continuation-test"
    marker = coc_host_context.mark_lifecycle(
        workspace,
        session_id=session_id,
        host="grok",
        event="session_start",
        source="startup",
    )
    duplicate_start = coc_host_context.mark_lifecycle(
        workspace,
        session_id=session_id,
        host="grok",
        event="session_start",
        source="global-fallback-duplicate",
    )
    assert duplicate_start["context_epoch"] == marker["context_epoch"]
    assert coc_host_context.record_prompt(
        workspace, session_id=session_id, text="还没绑定战役的输入"
    ) is None

    advised = coc_toolbox.run_tool(
        "scene.context", workspace, str(ws["campaign_id"]), {}
    )
    assert advised["ok"] is True
    assert advised["context_rehydration"]["hard_gate"] is False
    assert advised["context_rehydration"]["next_operation"] == "session.resume"

    resumed = _call(
        ws,
        "session.resume",
        {
            "host_session_id": session_id,
            "context_epoch": marker["context_epoch"],
        },
    )
    assert resumed["data"]["host_context"]["acknowledged"]["requires_resume"] is False
    # Grok commonly repeats only the investigator argument after the lifecycle
    # hook already bound this process.  The runtime marker must still make that
    # voluntary repeat a cheap no-op.
    repeated = _call(ws, "session.resume")
    assert repeated["data"]["mode"] == "already_acknowledged"
    assert repeated["data"]["reuse_existing_working_set"] is True
    assert repeated["data"]["next_operations"] == [
        "continue_from_existing_working_set"
    ]
    assert "compiled_archive_recovery" not in repeated["data"]
    assert coc_toolbox._wire_bytes(repeated["data"]) < coc_toolbox._wire_bytes(
        resumed["data"]
    )
    assert _call(ws, "scene.context")["ok"] is True

    exact_input = "压缩发生前：我想先听门后动静，而不是立刻开门。"
    saved_input = coc_host_context.record_prompt(
        workspace, session_id=session_id, text=exact_input
    )
    assert saved_input is not None and saved_input["text"] == exact_input
    compacted = coc_host_context.mark_lifecycle(
        workspace,
        session_id=session_id,
        host="grok",
        event="pre_compact",
        source="auto",
    )
    duplicate_pre_compact = coc_host_context.mark_lifecycle(
        workspace,
        session_id=session_id,
        host="grok",
        event="pre_compact",
        source="global-fallback-duplicate",
    )
    assert duplicate_pre_compact["context_epoch"] == compacted["context_epoch"]
    advised_again = coc_toolbox.run_tool(
        "scene.context", workspace, str(ws["campaign_id"]), {}
    )
    assert advised_again["ok"] is True
    assert advised_again["context_rehydration"]["context_epoch"] == compacted["context_epoch"]
    stale = coc_toolbox.run_tool(
        "session.resume",
        workspace,
        str(ws["campaign_id"]),
        {"host_session_id": session_id, "context_epoch": marker["context_epoch"]},
    )
    assert stale["ok"] is False
    assert stale["error"]["code"] == "context_epoch_conflict"
    recovered = _call(
        ws,
        "session.resume",
        {
            "host_session_id": session_id,
            "context_epoch": compacted["context_epoch"],
        },
    )["data"]
    assert recovered["host_input"]["text"] == exact_input
    assert recovered["host_input"]["disposition"] == "uncommitted_unclassified"


def _run_hook(
    workspace: Path,
    *,
    event: str,
    payload: dict[str, object],
    session_id: str = "hook-test-session",
) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env.update({
        "COC_HOOK_EVENT": event,
        "GROK_SESSION_ID": session_id,
        "GROK_WORKSPACE_ROOT": os.fspath(workspace),
        "GROK_PLUGIN_ROOT": os.fspath(PLUGIN),
    })
    return subprocess.run(
        [sys.executable, os.fspath(HOOK)],
        input=json.dumps(payload, ensure_ascii=False),
        text=True,
        capture_output=True,
        check=False,
        env=env,
        cwd=workspace,
        timeout=15,
    )


def test_plugin_hook_binds_resume_and_denies_only_bypass_writes(
    tmp_path: Path,
) -> None:
    workspace = tmp_path / "hook-workspace"
    (workspace / ".coc").mkdir(parents=True)
    started = _run_hook(
        workspace,
        event="session_start",
        payload={
            "hookEventName": "session_start",
            "sessionId": "hook-test-session",
            "workspaceRoot": os.fspath(workspace),
            "source": "startup",
        },
    )
    assert started.returncode == 0, started.stderr
    marker = coc_host_context.pending_marker(
        workspace, session_id="hook-test-session"
    )
    assert marker is not None and marker["requires_resume"] is True

    advised_mcp = _run_hook(
        workspace,
        event="pre_tool_use",
        payload={
            "hookEventName": "pre_tool_use",
            "sessionId": "hook-test-session",
            "workspaceRoot": os.fspath(workspace),
            "toolName": "coc-keeper__rules_roll",
            "toolInput": {"campaign": "x"},
        },
    )
    advised_payload = json.loads(advised_mcp.stdout)
    assert advised_payload["decision"] == "allow"
    assert "session.resume" in advised_payload["hookSpecificOutput"]["additionalContext"]

    allowed_resume = _run_hook(
        workspace,
        event="pre_tool_use",
        payload={
            "hookEventName": "pre_tool_use",
            "sessionId": "hook-test-session",
            "workspaceRoot": os.fspath(workspace),
            "toolName": "coc-keeper__session_resume",
            "toolInput": {"campaign": "x"},
        },
    )
    resume_payload = json.loads(allowed_resume.stdout)
    assert resume_payload["decision"] == "allow"
    assert resume_payload["hookSpecificOutput"]["updatedInput"] == {
        "campaign": "x",
        "host_session_id": "hook-test-session",
        "context_epoch": marker["context_epoch"],
    }

    allowed_invoke_resume = _run_hook(
        workspace,
        event="pre_tool_use",
        payload={
            "hookEventName": "pre_tool_use",
            "sessionId": "hook-test-session",
            "workspaceRoot": os.fspath(workspace),
            "toolName": "coc-keeper__coc_invoke",
            "toolInput": {
                "campaign": "x",
                "operation": "session.resume",
                "arguments": {"investigator": "inv-test"},
            },
        },
    )
    invoke_input = json.loads(allowed_invoke_resume.stdout)[
        "hookSpecificOutput"
    ]["updatedInput"]
    assert invoke_input["arguments"]["investigator"] == "inv-test"
    assert invoke_input["arguments"]["host_session_id"] == "hook-test-session"
    assert invoke_input["arguments"]["context_epoch"] == marker["context_epoch"]

    denied_edit = _run_hook(
        workspace,
        event="pre_tool_use",
        payload={
            "hookEventName": "pre_tool_use",
            "sessionId": "hook-test-session",
            "workspaceRoot": os.fspath(workspace),
            "toolName": "search_replace",
            "toolInput": {
                "file_path": os.fspath(workspace / ".coc" / "campaigns" / "x" / "save" / "world-state.json"),
                "old_string": "old",
                "new_string": "new",
            },
        },
    )
    assert json.loads(denied_edit.stdout)["decision"] == "deny"

    allowed_source_read = _run_hook(
        workspace,
        event="pre_tool_use",
        payload={
            "hookEventName": "pre_tool_use",
            "sessionId": "hook-test-session",
            "workspaceRoot": os.fspath(workspace),
            "toolName": "read_file",
            "toolInput": {"file_path": os.fspath(workspace / "src" / "app.py")},
        },
    )
    assert json.loads(allowed_source_read.stdout)["decision"] == "allow"


def _run_kimi_hook(
    workspace: Path,
    *,
    payload: dict[str, object],
    session_id: str = "kimi-hook-test-session",
) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    for stale in (
        "COC_HOOK_EVENT", "GROK_HOOK_EVENT", "GROK_SESSION_ID",
        "GROK_PLUGIN_ROOT", "GROK_WORKSPACE_ROOT", "CODEX_SESSION_ID",
        "PLUGIN_ROOT", "CLAUDE_SESSION_ID", "CLAUDE_PLUGIN_ROOT",
        "CLAUDE_PROJECT_DIR",
    ):
        env.pop(stale, None)
    env.update({
        "KIMI_PLUGIN_ROOT": os.fspath(PLUGIN),
        "KIMI_CODE_HOME": os.fspath(workspace / ".kimi-home"),
    })
    return subprocess.run(
        [sys.executable, os.fspath(HOOK)],
        input=json.dumps(payload, ensure_ascii=False),
        text=True,
        capture_output=True,
        check=False,
        env=env,
        cwd=workspace,
        timeout=15,
    )


def test_kimi_hook_payload_marks_lifecycle_and_keeps_resume_advisory_silent(
    tmp_path: Path,
) -> None:
    ws = _workspace(tmp_path, "kimi-hook-continuation")
    workspace = Path(ws["workspace"])
    campaign_id = str(ws["campaign_id"])
    session_id = "kimi-hook-test-session"

    started = _run_kimi_hook(
        workspace,
        payload={
            "hook_event_name": "SessionStart",
            "session_id": session_id,
            "cwd": os.fspath(workspace),
        },
    )
    assert started.returncode == 0, started.stderr
    marker = coc_host_context.pending_marker(workspace, session_id=session_id)
    assert marker is not None and marker["requires_resume"] is True
    assert marker["host"] == "kimi"

    advised = coc_toolbox.run_tool("scene.context", workspace, campaign_id, {})
    assert advised["ok"] is True
    assert advised["context_rehydration"]["hard_gate"] is False

    advised_gateway = _run_kimi_hook(
        workspace,
        payload={
            "hook_event_name": "PreToolUse",
            "session_id": session_id,
            "cwd": os.fspath(workspace),
            "tool_name": "mcp__coc-keeper__scene.context",
            "tool_input": {"campaign": campaign_id},
        },
    )
    assert advised_gateway.stdout.strip() == ""

    allowed_resume = _run_kimi_hook(
        workspace,
        payload={
            "hook_event_name": "PreToolUse",
            "session_id": session_id,
            "cwd": os.fspath(workspace),
            "tool_name": "mcp__coc-keeper__session.resume",
            "tool_input": {"campaign": campaign_id},
        },
    )
    assert allowed_resume.returncode == 0, allowed_resume.stderr
    assert allowed_resume.stdout.strip() == ""

    resumed = _call(
        ws,
        "session.resume",
        {
            "host_session_id": session_id,
            "context_epoch": marker["context_epoch"],
        },
    )
    assert resumed["data"]["host_context"]["acknowledged"]["requires_resume"] is False

    recorded = _run_kimi_hook(
        workspace,
        payload={
            "hook_event_name": "UserPromptSubmit",
            "session_id": session_id,
            "cwd": os.fspath(workspace),
            "prompt": "压缩前：我先检查书桌抽屉。",
        },
    )
    assert recorded.returncode == 0, recorded.stderr
    retained = coc_host_context.latest_unclassified_input(
        workspace, campaign_id=campaign_id, session_id=session_id
    )
    assert retained is not None
    assert retained["text"] == "压缩前：我先检查书桌抽屉。"

    denied_edit = _run_kimi_hook(
        workspace,
        payload={
            "hook_event_name": "PreToolUse",
            "session_id": session_id,
            "cwd": os.fspath(workspace),
            "tool_name": "Edit",
            "tool_input": {
                "path": os.fspath(
                    workspace / ".coc" / "campaigns" / "x" / "save" / "world-state.json"
                ),
            },
        },
    )
    deny_edit = json.loads(denied_edit.stdout)
    assert deny_edit["hookSpecificOutput"]["permissionDecision"] == "deny"
