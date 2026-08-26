"""Finalize-trigger memory extraction hook (host integration).

Pins: every successful ``turn.finalize`` history commit enqueues exactly one
deterministic semantic extraction job/backlog entry through the canonical
temporal-memory facade; finalize replay does not duplicate it; enqueue
failure never fails ``turn.finalize`` (hard fail-open with a warning and
Git-rebuildable backlog); job/episode/backlog identities derive from
(campaign, timeline, turn) only — never wall-clock.
"""
from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


coc_toolbox = _load("coc_toolbox_extract_hook", SCRIPTS / "coc_toolbox.py")
coc_starter = _load("coc_starter_extract_hook", SCRIPTS / "coc_starter.py")
contract = _load(
    "coc_temporal_memory_contract_extract_hook",
    SCRIPTS / "coc_temporal_memory_contract.py",
)


@pytest.fixture(autouse=True)
def isolated_git_home(tmp_path, monkeypatch):
    home = tmp_path / "_empty_home"
    home.mkdir(exist_ok=True)
    monkeypatch.setenv("HOME", str(home))
    for key in (
        "XDG_CONFIG_HOME",
        "GIT_CONFIG_GLOBAL",
        "GIT_CONFIG_SYSTEM",
        "GIT_DIR",
        "GIT_WORK_TREE",
        "GIT_INDEX_FILE",
        "GIT_AUTHOR_NAME",
        "GIT_AUTHOR_EMAIL",
        "GIT_COMMITTER_NAME",
        "GIT_COMMITTER_EMAIL",
        "GIT_AUTHOR_DATE",
        "GIT_COMMITTER_DATE",
    ):
        monkeypatch.delenv(key, raising=False)


def _write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


@pytest.fixture()
def campaign_ws(tmp_path: Path):
    workspace = tmp_path / "workspace"
    coc_root = workspace / ".coc"
    campaign_id = "mem-extract-hook-test"
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
        title="Memory Extract Hook Test",
    )
    return {
        "workspace": workspace,
        "campaign_id": campaign_id,
        "campaign_dir": Path(quick["campaign_dir"]),
    }


def _run(ws, tool: str, args: dict | None = None) -> dict:
    return coc_toolbox.run_tool(tool, ws["workspace"], ws["campaign_id"], dict(args or {}))


def _repo(ws) -> Path:
    return ws["workspace"] / ".coc" / "repos" / "campaigns" / f"{ws['campaign_id']}.git"


def _git(ws, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            "git",
            f"--git-dir={_repo(ws)}",
            f"--work-tree={ws['campaign_dir']}",
            *args,
        ],
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )


def _head_sha(ws) -> str:
    return _git(ws, "rev-parse", "HEAD").stdout.strip()


def _trailers(ws) -> dict[str, str]:
    message = _git(ws, "log", "-1", "--format=%B").stdout
    return coc_toolbox.coc_git_history.parse_trailers(message)


def _jsonl(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    return [
        json.loads(raw)
        for raw in path.read_text(encoding="utf-8").splitlines()
        if raw.strip()
    ]


def _episodes(ws) -> list[dict]:
    return _jsonl(ws["campaign_dir"] / "memory" / "temporal" / "episodes.jsonl")


def _backlog(ws) -> list[dict]:
    return _jsonl(ws["campaign_dir"] / "memory" / "temporal" / "backlog.jsonl")


def _build_finalize_args(ws, decision_id: str) -> dict:
    journaled = _run(
        ws,
        "state.journal",
        {
            "summary": f"journal for {decision_id}",
            "player_text": f"我完成了 {decision_id} 的测试行动。",
            "decision_id": f"{decision_id}-journal",
        },
    )
    assert journaled["ok"] is True, journaled
    output = _run(ws, "turn.output_context")
    assert output["ok"] is True, output
    context = output["data"]
    result_paragraph = "已结算的测试结果按其原有因果关系发生。"
    draft = "测试中的行动继续推进。\n\n" + result_paragraph
    coverage = [
        {
            "obligation_id": obligation["obligation_id"],
            "realization": "fictional_beat",
            "action_realization": "调查员完成了这项已结算的测试行动",
            "response": "场景按权威结算结果作出对应反应",
            "causal_explanation": "该反应直接来自本轮已经结算的行动结果",
            "persona_fit": "这项行动保持调查员既有的测试角色设定",
            "player_input_handling": "abstract_completed",
            "exact_excerpt": result_paragraph,
            "exceptional_beat": (
                "特殊结果已经产生与该行动直接相连的实质影响"
                if obligation["exceptional_required"]
                else ""
            ),
        }
        for obligation in context["obligations"]
    ]
    mechanics_placements = []
    for segment_type, source_key, after_paragraph in (
        ("public_check", "roll_id", 0),
        ("state_delta", "effect_id", 1),
        ("exceptional_effect", "event_id", 1),
    ):
        rows = context["mechanics_bundle"].get(segment_type) or []
        if rows:
            mechanics_placements.append({
                "after_paragraph": after_paragraph,
                "segment_type": segment_type,
                "source_ids": [str(row[source_key]) for row in rows],
            })
    return {
        "draft": draft,
        "coverage": coverage,
        "mechanics_placements": mechanics_placements,
        "revision": 1,
        "decision_id": decision_id,
    }


def _finalize_current_turn(ws, decision_id: str) -> dict:
    finalized = _run(ws, "turn.finalize", _build_finalize_args(ws, decision_id))
    assert finalized["ok"] is True, finalized
    return finalized


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_finalize_success_enqueues_one_extraction_backlog_entry(campaign_ws):
    finalized = _finalize_current_turn(campaign_ws, "extract-enqueue-finalize")
    trailers = _trailers(campaign_ws)
    assert trailers["COC-Commit-Type"] == "turn"
    campaign_id = campaign_ws["campaign_id"]
    timeline_id = trailers["Timeline-Id"]
    turn_number = int(trailers["Turn-Number"])
    finalization_id = finalized["data"]["finalization_id"]

    episodes = _episodes(campaign_ws)
    assert len(episodes) == 1
    episode = episodes[0]
    expected_episode_id = contract.episode_id_for(campaign_id, timeline_id, turn_number)
    # Closed schema; ids derive from (campaign, timeline, turn), no wall clock.
    assert set(episode) <= set(contract.EPISODE_FIELDS)
    assert episode["episode_id"] == expected_episode_id
    assert episode["commit"] == _head_sha(campaign_ws)
    assert episode["finalization_receipt"] == finalization_id

    backlog_rows = _backlog(campaign_ws)
    assert len(backlog_rows) == 1
    row = backlog_rows[0]
    assert set(row) <= set(contract.BACKLOG_FIELDS)
    assert row["backlog_id"] == contract.backlog_id_for(campaign_id, turn_number, "extract")
    assert row["status"] == "pending"
    assert row["commit"] == _head_sha(campaign_ws)
    assert row["turn_number"] == turn_number

    evidence = finalized["data"]["memory_extraction"]
    assert evidence["job_id"] == f"extract-{campaign_id}-{timeline_id}-turn-{turn_number}"
    assert evidence["episode_id"] == expected_episode_id
    assert evidence["backlog_id"] == row["backlog_id"]
    assert evidence["timeline_id"] == timeline_id
    # Machine-attached commit identity matches Git truth, never the envelope.
    resolved = coc_toolbox.coc_git_history.resolve_history_selector(
        campaign_ws["workspace"],
        campaign_id,
        {"timeline_id": timeline_id, "turn": turn_number},
    )
    assert resolved["commit"] == episode["commit"]


def test_finalize_replay_does_not_duplicate_backlog_or_episode(campaign_ws):
    args = _build_finalize_args(campaign_ws, "extract-replay-finalize")
    first = _run(campaign_ws, "turn.finalize", args)
    assert first["ok"] is True, first
    episodes_after_first = _episodes(campaign_ws)
    backlog_after_first = _backlog(campaign_ws)

    replayed = _run(campaign_ws, "turn.finalize", args)
    assert replayed["ok"] is True, replayed
    assert replayed["data"]["memory_extraction"] == first["data"]["memory_extraction"]
    assert _episodes(campaign_ws) == episodes_after_first
    assert _backlog(campaign_ws) == backlog_after_first


def test_finalize_enqueue_failure_fails_open_with_warning(campaign_ws, monkeypatch):
    def boom(*_args, **_kwargs):
        raise RuntimeError("injected producer outage")

    monkeypatch.setattr(
        coc_toolbox.coc_temporal_memory, "record_turn_episode", boom
    )
    finalized = _run(
        campaign_ws, "turn.finalize", _build_finalize_args(campaign_ws, "extract-fail-finalize")
    )
    assert finalized["ok"] is True, finalized
    warnings_text = " ".join(finalized.get("warnings") or [])
    assert "memory-extraction enqueue failed" in warnings_text
    assert "rebuildable from Git" in warnings_text
    assert "injected producer outage" in warnings_text
    # The durable parts are untouched by the failed enqueue.
    assert finalized["data"]["finalization_id"]
    assert _trailers(campaign_ws)["COC-Commit-Type"] == "turn"
    assert "memory_extraction" not in finalized["data"]
    assert _episodes(campaign_ws) == []
    assert _backlog(campaign_ws) == []


def test_extraction_identity_is_rebuildable_from_git_without_wall_clock(
    campaign_ws, tmp_path
):
    """Replay of the same finalized binding rebuilds the identical entry.

    No timestamps or monotonic counters take part: rebuilding from the Git
    commit trailers alone reproduces the same job/episode/backlog identity.
    """
    finalized = _finalize_current_turn(campaign_ws, "extract-determinism-finalize")
    trailers = _trailers(campaign_ws)
    campaign_id = campaign_ws["campaign_id"]
    timeline_id = trailers["Timeline-Id"]
    turn_number = int(trailers["Turn-Number"])
    receipt = finalized["data"]["finalization_id"]

    job = coc_toolbox.coc_memory_extraction.build_extraction_job(
        campaign_ws["campaign_dir"],
        {
            "sha": _head_sha(campaign_ws),
            "campaign_id": campaign_id,
            "timeline_id": timeline_id,
            "turn_number": turn_number,
            "finalization_id": receipt,
            "commit_type": "turn",
        },
        receipt,
        _episodes(campaign_ws)[0],
    )
    assert job["job_id"] == finalized["data"]["memory_extraction"]["job_id"]
    rebuilt_episode = dict(_episodes(campaign_ws)[0])
    # The stored episode record itself reproduces the exact evidence mapping.
    assert (
        coc_toolbox.coc_temporal_memory.contract.episode_id_for(
            campaign_id, timeline_id, turn_number
        )
        == rebuilt_episode["episode_id"]
    )
