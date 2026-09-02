"""Host-side Pi-Coc debug experiments through the one dispatch interface."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sys
import threading
import time
import subprocess

import pytest


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import coc_git_history  # noqa: E402
MODULE_PATH = (
    ROOT / "plugins" / "coc-keeper" / "pi" / "bin"
    / "pi_coc_debug_experiment.py"
)


def _module():
    spec = importlib.util.spec_from_file_location("pi_coc_debug_experiment", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class CheckpointAdapter:
    def seal_latest(self, context):
        return {
            "campaign_id": context["campaign_id"],
            "timeline_id": "tl-main",
            "turn": 12,
            "commit": "a" * 40,
        }


class ExecutorAdapter:
    def __init__(self):
        self.started = []
        self.cancelled = []

    def start(self, run):
        self.started.append(run["experiment_id"])

    def cancel(self, run):
        self.cancelled.append(run["experiment_id"])


class MaterializingCheckpointAdapter(CheckpointAdapter):
    def __init__(self):
        self.materialized = []

    def materialize(self, checkpoint, lane_workspace):
        lane = Path(lane_workspace)
        lane.mkdir(parents=True)
        self.materialized.append(lane.name)
        return {"workspace_root": str(lane), "commit": checkpoint["commit"]}


class ScriptedLaneAdapter:
    def __init__(self):
        self.active = 0
        self.max_active = 0
        self.lock = threading.Lock()

    def run(self, *, lane, run, materialized, cancelled):
        assert not cancelled()
        with self.lock:
            self.active += 1
            self.max_active = max(self.max_active, self.active)
        time.sleep(0.04)
        with self.lock:
            self.active -= 1
        if lane["id"] == "timeout-case":
            return {
                "status": "timed_out",
                "resume_first": True,
                "duration_ms": 180000,
                "error": {"code": "turn_absolute_budget_exceeded"},
                "events": [],
                "final": {
                    "player_input": lane["player_input"],
                    "rendered_text": None,
                    "finalized": False,
                    "exact_delivery": False,
                },
            }
        live_lane = Path(run["evidence_root"]) / "lanes" / lane["id"]
        live_lane.mkdir(parents=True, exist_ok=True)
        (live_lane / "progress.json").write_text(
            json.dumps({"stage": "turn"}) + "\n", encoding="utf-8",
        )
        return {
            "status": "completed",
            "resume_first": True,
            "duration_ms": 1200,
            "events": [
                {
                    "category": "rules",
                    "operation": "rules.settle",
                    "receipt": {"ok": True, "api_key": "must-not-survive"},
                },
                {"category": "timing", "wall_ms": 1200},
                {"category": "rpc", "raw": "not requested"},
            ],
            "state_diff": {"hp": {"before": 11, "after": 12}},
            "final": {
                "player_input": lane["player_input"],
                "rendered_text": "伤口已重新包扎。",
                "finalized": True,
                "exact_delivery": True,
            },
        }


class BlockingLaneAdapter:
    def __init__(self):
        self.entered = threading.Event()
        self.release = threading.Event()

    def run(self, *, lane, run, materialized, cancelled):
        self.entered.set()
        assert self.release.wait(timeout=2)
        return {
            "status": "completed",
            "resume_first": True,
            "duration_ms": 20,
            "events": [],
            "final": {
                "player_input": lane["player_input"],
                "rendered_text": "完成。",
                "finalized": True,
                "exact_delivery": True,
            },
        }


def _context(tmp_path: Path) -> dict:
    return {
        "workspace_root": str(tmp_path / "workspace"),
        "campaign_id": "haunting-debug-source",
        "role": "play",
        "host_is_idle": True,
        "provider": "xai",
        "model": "grok-4.6",
        "thinking": "low",
        "agent_home": str(tmp_path / "agent-home"),
    }


def _lane_specs(count: int) -> list[dict[str, str]]:
    return [
        {"id": f"lane-{index}", "profile": "production"}
        for index in range(1, count + 1)
    ]


def _settled_workspace(
    tmp_path: Path,
    *,
    tracked_post_finalization_overlays: bool = False,
) -> tuple[Path, str, str]:
    workspace = tmp_path / "settled-workspace"
    campaign_id = "debug-snapshot-source"
    campaign = workspace / ".coc" / "campaigns" / campaign_id
    (campaign / "save").mkdir(parents=True)
    (campaign / "logs").mkdir()
    (workspace / ".coc" / "investigators" / "hero").mkdir(parents=True)
    (workspace / ".coc" / "runtime.json").write_text(
        json.dumps({"schema_version": 2}) + "\n", encoding="utf-8",
    )
    (workspace / ".coc" / "investigators" / "hero" / "character.json").write_text(
        json.dumps({"id": "hero", "skills": {"First Aid": 60}}) + "\n",
        encoding="utf-8",
    )
    (campaign / "campaign.json").write_text(
        json.dumps({"schema_version": 3, "id": campaign_id}) + "\n",
        encoding="utf-8",
    )
    (campaign / "save" / "world-state.json").write_text(
        json.dumps({"schema_version": 2, "turn": 1}) + "\n", encoding="utf-8",
    )
    (campaign / "logs" / "turn-finalizations.jsonl").write_text(
        json.dumps({"finalization_id": "final-debug-turn-1"}) + "\n",
        encoding="utf-8",
    )
    (campaign / "logs" / "toolbox-calls.jsonl").write_text(
        '{"tool":"turn.finalize"}\n', encoding="utf-8",
    )
    coc_git_history.commit_baseline(
        workspace,
        campaign_id,
        schema_generation="campaign-3/world-2/pacing-1/investigator-1",
        note="debug fixture",
    )
    delivery = campaign / "save" / "continuation" / "delivery-receipts.jsonl"
    temporal_paths = [
        campaign / "memory" / "temporal" / name
        for name in ("backlog.jsonl", "episode-evidence.jsonl", "episodes.jsonl")
    ]
    if tracked_post_finalization_overlays:
        delivery.parent.mkdir(parents=True, exist_ok=True)
        delivery.write_text(
            json.dumps({
                "schema_version": 1,
                "kind": "coc_delivery_receipt",
                "campaign_id": campaign_id,
                "finalization_id": "final-debug-prior-turn",
                "rendered_text_sha256": "sha256:" + "0" * 64,
                "status": "confirmed",
                "ack_kind": "displayed",
            }) + "\n",
            encoding="utf-8",
        )
        for path in temporal_paths:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('{"turn":0}\n', encoding="utf-8")
    commit = coc_git_history.commit_finalized_turn(
        workspace,
        campaign_id,
        turn_number=1,
        finalization_id="final-debug-turn-1",
        journal_decision_id="journal-debug-turn-1",
        settlement_snapshot_id="settlement-debug-turn-1",
        rendered_text_sha256="sha256:" + "1" * 64,
        schema_generation="campaign-3/world-2/pacing-1/investigator-1",
    )
    delivery.parent.mkdir(parents=True, exist_ok=True)
    current_delivery = json.dumps({
        "schema_version": 1,
        "kind": "coc_delivery_receipt",
        "campaign_id": campaign_id,
        "finalization_id": "final-debug-turn-1",
        "rendered_text_sha256": "sha256:" + "1" * 64,
        "status": "confirmed",
        "ack_kind": "displayed",
    }) + "\n"
    if tracked_post_finalization_overlays:
        with delivery.open("a", encoding="utf-8") as handle:
            handle.write(current_delivery)
        for path in temporal_paths:
            with path.open("a", encoding="utf-8") as handle:
                handle.write('{"turn":1}\n')
    else:
        delivery.write_text(current_delivery, encoding="utf-8")
    return workspace, campaign_id, commit


def test_dispatch_starts_reads_and_cancels_one_closed_experiment(tmp_path: Path) -> None:
    module = _module()
    executor = ExecutorAdapter()
    experiment = module.DebugExperiment(
        store=module.FileRunStore(tmp_path / "debug-runs"),
        checkpoint=CheckpointAdapter(),
        executor=executor,
    )
    command = """run {
      "player_input":"我检查伤口并更换包扎方法。",
      "lanes":[
        {"id":"production-1","profile":"production"},
        {"id":"changed-method","profile":"rules-all-single-draft","player_input":"我改用夹板固定伤处。"}
      ],
      "record":["rules","director","working_set","timing","state_diff"],
      "concurrency":2,
      "timeout_seconds":180
    }"""

    started = experiment.dispatch(command, _context(tmp_path))
    assert started == {
        "status": "started",
        "experiment_id": "debug-haunting-debug-source-r1",
        "checkpoint": {
            "campaign_id": "haunting-debug-source",
            "timeline_id": "tl-main",
            "turn": 12,
        },
        "lanes": ["production-1", "changed-method"],
    }
    assert executor.started == ["debug-haunting-debug-source-r1"]

    status = experiment.dispatch("status current", _context(tmp_path))
    assert status["status"] == "running"
    assert status["experiment_id"] == "debug-haunting-debug-source-r1"
    assert status["spec"]["record"] == [
        "final", "rules", "director", "working_set", "timing", "state_diff",
    ]
    assert "commit" not in status["checkpoint"]

    cancelled = experiment.dispatch("cancel current", _context(tmp_path))
    assert cancelled["status"] == "cancelling"
    assert executor.cancelled == ["debug-haunting-debug-source-r1"]


@pytest.mark.parametrize(
    "patch",
    [
        '"seed":7,',
        '"unknown":true,',
        '"timeout_seconds":181,',
        '"concurrency":5,',
    ],
)
def test_dispatch_rejects_unsafe_or_unknown_run_fields(
    tmp_path: Path, patch: str,
) -> None:
    module = _module()
    experiment = module.DebugExperiment(
        store=module.FileRunStore(tmp_path / "debug-runs"),
        checkpoint=CheckpointAdapter(),
        executor=ExecutorAdapter(),
    )
    command = (
        "run {"
        + patch
        + '"player_input":"我检查伤口。",'
        + '"lanes":[{"id":"production-1","profile":"production"}],'
        + ('' if '"concurrency"' in patch else '"concurrency":1,')
        + ('' if '"timeout_seconds"' in patch else '"timeout_seconds":180,')
        + '"record":["final"]}'
    )
    with pytest.raises(module.DebugExperimentError) as exc:
        experiment.dispatch(command, _context(tmp_path))
    assert exc.value.code == "debug_request_invalid"


def test_dispatch_accepts_twenty_lanes_and_rejects_capacity_overflow(
    tmp_path: Path,
) -> None:
    module = _module()
    experiment = module.DebugExperiment(
        store=module.FileRunStore(tmp_path / "accepted"),
        checkpoint=CheckpointAdapter(),
        executor=ExecutorAdapter(),
    )
    lanes = _lane_specs(20)
    started = experiment.dispatch(
        "run " + json.dumps({
            "player_input": "我检查同一场景。",
            "lanes": lanes,
            "concurrency": 20,
        }, ensure_ascii=False),
        _context(tmp_path),
    )
    assert started["lanes"] == [lane["id"] for lane in lanes]
    assert experiment.dispatch(
        "status current", _context(tmp_path),
    )["spec"]["concurrency"] == 20

    default_experiment = module.DebugExperiment(
        store=module.FileRunStore(tmp_path / "default"),
        checkpoint=CheckpointAdapter(),
        executor=ExecutorAdapter(),
    )
    default_experiment.dispatch(
        "run " + json.dumps({
            "player_input": "我检查同一场景。",
            "lanes": _lane_specs(3),
        }, ensure_ascii=False),
        _context(tmp_path),
    )
    assert default_experiment.dispatch(
        "status current", _context(tmp_path),
    )["spec"]["concurrency"] == 2

    for label, lane_count, concurrency in (
        ("twenty-one-lanes", 21, 20),
        ("concurrency-twenty-one", 20, 21),
        ("above-lane-count", 3, 4),
    ):
        rejected = module.DebugExperiment(
            store=module.FileRunStore(tmp_path / label),
            checkpoint=CheckpointAdapter(),
            executor=ExecutorAdapter(),
        )
        with pytest.raises(module.DebugExperimentError) as exc:
            rejected.dispatch(
                "run " + json.dumps({
                    "player_input": "我检查同一场景。",
                    "lanes": _lane_specs(lane_count),
                    "concurrency": concurrency,
                }, ensure_ascii=False),
                _context(tmp_path),
            )
        assert exc.value.code == "debug_request_invalid", label


def test_dispatch_rejects_non_xai_busy_or_non_play_context(tmp_path: Path) -> None:
    module = _module()
    experiment = module.DebugExperiment(
        store=module.FileRunStore(tmp_path / "debug-runs"),
        checkpoint=CheckpointAdapter(),
        executor=ExecutorAdapter(),
    )
    command = (
        'run {"player_input":"我检查伤口。",'
        '"lanes":[{"id":"production-1","profile":"production"}]}'
    )
    for key, value, code in (
        ("provider", "openai", "debug_xai_required"),
        ("host_is_idle", False, "debug_command_not_idle"),
        ("role", "setup", "debug_not_play"),
    ):
        context = _context(tmp_path)
        context[key] = value
        with pytest.raises(module.DebugExperimentError) as exc:
            experiment.dispatch(command, context)
        assert exc.value.code == code


def test_status_and_cancel_remain_available_when_source_host_is_busy(tmp_path: Path) -> None:
    module = _module()
    executor = ExecutorAdapter()
    experiment = module.DebugExperiment(
        store=module.FileRunStore(tmp_path / "debug-runs"),
        checkpoint=CheckpointAdapter(),
        executor=executor,
    )
    experiment.dispatch(
        'run {"player_input":"我检查伤口。",'
        '"lanes":[{"id":"control-case","profile":"production"}]}',
        _context(tmp_path),
    )
    control_context = _context(tmp_path)
    control_context.update({
        "host_is_idle": False,
        "provider": "openai",
        "role": "setup",
    })
    assert experiment.dispatch("status current", control_context)["status"] == "running"
    assert experiment.dispatch("cancel current", control_context)["status"] == "cancelling"


def test_dispatch_rejects_duplicate_or_nonsemantic_lane_ids(tmp_path: Path) -> None:
    module = _module()
    experiment = module.DebugExperiment(
        store=module.FileRunStore(tmp_path / "debug-runs"),
        checkpoint=CheckpointAdapter(),
        executor=ExecutorAdapter(),
    )
    base = _context(tmp_path)
    for lanes in (
        '[{"id":"same","profile":"production"},{"id":"same","profile":"production"}]',
        '[{"id":"0d82a9132cbf4c79a8d71a39c8dd507f","profile":"production"}]',
    ):
        with pytest.raises(module.DebugExperimentError) as exc:
            experiment.dispatch(
                f'run {{"player_input":"我检查伤口。","lanes":{lanes}}}',
                base,
            )
        assert exc.value.code == "debug_request_invalid"


def test_git_checkpoint_materializes_isolated_latest_settled_tip(tmp_path: Path) -> None:
    module = _module()
    workspace, campaign_id, source_commit = _settled_workspace(tmp_path)
    source_campaign = coc_git_history.worktree_path_for(workspace, campaign_id)
    source_repo = coc_git_history.repo_path_for(workspace, campaign_id)
    source_status = module._git(
        source_repo, source_campaign, "status", "--porcelain", "--untracked-files=no",
    )
    adapter = module.GitCheckpointAdapter()
    checkpoint = adapter.seal_latest({
        **_context(tmp_path),
        "workspace_root": str(workspace),
        "campaign_id": campaign_id,
    })
    assert checkpoint["commit"] == source_commit
    assert checkpoint["timeline_id"] == "tl-main"
    assert checkpoint["turn"] == 1

    lane = adapter.materialize(checkpoint, tmp_path / "lane-workspace")
    lane_workspace = Path(lane["workspace_root"])
    lane_campaign = lane_workspace / ".coc" / "campaigns" / campaign_id
    lane_repo = lane_workspace / ".coc" / "repos" / "campaigns" / f"{campaign_id}.git"
    assert lane_campaign.is_dir()
    assert lane_repo.is_dir()
    assert lane_campaign.resolve() != source_campaign.resolve()
    assert lane_repo.resolve() != source_repo.resolve()
    assert module._git(lane_repo, lane_campaign, "rev-parse", "HEAD") == source_commit
    assert json.loads(
        (lane_workspace / ".coc" / "investigators" / "hero" / "character.json")
        .read_text(encoding="utf-8")
    )["id"] == "hero"
    assert json.loads(
        (lane_campaign / "save" / "continuation" / "delivery-receipts.jsonl")
        .read_text(encoding="utf-8")
    )["status"] == "confirmed"
    assert not (lane_workspace / ".coc" / "debug").exists()
    assert module._git(
        source_repo, source_campaign, "status", "--porcelain", "--untracked-files=no",
    ) == source_status
    assert module._git(source_repo, source_campaign, "rev-parse", "refs/heads/main") == source_commit


def test_git_checkpoint_rejects_pending_or_dirty_source(tmp_path: Path) -> None:
    module = _module()
    workspace, campaign_id, _commit = _settled_workspace(tmp_path)
    context = {
        **_context(tmp_path),
        "workspace_root": str(workspace),
        "campaign_id": campaign_id,
    }
    campaign = coc_git_history.worktree_path_for(workspace, campaign_id)
    pending = campaign / "save" / "pending-turn.json"
    pending.write_text("{}\n", encoding="utf-8")
    with pytest.raises(module.DebugExperimentError) as exc:
        module.GitCheckpointAdapter().seal_latest(context)
    assert exc.value.code == "checkpoint_unsettled"
    pending.unlink()
    (campaign / "save" / "world-state.json").write_text(
        json.dumps({"schema_version": 2, "turn": 999}) + "\n", encoding="utf-8",
    )
    with pytest.raises(module.DebugExperimentError) as exc:
        module.GitCheckpointAdapter().seal_latest(context)
    assert exc.value.code == "checkpoint_dirty"


def test_git_checkpoint_allows_only_post_finalization_audit_log_drift(
    tmp_path: Path,
) -> None:
    module = _module()
    workspace, campaign_id, commit = _settled_workspace(tmp_path)
    context = {
        **_context(tmp_path),
        "workspace_root": str(workspace),
        "campaign_id": campaign_id,
    }
    campaign = coc_git_history.worktree_path_for(workspace, campaign_id)
    audit = campaign / "logs" / "toolbox-calls.jsonl"
    audit.write_text('{"tool":"session.delivery_ack"}\n', encoding="utf-8")
    checkpoint = module.GitCheckpointAdapter().seal_latest(context)
    assert checkpoint["commit"] == commit
    assert checkpoint["post_finalization_audit_paths"] == [
        "logs/toolbox-calls.jsonl"
    ]


def test_git_checkpoint_hashes_and_materializes_tracked_post_finalization_overlays(
    tmp_path: Path,
) -> None:
    module = _module()
    workspace, campaign_id, commit = _settled_workspace(
        tmp_path,
        tracked_post_finalization_overlays=True,
    )
    campaign = coc_git_history.worktree_path_for(workspace, campaign_id)
    repo = coc_git_history.repo_path_for(workspace, campaign_id)
    source_status = module._git(
        repo, campaign, "status", "--porcelain", "--untracked-files=no",
    )
    expected_paths = [
        "memory/temporal/backlog.jsonl",
        "memory/temporal/episode-evidence.jsonl",
        "memory/temporal/episodes.jsonl",
        "save/continuation/delivery-receipts.jsonl",
    ]

    adapter = module.GitCheckpointAdapter()
    checkpoint = adapter.seal_latest({
        **_context(tmp_path),
        "workspace_root": str(workspace),
        "campaign_id": campaign_id,
    })
    assert checkpoint["commit"] == commit
    assert [
        row["path"] for row in checkpoint["post_finalization_overlays"]
    ] == expected_paths
    assert all(
        len(row["sha256"]) == 64 and row["size_bytes"] > 0
        for row in checkpoint["post_finalization_overlays"]
    )

    lane = adapter.materialize(checkpoint, tmp_path / "overlay-lane")
    lane_campaign = Path(lane["campaign_dir"])
    for relative in expected_paths:
        assert (lane_campaign / relative).read_bytes() == (campaign / relative).read_bytes()
    assert module._git(
        repo, campaign, "status", "--porcelain", "--untracked-files=no",
    ) == source_status


def test_git_checkpoint_requires_confirmed_delivery_for_tip(tmp_path: Path) -> None:
    module = _module()
    workspace, campaign_id, _commit = _settled_workspace(tmp_path)
    delivery = (
        coc_git_history.worktree_path_for(workspace, campaign_id)
        / "save" / "continuation" / "delivery-receipts.jsonl"
    )
    delivery.unlink()
    with pytest.raises(module.DebugExperimentError) as exc:
        module.GitCheckpointAdapter().seal_latest({
            **_context(tmp_path),
            "workspace_root": str(workspace),
            "campaign_id": campaign_id,
        })
    assert exc.value.code == "checkpoint_delivery_unconfirmed"


def test_dispatch_runs_isolated_lanes_and_records_only_selected_evidence(
    tmp_path: Path,
) -> None:
    module = _module()
    store = module.FileRunStore(tmp_path / "debug-runs")
    checkpoint = MaterializingCheckpointAdapter()
    lane_adapter = ScriptedLaneAdapter()
    coordinator = module.DebugRunCoordinator(
        store=store,
        checkpoint=checkpoint,
        lane=lane_adapter,
    )
    experiment = module.DebugExperiment(
        store=store,
        checkpoint=checkpoint,
        executor=coordinator,
    )
    started = experiment.dispatch(
        """run {
          "player_input":"我检查并处理伤口。",
          "lanes":[
            {"id":"success-case","profile":"production"},
            {"id":"timeout-case","profile":"production"}
          ],
          "record":["rules","timing","state_diff"],
          "concurrency":2,
          "timeout_seconds":180
        }""",
        _context(tmp_path),
    )
    status = experiment.dispatch("status current", _context(tmp_path))
    assert started["status"] == "started"
    assert status["status"] == "partial"
    assert lane_adapter.max_active == 2
    assert sorted(checkpoint.materialized) == ["success-case", "timeout-case"]
    assert status["lane_statuses"] == [
        {
            "id": "success-case",
            "status": "completed",
            "resume_first": True,
            "duration_ms": 1200,
            "finalized": True,
            "exact_delivery": True,
        },
        {
            "id": "timeout-case",
            "status": "timed_out",
            "resume_first": True,
            "duration_ms": 180000,
            "finalized": False,
            "exact_delivery": False,
            "error": {"code": "turn_absolute_budget_exceeded"},
        },
    ]

    run_root = tmp_path / "debug-runs" / started["experiment_id"]
    success = run_root / "lanes" / "success-case"
    assert (success / "final.json").is_file()
    assert (success / "rules.jsonl").is_file()
    assert (success / "timing.jsonl").is_file()
    assert (success / "state-diff.json").is_file()
    assert not (success / "rpc.jsonl").exists()
    assert "must-not-survive" not in (success / "rules.jsonl").read_text(
        encoding="utf-8"
    )
    assert "<REDACTED>" in (success / "rules.jsonl").read_text(encoding="utf-8")
    comparison = json.loads((run_root / "comparison.json").read_text(encoding="utf-8"))
    assert comparison["status"] == "partial"
    assert [row["id"] for row in comparison["lanes"]] == [
        "success-case", "timeout-case",
    ]
    assert comparison["lanes"][0]["player_input"] == "我检查并处理伤口。"
    assert comparison["lanes"][0]["rendered_text"] == "伤口已重新包扎。"
    assert comparison["lanes"][0]["canonical_operations"] == [
        "rules.settle",
    ]
    assert comparison["lanes"][0]["state_diff"] == {
        "hp": {"before": 11, "after": 12},
    }
    report = experiment.dispatch("report current", _context(tmp_path))
    assert report == {
        "status": "partial",
        "experiment_id": started["experiment_id"],
        "message": (
            f"Debug {started['experiment_id']} partial: "
            "success-case=completed, timeout-case=timed_out"
        ),
        "report": comparison,
    }


def test_report_rejects_a_nonterminal_run(tmp_path: Path) -> None:
    module = _module()
    experiment = module.DebugExperiment(
        store=module.FileRunStore(tmp_path / "debug-runs"),
        checkpoint=CheckpointAdapter(),
        executor=ExecutorAdapter(),
    )
    experiment.dispatch(
        'run {"player_input":"我检查伤口。",'
        '"lanes":[{"id":"still-running","profile":"production"}]}',
        _context(tmp_path),
    )
    with pytest.raises(module.DebugExperimentError) as exc:
        experiment.dispatch("report current", _context(tmp_path))
    assert exc.value.code == "debug_run_not_terminal"


def test_status_exposes_lane_progress_before_terminal(tmp_path: Path) -> None:
    module = _module()
    store = module.FileRunStore(tmp_path / "debug-runs")
    checkpoint = MaterializingCheckpointAdapter()
    lane = BlockingLaneAdapter()
    coordinator = module.DebugRunCoordinator(
        store=store, checkpoint=checkpoint, lane=lane,
    )
    experiment = module.DebugExperiment(
        store=store, checkpoint=checkpoint, executor=ExecutorAdapter(),
    )
    started = experiment.dispatch(
        'run {"player_input":"我检查伤口。",'
        '"lanes":[{"id":"progress-case","profile":"production"}]}',
        _context(tmp_path),
    )
    run = store.load_exact(started["experiment_id"])
    thread = threading.Thread(target=coordinator.start, args=(run,))
    thread.start()
    assert lane.entered.wait(timeout=2)
    status = experiment.dispatch("status current", _context(tmp_path))
    assert status["lane_statuses"] == [{
        "id": "progress-case",
        "status": "running",
    }]
    lane.release.set()
    thread.join(timeout=2)
    assert not thread.is_alive()


def _rpc_lane_run(tmp_path: Path, *, mode: str, timeout: int = 2) -> dict:
    module = _module()
    workspace = tmp_path / f"rpc-{mode}" / "workspace"
    workspace.mkdir(parents=True)
    source_home = tmp_path / f"rpc-{mode}" / "source-home"
    source_home.mkdir()
    (source_home / "settings.json").write_text(
        json.dumps({"packages": [str(ROOT)]}) + "\n", encoding="utf-8",
    )
    (source_home / "auth.json").write_text("{}\n", encoding="utf-8")
    adapter = module.PiRpcLaneAdapter(
        repo_root=ROOT,
        private_root=tmp_path / f"rpc-{mode}" / "private",
        command_builder=lambda _lane, _run, _materialized: [
            sys.executable,
            str(ROOT / "tests" / "pi" / "_lib" / "fake-debug-pi-rpc.py"),
        ],
        extra_env={"FAKE_DEBUG_MODE": mode},
    )
    run = {
        "experiment_id": f"debug-rpc-{mode}-r1",
        "evidence_root": str(tmp_path / f"rpc-{mode}" / "evidence"),
        "context": {
            "campaign_id": "debug-rpc-campaign",
            "provider": "xai",
            "model": "grok-4.6",
            "thinking": "low",
            "agent_home": str(source_home),
        },
        "checkpoint": {"commit": "a" * 40},
        "spec": {
            "timeout_seconds": timeout,
            "record": ["final", "rpc", "stderr"],
        },
    }
    lane = {
        "id": f"lane-{mode}",
        "profile": "production",
        "player_input": "我检查伤口。",
    }
    return adapter.run(
        lane=lane,
        run=run,
        materialized={"workspace_root": str(workspace), "repo": "", "commit": "a" * 40},
        cancelled=lambda: False,
    )


def test_rpc_lane_enforces_resume_first_and_exact_final_delivery(tmp_path: Path) -> None:
    result = _rpc_lane_run(tmp_path, mode="success")
    assert result["status"] == "completed"
    assert result["resume_first"] is True
    assert result["final"] == {
        "player_input": "我检查伤口。",
        "rendered_text": "伤口已重新包扎。",
        "finalized": True,
        "exact_delivery": True,
        "situation": {"shape": None},
    }
    operations = [
        row["operation"] for row in result["events"]
        if row.get("category") == "tools" and row.get("phase") == "start"
    ]
    assert operations == [
        "session.resume", "rules.settle", "turn.finalize",
    ]
    live_root = tmp_path / "rpc-success" / "evidence" / "lanes" / "lane-success"
    assert (live_root / "live-rpc.jsonl").is_file()
    progress = json.loads((live_root / "progress.json").read_text(encoding="utf-8"))
    assert progress["stage"] == "terminal"
    assert progress["last_event_type"] == "agent_settled"

    preflight = _rpc_lane_run(tmp_path, mode="preflight-read")
    assert preflight["status"] == "completed"
    assert preflight["resume_first"] is True


def test_rpc_lane_preserves_redacted_stderr_on_early_process_exit(
    tmp_path: Path,
) -> None:
    result = _rpc_lane_run(tmp_path, mode="process-exit")
    assert result["status"] == "failed"
    assert result["error"]["code"] == "process_exit"
    stderr = [
        row for row in result["events"]
        if row.get("category") == "stderr"
    ]
    assert stderr == [{
        "category": "stderr",
        "text": "pi-coc: missing agent settings; api_key=<REDACTED>",
    }]


def test_rpc_lane_rejects_directory_symlinks_inside_the_source_pi_home(
    tmp_path: Path,
) -> None:
    module = _module()
    source_home = tmp_path / "source-home"
    source_home.mkdir()
    (source_home / "settings.json").write_text("{}\n", encoding="utf-8")
    external_bin = tmp_path / "external-bin"
    external_bin.mkdir()
    (source_home / "bin").symlink_to(external_bin, target_is_directory=True)
    adapter = module.PiRpcLaneAdapter(
        repo_root=ROOT,
        private_root=tmp_path / "private",
        command_builder=lambda _lane, _run, _materialized: [
            sys.executable,
            str(ROOT / "tests" / "pi" / "_lib" / "fake-debug-pi-rpc.py"),
        ],
    )
    run = {
        "experiment_id": "debug-symlinked-home-r1",
        "context": {
            "campaign_id": "debug-rpc-campaign",
            "provider": "xai",
            "model": "grok-4.6",
            "thinking": "low",
            "agent_home": str(source_home),
        },
        "checkpoint": {"commit": "a" * 40},
        "spec": {"timeout_seconds": 2, "record": ["final"]},
    }
    with pytest.raises(module.DebugExperimentError) as exc:
        adapter.run(
            lane={
                "id": "unsafe-home",
                "profile": "production",
                "player_input": "我检查伤口。",
            },
            run=run,
            materialized={"workspace_root": str(tmp_path / "workspace")},
            cancelled=lambda: False,
        )
    assert exc.value.code == "rpc_spawn_failed"
    assert not (tmp_path / "private").exists()


def test_rpc_lane_times_out_once_and_rejects_wrong_first_operation(tmp_path: Path) -> None:
    started = time.monotonic()
    timed_out = _rpc_lane_run(tmp_path, mode="timeout", timeout=1)
    elapsed = time.monotonic() - started
    assert timed_out["status"] == "timed_out"
    assert timed_out["error"]["code"] == "turn_absolute_budget_exceeded"
    assert timed_out["abort_count"] == 1
    assert timed_out["abort_confirmed"] is True
    assert elapsed < 3

    resume_timeout = _rpc_lane_run(tmp_path, mode="timeout-resume", timeout=1)
    assert resume_timeout["status"] == "timed_out"
    assert resume_timeout["error"]["code"] == "lane_absolute_budget_exceeded"
    assert resume_timeout["abort_count"] == 1
    assert resume_timeout["abort_confirmed"] is True

    wrong = _rpc_lane_run(tmp_path, mode="wrong-resume")
    assert wrong["status"] == "failed"
    assert wrong["error"]["code"] == "resume_order_violation"
    assert wrong["final"]["rendered_text"] is None

    wrong_provider = _rpc_lane_run(tmp_path, mode="wrong-provider")
    assert wrong_provider["status"] == "failed"
    assert wrong_provider["error"]["code"] == "xai_provider_mismatch"


def test_cli_dispatch_returns_one_strict_error_envelope(tmp_path: Path) -> None:
    context = _context(tmp_path)
    completed = subprocess.run(
        [
            sys.executable,
            str(MODULE_PATH),
            "dispatch",
            "--command", "status current",
            "--context-json", json.dumps(context),
        ],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    assert completed.returncode == 2
    envelope = json.loads(completed.stdout)
    assert envelope == {
        "ok": False,
        "error": {
            "code": "debug_run_not_found",
            "message": "no current debug run",
        },
    }
    assert completed.stderr == ""


def test_status_reconciles_a_dead_coordinator_to_failed(tmp_path: Path) -> None:
    module = _module()
    store = module.FileRunStore(tmp_path / "debug-runs")
    experiment = module.DebugExperiment(
        store=store,
        checkpoint=CheckpointAdapter(),
        executor=ExecutorAdapter(),
    )
    started = experiment.dispatch(
        'run {"player_input":"我检查伤口。",'
        '"lanes":[{"id":"dead-owner","profile":"production"}]}',
        _context(tmp_path),
    )
    run = store.load_exact(started["experiment_id"])
    run["coordinator_pid"] = 999999
    store.save(run)
    status = experiment.dispatch("status current", _context(tmp_path))
    assert status["status"] == "failed"
    assert status["lane_statuses"] == [{
        "id": "dead-owner",
        "status": "failed",
        "error": {"code": "coordinator_exited_unsettled"},
    }]
    assert store.load_exact(started["experiment_id"])["error"] == {
        "code": "coordinator_exited_unsettled",
        "message": "the debug coordinator exited before sealing the run",
    }


def test_cli_rejects_symlinked_debug_evidence_root(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    coc_root = workspace / ".coc"
    coc_root.mkdir(parents=True)
    outside = tmp_path / "outside"
    outside.mkdir()
    (coc_root / "debug").symlink_to(outside, target_is_directory=True)
    context = {
        **_context(tmp_path),
        "workspace_root": str(workspace),
    }
    completed = subprocess.run(
        [
            sys.executable,
            str(MODULE_PATH),
            "dispatch",
            "--command", "status current",
            "--context-json", json.dumps(context),
        ],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    assert completed.returncode == 2
    assert json.loads(completed.stdout)["error"]["code"] == "evidence_root_unsafe"
    assert list(outside.iterdir()) == []


# ---------------------------------------------------------------------------
# Situation: structural seeding and prompt-established shapes (diagnostic-only)
# ---------------------------------------------------------------------------

_STRUCTURAL_SITUATION = {
    "scene_id": "corbitt-confrontation",
    "npc_presence": ["npc-walter-corbitt"],
    "clue_ids": ["clue-corbitt-body-found"],
    "flags": {"basement-unlocked": True},
}


class CatalogCheckpointAdapter(CheckpointAdapter):
    """Sealed checkpoint whose source campaign carries compiled scenario tables."""

    def __init__(self, tmp_path: Path):
        self.source_campaign = tmp_path / "catalog-source" / "campaign"
        scenario = self.source_campaign / "scenario"
        scenario.mkdir(parents=True)
        (scenario / "story-graph.json").write_text(json.dumps({
            "scenes": [
                {"scene_id": "corbitt-confrontation"},
                {"scene_id": "basement-rites"},
            ],
        }), encoding="utf-8")
        (scenario / "clue-graph.json").write_text(json.dumps({
            "conclusions": [{
                "conclusion_id": "conclusion-corbitt",
                "clues": [{"clue_id": "clue-corbitt-body-found"}],
            }],
        }), encoding="utf-8")
        (scenario / "npc-agendas.json").write_text(json.dumps({
            "npcs": [{"npc_id": "npc-walter-corbitt", "name": "Walter Corbitt"}],
        }), encoding="utf-8")

    def seal_latest(self, context):
        return {
            **super().seal_latest(context),
            "source_campaign": str(self.source_campaign),
        }


def test_run_spec_normalizes_situation_shapes_and_lane_override() -> None:
    module = _module()
    spec = module._normalize_run_spec({
        "player_input": "我举起提灯走向祭坛。",
        "situation": _STRUCTURAL_SITUATION,
        "lanes": [
            {"id": "seeded", "profile": "production"},
            {
                "id": "prompted",
                "profile": "rules-all-single-draft",
                "situation": {"establish_from_prompt": True},
            },
            {
                "id": "flag-only",
                "situation": {"flags": {"basement-unlocked": False}},
            },
        ],
    })
    assert spec["situation"] == {"shape": "structural", **_STRUCTURAL_SITUATION}
    assert spec["lanes"][0]["situation"] == {"shape": "structural", **_STRUCTURAL_SITUATION}
    assert spec["lanes"][1]["situation"] == {"shape": "prompt"}
    assert spec["lanes"][2]["situation"] == {
        "shape": "structural",
        "scene_id": None,
        "npc_presence": [],
        "clue_ids": [],
        "flags": {"basement-unlocked": False},
    }
    natural = module._normalize_run_spec({
        "player_input": "我检查伤口。",
        "lanes": [{"id": "natural"}],
    })
    assert natural["situation"] is None
    assert natural["lanes"][0]["situation"] is None
    assert module._situation_operations(spec["lanes"][0], "haunting-debug-source") == [
        {
            "operation": "state.move_scene",
            "arguments": {
                "campaign": "haunting-debug-source",
                "scene_id": "corbitt-confrontation",
                "reason": "host debug situation seeding for lane seeded",
                "decision_id": "debug-situation:seeded:move-scene:corbitt-confrontation",
            },
        },
        {
            "operation": "state.npc_presence",
            "arguments": {
                "campaign": "haunting-debug-source",
                "npc_id": "npc-walter-corbitt",
                "scene_id": "corbitt-confrontation",
                "status": "present",
                "reason": "host debug situation seeding for lane seeded",
                "decision_id": "debug-situation:seeded:npc-presence:npc-walter-corbitt",
            },
        },
        {
            "operation": "state.record_clue",
            "arguments": {
                "campaign": "haunting-debug-source",
                "clue_id": "clue-corbitt-body-found",
                "method": "host debug situation seeding for lane seeded",
                "decision_id": "debug-situation:seeded:record-clue:clue-corbitt-body-found",
            },
        },
        {
            "operation": "state.set_flag",
            "arguments": {
                "campaign": "haunting-debug-source",
                "flag_id": "basement-unlocked",
                "value": True,
                "reason": "host debug situation seeding for lane seeded",
                "decision_id": "debug-situation:seeded:set-flag:basement-unlocked",
            },
        },
    ]
    assert module._situation_operations(spec["lanes"][1], "haunting-debug-source") == []


@pytest.mark.parametrize(
    "situation",
    [
        {},
        {"establish_from_prompt": False},
        {"establish_from_prompt": "yes"},
        {"establish_from_prompt": True, "scene_id": "corbitt-confrontation"},
        {"scene_id": "corbitt-confrontation", "rng_seed": 7},
        {"scene_id": "corbitt-confrontation", "desired_result": "success"},
        {"scene_id": "corbitt-confrontation", "tools": ["rules.roll"]},
        {"scene_id": "no spaces allowed"},
        {"scene_id": ""},
        {"npc_presence": ["npc-walter-corbitt"]},
        {"scene_id": "corbitt-confrontation", "npc_presence": []},
        {"scene_id": "corbitt-confrontation", "npc_presence": "npc-walter-corbitt"},
        {"clue_ids": ["clue-a", "clue-a"]},
        {"flags": {}},
        {"flags": {"basement-unlocked": "true"}},
        {"flags": {"basement-unlocked": 1}},
        "corbitt-confrontation",
    ],
)
def test_run_spec_rejects_malformed_situations(situation) -> None:
    module = _module()
    for placement in ("run", "lane"):
        raw = {
            "player_input": "我检查伤口。",
            "lanes": [{"id": "production-1", "profile": "production"}],
        }
        if placement == "run":
            raw["situation"] = situation
        else:
            raw["lanes"][0]["situation"] = situation
        with pytest.raises(module.DebugExperimentError) as exc:
            module._normalize_run_spec(raw)
        assert exc.value.code == "debug_request_invalid", (placement, situation)


def test_dispatch_validates_situation_ids_against_the_sealed_catalog(tmp_path: Path) -> None:
    module = _module()
    store_root = tmp_path / "debug-runs"
    executor = ExecutorAdapter()
    experiment = module.DebugExperiment(
        store=module.FileRunStore(store_root),
        checkpoint=CatalogCheckpointAdapter(tmp_path),
        executor=executor,
    )

    def command(situation: dict) -> str:
        return "run " + json.dumps({
            "player_input": "我举起提灯走向祭坛。",
            "situation": situation,
            "lanes": [{"id": "seeded", "profile": "production"}],
        }, ensure_ascii=False)

    for situation, code in (
        ({**_STRUCTURAL_SITUATION, "scene_id": "attic-of-nowhere"}, "situation_unknown_scene"),
        ({**_STRUCTURAL_SITUATION, "npc_presence": ["npc-nobody"]}, "situation_unknown_npc"),
        ({**_STRUCTURAL_SITUATION, "clue_ids": ["clue-invented"]}, "situation_unknown_clue"),
    ):
        with pytest.raises(module.DebugExperimentError) as exc:
            experiment.dispatch(command(situation), _context(tmp_path))
        assert exc.value.code == code
        assert "seeded" in str(exc.value)
    # Fail-closed at planning: nothing was allocated, created, or started.
    assert executor.started == []
    assert not any(store_root.glob("debug-*"))

    started = experiment.dispatch(command(_STRUCTURAL_SITUATION), _context(tmp_path))
    assert started["status"] == "started"
    assert executor.started == [started["experiment_id"]]
    status = experiment.dispatch("status current", _context(tmp_path))
    assert status["spec"]["lanes"][0]["situation"] == {
        "shape": "structural", **_STRUCTURAL_SITUATION,
    }

    # A checkpoint without a readable scenario catalog cannot vouch for ids.
    blind = module.DebugExperiment(
        store=module.FileRunStore(tmp_path / "blind-runs"),
        checkpoint=CheckpointAdapter(),
        executor=ExecutorAdapter(),
    )
    with pytest.raises(module.DebugExperimentError) as exc:
        blind.dispatch(command(_STRUCTURAL_SITUATION), _context(tmp_path))
    assert exc.value.code == "situation_catalog_unavailable"
    # The prompt shape names no ids, so it needs no catalog.
    prompted = blind.dispatch(command({"establish_from_prompt": True}), _context(tmp_path))
    assert prompted["status"] == "started"


class SituationReportingLaneAdapter:
    """Reports application evidence for one lane and omits it for another."""

    def run(self, *, lane, run, materialized, cancelled):
        final = {
            "player_input": lane["player_input"],
            "rendered_text": "科比特从祭坛后站起。",
            "finalized": True,
            "exact_delivery": True,
        }
        if lane["id"] == "reported":
            final["situation"] = {
                "shape": "structural",
                "requested": _STRUCTURAL_SITUATION,
                "applied": [{
                    "operation": "state.move_scene",
                    "decision_id": "debug-situation:reported:move-scene:corbitt-confrontation",
                    "ok": True,
                    "warnings": [],
                }],
                "seeded": True,
            }
        return {
            "status": "completed",
            "resume_first": True,
            "duration_ms": 900,
            "events": [
                {
                    "category": "tools",
                    "phase": "seed",
                    "operation": "state.move_scene",
                    "event": {"ok": True},
                },
                {"category": "tools", "phase": "start", "operation": "rules.context"},
            ],
            "final": final,
        }


class MaterializingCatalogCheckpointAdapter(CatalogCheckpointAdapter):
    def materialize(self, checkpoint, lane_workspace):
        lane = Path(lane_workspace)
        lane.mkdir(parents=True)
        return {"workspace_root": str(lane), "commit": checkpoint["commit"]}


def test_coordinator_records_situation_shape_in_final_and_comparison(
    tmp_path: Path,
) -> None:
    module = _module()
    store = module.FileRunStore(tmp_path / "debug-runs")
    checkpoint = MaterializingCatalogCheckpointAdapter(tmp_path)
    coordinator = module.DebugRunCoordinator(
        store=store, checkpoint=checkpoint, lane=SituationReportingLaneAdapter(),
    )
    experiment = module.DebugExperiment(
        store=store, checkpoint=checkpoint, executor=coordinator,
    )
    started = experiment.dispatch(
        "run " + json.dumps({
            "player_input": "我举起提灯走向祭坛。",
            "lanes": [
                {"id": "reported", "situation": _STRUCTURAL_SITUATION},
                {"id": "unreported", "situation": {"establish_from_prompt": True}},
                {"id": "natural"},
            ],
            "record": ["tools"],
            "concurrency": 1,
        }, ensure_ascii=False),
        _context(tmp_path),
    )
    lanes_root = tmp_path / "debug-runs" / started["experiment_id"] / "lanes"
    reported = json.loads((lanes_root / "reported" / "final.json").read_text(encoding="utf-8"))
    assert reported["situation"]["shape"] == "structural"
    assert reported["situation"]["seeded"] is True
    assert reported["situation"]["applied"][0]["decision_id"] == (
        "debug-situation:reported:move-scene:corbitt-confrontation"
    )
    unreported = json.loads((lanes_root / "unreported" / "final.json").read_text(encoding="utf-8"))
    assert unreported["situation"] == {"shape": "prompt", "reported": False}
    natural = json.loads((lanes_root / "natural" / "final.json").read_text(encoding="utf-8"))
    assert natural["situation"] == {"shape": None, "reported": False}

    report = experiment.dispatch("report current", _context(tmp_path))["report"]
    by_id = {row["id"]: row for row in report["lanes"]}
    assert by_id["reported"]["situation"]["shape"] == "structural"
    assert by_id["unreported"]["situation"]["shape"] == "prompt"
    assert by_id["natural"]["situation"]["shape"] is None
    # Host seeding never masquerades as the Keeper's own operations.
    assert by_id["reported"]["canonical_operations"] == ["rules.context"]


def _quick_started_workspace(tmp_path: Path, campaign_id: str) -> Path:
    sys.path.insert(0, str(SCRIPTS))
    import coc_toolbox  # noqa: E402

    workspace = tmp_path / "workspace"
    workspace.mkdir(parents=True)
    started = coc_toolbox.run_tool(
        "setup.quick_start",
        workspace,
        None,
        {
            "scenario_id": "the-haunting",
            "pregen_id": "thomas-hayes",
            "campaign_id": campaign_id,
        },
    )
    assert started["ok"] is True, started
    return workspace


def _rpc_situation_lane_run(
    tmp_path: Path,
    *,
    situation: dict,
    workspace: Path,
    timeout: int = 60,
) -> tuple[dict, list[dict]]:
    module = _module()
    source_home = tmp_path / "source-home"
    source_home.mkdir()
    (source_home / "settings.json").write_text(
        json.dumps({"packages": [str(ROOT)]}) + "\n", encoding="utf-8",
    )
    prompt_log = tmp_path / "prompts.jsonl"
    adapter = module.PiRpcLaneAdapter(
        repo_root=ROOT,
        private_root=tmp_path / "private",
        command_builder=lambda _lane, _run, _materialized: [
            sys.executable,
            str(ROOT / "tests" / "pi" / "_lib" / "fake-debug-pi-rpc.py"),
        ],
        extra_env={
            "FAKE_DEBUG_MODE": "success",
            "FAKE_DEBUG_PROMPT_LOG": str(prompt_log),
        },
    )
    run = {
        "experiment_id": "debug-situation-r1",
        "evidence_root": str(tmp_path / "evidence"),
        "context": {
            "campaign_id": "debug-rpc-campaign",
            "provider": "xai",
            "model": "grok-4.6",
            "thinking": "low",
            "agent_home": str(source_home),
        },
        "checkpoint": {"commit": "a" * 40},
        "spec": {"timeout_seconds": timeout, "record": ["final", "tools"]},
    }
    lane = {
        "id": "seeded-lane",
        "profile": "production",
        "player_input": "我举起提灯走向祭坛。",
        "situation": module._normalize_situation(situation, label="situation"),
    }
    result = adapter.run(
        lane=lane,
        run=run,
        materialized={"workspace_root": str(workspace), "repo": "", "commit": "a" * 40},
        cancelled=lambda: False,
    )
    prompts = [
        json.loads(line)
        for line in prompt_log.read_text(encoding="utf-8").splitlines()
    ] if prompt_log.is_file() else []
    return result, prompts


def test_rpc_lane_seeds_a_structural_situation_through_the_canonical_toolbox(
    tmp_path: Path,
) -> None:
    module = _module()
    workspace = _quick_started_workspace(tmp_path, "debug-rpc-campaign")
    campaign = workspace / ".coc" / "campaigns" / "debug-rpc-campaign"
    world_before = json.loads(
        (campaign / "save" / "world-state.json").read_text(encoding="utf-8")
    )
    assert world_before.get("active_scene_id") != "corbitt-confrontation"

    result, prompts = _rpc_situation_lane_run(
        tmp_path, situation=_STRUCTURAL_SITUATION, workspace=workspace,
    )
    assert result["status"] == "completed", result.get("error")
    situation = result["final"]["situation"]
    assert situation["shape"] == "structural"
    assert situation["requested"] == _STRUCTURAL_SITUATION
    assert situation["seeded"] is True
    assert [row["operation"] for row in situation["applied"]] == [
        "state.move_scene", "state.npc_presence", "state.record_clue", "state.set_flag",
    ]
    assert all(row["ok"] is True for row in situation["applied"])
    assert situation["applied"][0]["decision_id"] == (
        "debug-situation:seeded-lane:move-scene:corbitt-confrontation"
    )
    # Canonical state moved through the toolbox, not by hand.
    world = json.loads((campaign / "save" / "world-state.json").read_text(encoding="utf-8"))
    assert world["active_scene_id"] == "corbitt-confrontation"
    assert "clue-corbitt-body-found" in world["discovered_clue_ids"]
    ledger_rows = [
        json.loads(line)
        for line in (campaign / "logs" / "toolbox-calls.jsonl")
        .read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    seeded_tools = [row["tool"] for row in ledger_rows if row.get("ok") is True]
    assert {"state.move_scene", "state.npc_presence", "state.record_clue", "state.set_flag"} <= set(
        seeded_tools
    )
    # Seeding happened before the resume prompt, which names it as host seeding.
    assert prompts[0]["id"] == "resume-seeded-lane"
    assert "pre-established a situation" in prompts[0]["message"]
    assert prompts[1]["message"] == "我举起提灯走向祭坛。"
    seed_events = [
        row for row in result["events"]
        if row.get("category") == "tools" and row.get("phase") == "seed"
    ]
    assert [row["operation"] for row in seed_events] == [
        "state.move_scene", "state.npc_presence", "state.record_clue", "state.set_flag",
    ]
    assert module._SITUATION_RESUME_NOTE.strip() in prompts[0]["message"]


def test_rpc_lane_fails_closed_when_seeding_is_refused(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    (workspace / ".coc").mkdir(parents=True)
    result, prompts = _rpc_situation_lane_run(
        tmp_path, situation={"scene_id": "corbitt-confrontation"}, workspace=workspace,
    )
    assert result["status"] == "failed"
    assert result["error"] == {"code": "situation_seed_failed"}
    assert result["resume_first"] is False
    situation = result["final"]["situation"]
    assert situation["seeded"] is False
    assert len(situation["applied"]) == 1
    assert situation["applied"][0]["ok"] is False
    assert situation["applied"][0]["error"]["code"] == "unknown_campaign"
    # No Pi process was spawned for a lane whose situation never landed.
    assert prompts == []
    assert not (tmp_path / "private").exists()


def test_rpc_lane_prepends_the_host_instruction_for_a_prompt_situation(
    tmp_path: Path,
) -> None:
    module = _module()
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    result, prompts = _rpc_situation_lane_run(
        tmp_path, situation={"establish_from_prompt": True}, workspace=workspace,
    )
    assert result["status"] == "completed"
    assert result["final"]["situation"] == {
        "shape": "prompt",
        "instruction": module._SITUATION_PROMPT_INSTRUCTION,
    }
    assert result["final"]["player_input"] == "我举起提灯走向祭坛。"
    assert prompts[0]["id"] == "resume-seeded-lane"
    assert "pre-established" not in prompts[0]["message"]
    assert prompts[1]["message"] == (
        module._SITUATION_PROMPT_INSTRUCTION + "\n\n我举起提灯走向祭坛。"
    )
    assert "state.move_scene" in module._SITUATION_PROMPT_INSTRUCTION
    assert "never invented" in module._SITUATION_PROMPT_INSTRUCTION
