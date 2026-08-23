"""Turn commit closure: git turn commits and resume-time turn-tail quarantine.

Pins W1: finalization is the turn commit point. Public rolls bound to no
finalization (an abandoned turn tail after a crash) are marked voided — never
deleted — and turn-scoped state restores from HEAD's save/ subset at
session.resume, so unfinalized branches cannot leak into canonical state or
the battle report.
"""
from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import threading
import time
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"
PYTHON = sys.executable


def _load(name: str, rel: str | Path):
    path = Path(rel)
    if not path.is_absolute():
        path = REPO / path
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


coc_toolbox = _load("coc_toolbox_turn_quarantine", SCRIPTS / "coc_toolbox.py")
coc_starter = _load("coc_starter_turn_quarantine", SCRIPTS / "coc_starter.py")
coc_turn_finalization = _load(
    "coc_turn_finalization_quarantine", SCRIPTS / "coc_turn_finalization.py"
)
coc_git_history = _load("coc_git_history_turn_quarantine", SCRIPTS / "coc_git_history.py")
coc_git_history_verify = _load(
    "coc_git_history_verify_turn_quarantine",
    SCRIPTS / "coc_git_history_verify.py",
)
coc_state = _load("coc_state_turn_quarantine", SCRIPTS / "coc_state.py")

SCHEMA = coc_git_history.format_schema_generation(coc_state.CURRENT_SCHEMA_VERSIONS)


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


def _read_jsonl(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    return [
        json.loads(raw)
        for raw in path.read_text(encoding="utf-8").splitlines()
        if raw.strip()
    ]


@pytest.fixture()
def campaign_ws(tmp_path: Path):
    workspace = tmp_path / "workspace"
    coc_root = workspace / ".coc"
    campaign_id = "turn-quarantine-test"
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
        title="Turn Quarantine Test",
    )
    return {
        "workspace": workspace,
        "coc_root": coc_root,
        "campaign_id": campaign_id,
        "campaign_dir": Path(quick["campaign_dir"]),
        "investigator_id": quick["investigator_id"],
        "quick": quick,
    }


def _run(ws, tool: str, args: dict | None = None) -> dict:
    args = dict(args or {})
    if tool == "rules.roll":
        args.setdefault("difficulty", "regular")
        args.setdefault("difficulty_basis", "keeper_judgment")
        args.setdefault("goal", "settle the focused quarantine test action")
        args.setdefault(
            "stakes",
            {
                "on_success": "the focused test action succeeds",
                "on_failure": "the focused test action does not succeed",
            },
        )
    result = coc_toolbox.run_tool(
        tool, ws["workspace"], ws["campaign_id"], dict(args)
    )
    assert isinstance(result, dict)
    return result


def _repo(ws) -> Path:
    return ws["coc_root"] / "repos" / "campaigns" / f"{ws['campaign_id']}.git"


def _git(ws, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            "git",
            f"--git-dir={_repo(ws)}",
            f"--work-tree={ws['campaign_dir']}",
            *args,
        ],
        check=check,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )


def _commit_count(ws) -> int:
    repo = _repo(ws)
    if not (repo / "HEAD").is_file():
        return 0
    probe = _git(ws, "rev-parse", "--verify", "-q", "HEAD", check=False)
    if probe.returncode != 0:
        return 0
    return int(_git(ws, "rev-list", "--count", "HEAD").stdout.strip())


def _head_sha(ws) -> str | None:
    if _commit_count(ws) == 0:
        return None
    return _git(ws, "rev-parse", "HEAD").stdout.strip()


def _trailers(ws) -> dict[str, str]:
    message = _git(ws, "log", "-1", "--format=%B").stdout
    return coc_git_history.parse_trailers(message)


def _tree_names(ws) -> set[str]:
    if _commit_count(ws) == 0:
        return set()
    return {
        line
        for line in _git(ws, "ls-tree", "-r", "--name-only", "HEAD").stdout.splitlines()
        if line
    }


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


def _inv_state(ws) -> dict:
    return json.loads(
        (ws["campaign_dir"] / "save" / "investigator-state" / f"{ws['investigator_id']}.json")
        .read_text(encoding="utf-8")
    )


def _sanity_snapshot(ws) -> dict:
    return json.loads(
        (ws["campaign_dir"] / "save" / "sanity-state" / f"{ws['investigator_id']}.json")
        .read_text(encoding="utf-8")
    )


def _san_check(ws, *, decision_id: str, seed: int, loss_failure: str, loss_success: str = "0") -> dict:
    result = _run(
        ws,
        "rules.sanity_check",
        {
            "investigator": ws["investigator_id"],
            "source": f"horror {decision_id}",
            "loss_success": loss_success,
            "loss_failure": loss_failure,
            "decision_id": decision_id,
            "seed": seed,
        },
    )
    assert result["ok"] is True, result
    return result


def test_finalize_writes_one_turn_commit_with_receipt_trailers(campaign_ws):
    rolled = _run(
        campaign_ws,
        "rules.roll",
        {
            "investigator": campaign_ws["investigator_id"],
            "skill": "Spot Hidden",
            "target": 99,
            "seed": 1,
            "decision_id": "committed-roll",
        },
    )
    assert rolled["ok"] is True, rolled
    before = _commit_count(campaign_ws)
    leftover = (
        campaign_ws["campaign_dir"] / "save" / "commit-snapshots" / "legacy"
    )
    leftover.mkdir(parents=True)
    marker = leftover / "world-state.json"
    marker.write_text('{"legacy": true}\n', encoding="utf-8")
    leftover_bytes = marker.read_bytes()
    finalized = _finalize_current_turn(campaign_ws, "committed-turn-finalize")
    receipt = finalized["data"]
    assert _commit_count(campaign_ws) == before + 1
    trailers = _trailers(campaign_ws)
    assert trailers["COC-Commit-Type"] == "turn"
    assert trailers["Campaign-Id"] == campaign_ws["campaign_id"]
    assert trailers["Timeline-Id"] == "tl-main"
    assert trailers["Finalization-Id"] == receipt["finalization_id"]
    assert trailers["Journal-Decision-Id"] == receipt["journal_decision_id"]
    assert trailers["Settlement-Snapshot-Id"] == receipt["settlement_snapshot_id"]
    assert trailers["Rendered-Text-SHA256"] == receipt["rendered_text_sha256"]
    assert trailers["Schema-Generation"] == SCHEMA
    assert trailers["Turn-Number"].isdigit()
    names = _tree_names(campaign_ws)
    assert any(
        name.endswith(f"{campaign_ws['investigator_id']}.json")
        and name.startswith("save/investigator-state/")
        for name in names
    )
    assert not any(name.startswith("save/commit-snapshots/") for name in names)
    assert leftover.is_dir()
    assert marker.read_bytes() == leftover_bytes
    produced = (
        campaign_ws["campaign_dir"]
        / "save"
        / "commit-snapshots"
        / receipt["finalization_id"]
    )
    assert not produced.exists()


def test_finalize_replay_same_finalization_id_does_not_duplicate_commit(campaign_ws):
    args = _build_finalize_args(campaign_ws, "replay-turn-finalize")
    first = _run(campaign_ws, "turn.finalize", args)
    assert first["ok"] is True, first
    sha = _head_sha(campaign_ws)
    count = _commit_count(campaign_ws)
    replayed = _run(campaign_ws, "turn.finalize", args)
    assert replayed["ok"] is True, replayed
    assert replayed["data"]["finalization_id"] == first["data"]["finalization_id"]
    assert _head_sha(campaign_ws) == sha
    assert _commit_count(campaign_ws) == count


def test_finalize_commit_failure_leaves_receipt_without_turn_commit(
    campaign_ws, monkeypatch
):
    args = _build_finalize_args(campaign_ws, "failed-history-finalize")
    before = _commit_count(campaign_ws)
    receipts_path = campaign_ws["campaign_dir"] / "logs" / "turn-finalizations.jsonl"
    before_receipts = (
        receipts_path.read_text(encoding="utf-8") if receipts_path.is_file() else ""
    )

    def boom(*_args, **_kwargs):
        raise coc_toolbox.coc_git_history.GitHistoryError("injected commit failure")

    monkeypatch.setattr(
        coc_toolbox.coc_git_history, "commit_finalized_turn", boom
    )
    failed = _run(campaign_ws, "turn.finalize", args)
    assert failed["ok"] is False, failed
    assert failed["error"]["code"] == "history_commit_failed"
    after_receipts = receipts_path.read_text(encoding="utf-8")
    assert after_receipts != before_receipts
    last = json.loads(after_receipts.strip().splitlines()[-1])
    assert last["decision_id"] == "failed-history-finalize"
    assert _commit_count(campaign_ws) == before
    assert not (
        campaign_ws["campaign_dir"]
        / "save"
        / "commit-snapshots"
        / last["finalization_id"]
    ).exists()


def test_finalize_wrapper_immediately_proves_clean_git_state(campaign_ws):
    lock = campaign_ws["campaign_dir"] / "save" / "run-identity.lock"
    lock.write_text("held\n", encoding="utf-8")
    finalized = _finalize_current_turn(campaign_ws, "proof-after-finalize")
    receipt = finalized["data"]
    pending = campaign_ws["campaign_dir"] / "save" / "pending-turn.json"
    assert not pending.exists()
    proof = coc_git_history_verify.state_integrity_proof(
        campaign_ws["workspace"],
        campaign_ws["campaign_id"],
        expected_finalization_id=receipt["finalization_id"],
    )
    payload = proof.to_dict()
    assert payload["status"] == "PASS", payload
    assert payload["head"]["commit_type"] == "turn"
    assert payload["head"]["finalization_id"] == receipt["finalization_id"]
    assert payload["latest_receipt"]["finalization_id"] == receipt["finalization_id"]
    assert payload["latest_receipt"]["paired"] is True
    assert payload["head_matches_latest_receipt"] is True
    assert payload["tree"]["clean"] is True
    assert payload["tree"]["dirty_paths"] == []
    assert payload["tree"]["drifted_paths"] == []
    assert payload["tree"]["missing_paths"] == []
    assert payload["findings"] == []
    names = _tree_names(campaign_ws)
    assert "save/pending-turn.json" not in names
    assert "save/run-identity.lock" not in names
    assert lock.is_file()


def test_finalize_commit_does_not_bind_next_turn_pending(campaign_ws, monkeypatch):
    args = _build_finalize_args(campaign_ws, "locked-turn-finalize")
    original = coc_toolbox.coc_git_history.commit_finalized_turn
    entered = threading.Event()
    release = threading.Event()

    def gated(*call_args, **call_kwargs):
        entered.set()
        assert release.wait(timeout=8)
        return original(*call_args, **call_kwargs)

    monkeypatch.setattr(
        coc_toolbox.coc_git_history, "commit_finalized_turn", gated
    )
    finalized_box: dict[str, dict] = {}

    def finalize():
        finalized_box["result"] = _run(campaign_ws, "turn.finalize", args)

    worker = threading.Thread(target=finalize)
    worker.start()
    assert entered.wait(timeout=8)
    journal_started = threading.Event()
    journal_box: dict[str, dict] = {}

    def journal_next_turn():
        journal_started.set()
        journal_box["result"] = _run(
            campaign_ws,
            "state.journal",
            {
                "summary": "journal after paused commit",
                "player_text": "我在上一回合提交完成前开始下一回合。",
                "decision_id": "next-turn-during-commit",
            },
        )

    journal_worker = threading.Thread(target=journal_next_turn)
    journal_worker.start()
    assert journal_started.wait(timeout=5)
    time.sleep(0.3)
    assert "result" not in journal_box
    assert "save/pending-turn.json" not in _tree_names(campaign_ws)
    release.set()
    worker.join(timeout=10)
    journal_worker.join(timeout=15)
    assert not worker.is_alive()
    assert not journal_worker.is_alive()
    finalized = finalized_box["result"]
    assert finalized["ok"] is True, finalized
    receipt = finalized["data"]
    names = _tree_names(campaign_ws)
    assert "save/pending-turn.json" not in names
    assert _trailers(campaign_ws)["Finalization-Id"] == receipt["finalization_id"]
    journaled = journal_box["result"]
    assert journaled["ok"] is True, journaled
    pending = campaign_ws["campaign_dir"] / "save" / "pending-turn.json"
    assert pending.is_file()
    proof = coc_git_history_verify.state_integrity_proof(
        campaign_ws["workspace"],
        campaign_ws["campaign_id"],
        expected_finalization_id=receipt["finalization_id"],
    )
    codes = [item.code for item in proof.findings]
    assert "committed_pending_turn" not in codes
    assert proof.head.finalization_id == receipt["finalization_id"]


def test_failed_finalize_commit_cannot_bind_later_pending_turn(
    campaign_ws, monkeypatch
):
    args = _build_finalize_args(campaign_ws, "retry-after-next-turn")
    before = _commit_count(campaign_ws)
    receipts_path = campaign_ws["campaign_dir"] / "logs" / "turn-finalizations.jsonl"
    original = coc_toolbox.coc_git_history.commit_finalized_turn

    def boom(*_args, **_kwargs):
        raise coc_toolbox.coc_git_history.GitHistoryError("injected commit failure")

    monkeypatch.setattr(
        coc_toolbox.coc_git_history, "commit_finalized_turn", boom
    )
    failed = _run(campaign_ws, "turn.finalize", args)
    assert failed["ok"] is False, failed
    assert failed["error"]["code"] == "history_commit_failed"
    last = json.loads(receipts_path.read_text(encoding="utf-8").strip().splitlines()[-1])
    assert last["decision_id"] == "retry-after-next-turn"
    assert _commit_count(campaign_ws) == before
    journaled = _run(
        campaign_ws,
        "state.journal",
        {
            "summary": "journal after failed history commit",
            "player_text": "我在提交失败后开始下一回合。",
            "decision_id": "next-turn-after-failed-commit",
        },
    )
    assert journaled["ok"] is True, journaled
    pending = campaign_ws["campaign_dir"] / "save" / "pending-turn.json"
    assert pending.is_file()
    monkeypatch.setattr(
        coc_toolbox.coc_git_history,
        "commit_finalized_turn",
        original,
    )
    retried = _run(campaign_ws, "turn.finalize", args)
    assert retried["ok"] is False, retried
    assert retried["error"]["code"] == "history_commit_failed"
    assert _commit_count(campaign_ws) == before
    assert "save/pending-turn.json" not in _tree_names(campaign_ws)
    after_receipts = [
        json.loads(raw)
        for raw in receipts_path.read_text(encoding="utf-8").splitlines()
        if raw.strip()
    ]
    assert after_receipts[-1]["decision_id"] == last["decision_id"]
    assert after_receipts[-1]["finalization_id"] == last["finalization_id"]
    assert pending.is_file()


def test_creation_receipts_bind_luck_and_characteristic_rolls():
    luck_reference = {
        "campaign_id": "creation-binding-test",
        "decision_id": "creation-luck",
        "roll_id": "creation-luck-roll",
    }
    bound = coc_turn_finalization.creation_receipt_bound_roll_ids(
        "creation-binding-test",
        [
            {
                "luck_roll_receipt": luck_reference,
                "characteristic_roll_receipts": {
                    "STR": {
                        "campaign_id": "creation-binding-test",
                        "decision_id": "creation-str",
                        "roll_id": "creation-str-roll",
                    },
                    "Luck": luck_reference,
                },
            },
        ],
    )
    assert bound == {"creation-luck-roll", "creation-str-roll"}


def test_resume_quarantines_late_receipt_in_imported_creation(campaign_ws):
    creation_luck = _run(
        campaign_ws,
        "rules.roll_dice",
        {
            "expression": "3D6",
            "purpose": "investigator_creation_luck",
            "reason": "canonical Quick Fire Luck source",
            "seed": 7,
            "decision_id": "creation-luck-for-quarantine",
        },
    )
    assert creation_luck["ok"] is True, creation_luck
    creation_path = (
        campaign_ws["coc_root"]
        / "investigators"
        / campaign_ws["investigator_id"]
        / "creation.json"
    )
    creation = json.loads(creation_path.read_text(encoding="utf-8"))
    creation["luck_roll_receipt"] = {
        "campaign_id": campaign_ws["campaign_id"],
        "decision_id": "creation-luck-for-quarantine",
        "roll_id": creation_luck["data"]["roll_id"],
    }
    _write_json(creation_path, creation)

    assert coc_turn_finalization.campaign_creation_receipt_bound_roll_ids(
        campaign_ws["campaign_dir"]
    ) == set()
    assert coc_turn_finalization.unbound_public_roll_ids(
        campaign_ws["campaign_dir"]
    ) == [creation_luck["data"]["roll_id"]]

    resumed = _run(campaign_ws, "session.resume", {})
    assert resumed["ok"] is True, resumed
    assert resumed["data"]["turn_tail_quarantine"]["quarantined_orphan_rolls"] == [
        creation_luck["data"]["roll_id"]
    ]


def test_ending_required_roll_stays_bound_and_delivery_survives_resume(campaign_ws):
    ended = _run(campaign_ws, "state.end_session", {
        "kind": "conclusion",
        "summary": "调查员在委托现场明确拒绝接案并结束调查。",
        "decision_id": "ending-with-required-luck-roll",
    })
    assert ended["ok"] is True, ended
    settlements = ended["data"]["development"]["settlements"]
    required_roll_ids = {
        roll_id
        for settlement in settlements
        for roll_id in settlement["receipt"]["player_facing_mechanics"][
            "required_roll_ids"
        ]
    }
    assert required_roll_ids

    finalized = _finalize_current_turn(
        campaign_ws, "ending-with-required-luck-roll-finalize"
    )
    assert set(finalized["data"]["source_roll_ids"]) == required_roll_ids
    acknowledged = _run(campaign_ws, "session.delivery_ack", {
        "finalization_id": finalized["data"]["finalization_id"],
        "rendered_sha256": finalized["data"]["rendered_text_sha256"],
        "ack_kind": "displayed",
        "source_id": "turn-quarantine-regression-browser",
        "decision_id": "ending-delivery-ack",
    })
    assert acknowledged["ok"] is True, acknowledged

    resumed = _run(campaign_ws, "session.resume", {})
    assert resumed["ok"] is True, resumed
    assert resumed["data"]["turn_tail_quarantine"] == {
        "quarantined_orphan_rolls": [],
        "restored_commit_snapshot": None,
        "invalidated_decisions": [],
        "discarded_development_ticks": {"queue": 0, "claims": 0, "archive": 0},
    }
    assert resumed["data"]["delivery"]["status"] == "confirmed"
    assert resumed["data"]["delivery"]["ack_kind"] == "displayed"


def test_resume_quarantines_unfinalized_turn_tail(campaign_ws):
    # Committed turn A: one SAN loss (55 -> 52), finalized.
    _san_check(campaign_ws, decision_id="committed-san", seed=1, loss_success="1D3", loss_failure="1D3")
    finalized = _finalize_current_turn(campaign_ws, "turn-a-finalize")
    finalization_id = finalized["data"]["finalization_id"]
    assert _inv_state(campaign_ws)["current_san"] == 52

    # Abandoned turn B (crash shape): rolls + state writes, no journal/finalize.
    orphan_san = _san_check(campaign_ws, decision_id="orphan-san", seed=10, loss_failure="5")
    assert orphan_san["data"]["bout_triggered"] is True
    orphan_roll = _run(
        campaign_ws,
        "rules.roll",
        {
            "investigator": campaign_ws["investigator_id"],
            "skill": "Spot Hidden",
            "target": 99,
            "seed": 2,
            "decision_id": "orphan-skill-roll",
        },
    )
    assert orphan_roll["ok"] is True, orphan_roll
    assert _inv_state(campaign_ws)["current_san"] == 47
    assert _inv_state(campaign_ws)["bout_active"] is True
    orphan_roll_ids = set(orphan_san["data"]["session_roll_ids"])
    orphan_roll_ids.add(orphan_roll["data"]["roll_id"])

    resumed = _run(campaign_ws, "session.resume", {})
    assert resumed["ok"] is True, resumed
    quarantine = resumed["data"]["turn_tail_quarantine"]
    assert set(quarantine["quarantined_orphan_rolls"]) == orphan_roll_ids
    assert quarantine["restored_commit_snapshot"] == finalization_id

    # Rolls are never rewritten or deleted; dispositions live in an
    # append-only ledger, so receipt prefix integrity survives.
    rolls = {
        row["roll_id"]: row
        for row in _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl")
    }
    for roll_id in orphan_roll_ids:
        assert "superseded" not in rolls[roll_id]
    dispositions = json.loads(
        (campaign_ws["campaign_dir"] / "save" / "roll-dispositions.json").read_text(
            encoding="utf-8"
        )
    )["dispositions"]
    for roll_id in orphan_roll_ids:
        assert dispositions[roll_id]["visibility"] == "voided"
        assert dispositions[roll_id]["reason"] == "unfinalized_turn_tail"
    events = _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "events.jsonl")
    abandoned = [row for row in events if row.get("event_type") == "turn_tail_abandoned"]
    assert len(abandoned) == 1
    assert set(abandoned[0]["roll_ids"]) == orphan_roll_ids

    # The abandoned turn's development tick is discarded, not earned later.
    assert abandoned[0]["discarded_development_ticks"]["queue"] == 1
    assert abandoned[0]["discarded_development_ticks"]["archive"] == 1
    development_log = (
        campaign_ws["coc_root"]
        / "investigators"
        / campaign_ws["investigator_id"]
        / "development.jsonl"
    )
    assert development_log.read_text(encoding="utf-8") == ""

    # Turn-scoped state restored to the commit point; bout never happened.
    assert _inv_state(campaign_ws)["current_san"] == 52
    assert _inv_state(campaign_ws)["bout_active"] is False
    assert _sanity_snapshot(campaign_ws)["san_current"] == 52
    assert _sanity_snapshot(campaign_ws)["bout_active"] is False

    # Everything is now bound or dispositioned; a second resume is a no-op.
    assert coc_turn_finalization.unbound_public_roll_ids(
        campaign_ws["campaign_dir"]
    ) == []
    resumed_again = _run(campaign_ws, "session.resume", {})
    assert resumed_again["ok"] is True, resumed_again
    assert resumed_again["data"]["turn_tail_quarantine"] == {
        "quarantined_orphan_rolls": [],
        "restored_commit_snapshot": None,
        "invalidated_decisions": [],
        "discarded_development_ticks": {"queue": 0, "claims": 0, "archive": 0},
    }

    # Idempotency evidence survives the restore for audit, but the abandoned
    # branch is no longer a valid replay source.  Reusing either decision must
    # fail closed instead of returning state that the commit restore removed.
    replayed_san = _run(
        campaign_ws,
        "rules.sanity_check",
        {
            "investigator": campaign_ws["investigator_id"],
            "source": "horror orphan-san",
            "loss_success": "0",
            "loss_failure": "5",
            "decision_id": "orphan-san",
            "seed": 10,
        },
    )
    assert replayed_san["ok"] is False
    assert replayed_san["error"]["code"] == "decision_invalidated"
    replayed_roll = _run(
        campaign_ws,
        "rules.roll",
        {
            "investigator": campaign_ws["investigator_id"],
            "skill": "Spot Hidden",
            "target": 99,
            "seed": 2,
            "decision_id": "orphan-skill-roll",
        },
    )
    assert replayed_roll["ok"] is False
    assert replayed_roll["error"]["code"] == "decision_invalidated"

    # The investigator is still usable: a fresh SAN check applies cleanly.
    after = _san_check(
        campaign_ws,
        decision_id="post-quarantine-san",
        seed=1,
        loss_success="1D3",
        loss_failure="1D3",
    )
    assert after["data"]["san_before"] == 52
    assert after["data"]["san_after"] == 49


def test_voided_turn_tail_rolls_never_reenter_later_output_context(campaign_ws):
    _san_check(
        campaign_ws,
        decision_id="committed-san-before-void-projection",
        seed=1,
        loss_success="1D3",
        loss_failure="1D3",
    )
    _finalize_current_turn(campaign_ws, "committed-before-void-projection")

    orphan = _run(
        campaign_ws,
        "rules.roll",
        {
            "investigator": campaign_ws["investigator_id"],
            "skill": "Spot Hidden",
            "target": 99,
            "seed": 2,
            "decision_id": "voided-roll-must-stay-audit-only",
        },
    )
    assert orphan["ok"] is True, orphan
    orphan_roll_id = orphan["data"]["roll_id"]

    resumed = _run(campaign_ws, "session.resume", {})
    assert resumed["ok"] is True, resumed
    assert resumed["data"]["turn_tail_quarantine"]["quarantined_orphan_rolls"] == [
        orphan_roll_id
    ]

    journaled = _run(
        campaign_ws,
        "state.journal",
        {
            "summary": "a later unrelated turn",
            "player_text": "我进行一个与作废检定无关的新行动。",
            "decision_id": "journal-after-voided-tail",
        },
    )
    assert journaled["ok"] is True, journaled
    output = _run(campaign_ws, "turn.output_context", {})
    assert output["ok"] is True, output
    assert orphan_roll_id not in output["data"]["source_roll_ids"]
    assert output["data"]["obligations"] == []
    assert output["data"]["mechanics_bundle"]["public_check"] == []
