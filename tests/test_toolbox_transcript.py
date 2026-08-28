"""Behavior tests owned by the exact transcript retrieval slice.

Covers ``transcript.locate`` and ``transcript.read``: canonical exact
historical table-transcript wording through semantic locators over the
campaign Git history — structured-only narrowing (no free-prose matching),
canonical production finalization-contract verification, identity-based
locators that cannot drift, Git-only worldline ownership with fork-point
bounds, transport-budget chunking, exact Chinese text, corruption
fail-closed, privacy/no-hash surface, and generated contract visibility.
Deterministic contracts only; semantic relevance and quoting stay with the
live KP.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import re
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"
sys.path.insert(0, str(SCRIPTS))

ARCHIVE_PATH = REPO / "plugins" / "coc-keeper" / "references" / "mcp-operation-contracts.json"
POLICY_TS_PATH = (
    REPO / "plugins" / "coc-keeper" / "pi" / "lib" / "operation-policy.generated.ts"
)

CAMP = "xscript-camp"
TIMELINE_MAIN = "tl-main"
TIMELINE_FORK = "tl-fork-a"
READ_BUDGET_CHARS = 12000

OPENING_TEXT = "开场：1925年秋，你们抵达阿卡姆的雾码头，雨下了整整一夜。"
PLAYER_1 = "我推开地窖门，想看看那阵敲击声是从哪里来的。"
KEEPER_1 = "门轴发出刺耳的声响。地窖里一片漆黑，敲击声停了，随后从楼梯下传来湿漉漉的拖行声。"
PLAYER_2 = "我举起马灯照向声音的来源。"
KEEPER_2 = "灯光扫过墙角，照出一个湿透的人影，它背对着你们，肩膀在微微起伏。"
FORK_PLAYER_2 = "平行线：我后退一步，先关上了地窖门。"
FORK_KEEPER_2 = "门板合拢的瞬间，那阵拖行声在门外停住了，像有什么贴着门站了一会儿。"
PLAYER_3 = "我退回到楼梯口，屏住呼吸。"
KEEPER_3 = "拖行声在楼梯下方绕了半圈，然后彻底消失了，只留下一地湿脚印。"
OVERSIZED_KEEPER_2 = "夜色如墨，走廊尽头传来规律的滴水声，墙壁上刻满细小的抓痕。" * 1000

JOURNAL_1 = "journal-cellar-push"
JOURNAL_2 = "journal-lantern-raise"
JOURNAL_3 = "journal-stairway-hold"
JOURNAL_FORK_2 = "journal-fork-door-close"
OPENING_SOURCE = "opening-0001"

_LOCATOR_OPS = ("transcript.locate", "transcript.read")

REF_PLAYER_1 = "xscript:tl-main:turn-1:player:player_turn:journal-cellar-push"
REF_KEEPER_1 = "xscript:tl-main:turn-1:keeper:finalized_keeper:fin-t1"
REF_OPENING = "xscript:tl-main:turn-0:keeper:table_opening:opening-0001"


def _digest(value) -> str:
    encoded = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def _entry_id(role: str, source_id: str) -> str:
    payload = json.dumps(
        ["table-transcript-v1", role, source_id],
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    return f"table-transcript-v1:{hashlib.sha256(payload).hexdigest()[:40]}"


def _row(
    *,
    role: str,
    kind: str,
    turn: int,
    turn_id: str,
    journal: str,
    speaker: str,
    text: str,
    source_id: str,
    finalization_id: str | None = None,
    revision: int | None = None,
    run_segment_id: str = "run-0001",
    session_id: str = "session-0001",
) -> dict:
    if kind == "finalized_keeper":
        source_ref = f"logs/turn-finalizations.jsonl#{finalization_id}"
        rendered_sha = _digest(text)
    elif kind == "table_opening":
        source_ref = f"table.opening#{source_id}"
        rendered_sha = None
    else:
        source_ref = f"state.journal#{journal}"
        rendered_sha = None
    return {
        "schema_version": 1,
        "entry_id": _entry_id(role, source_id),
        "run_id": run_segment_id,
        "run_segment_id": run_segment_id,
        "run_segment_source": "table_opening",
        "run_segment_trust": "authoritative",
        "session_id": session_id,
        "session_source": "host_context",
        "session_trust": "observed",
        "turn": turn,
        "turn_id": turn_id,
        "journal_decision_id": journal,
        "role": role,
        "speaker": speaker,
        "text": text,
        "text_sha256": _digest(text),
        "source_id": source_id,
        "source_ref": source_ref,
        "record_kind": kind,
        "finalization_id": finalization_id,
        "accepted_revision": revision,
        "rendered_text_sha256": rendered_sha,
        "ts": "2026-08-27T00:00:00Z",
    }


def _receipt(
    *,
    finalization_id: str,
    journal: str,
    turn_id: str,
    rendered: str,
    player_text: str,
    revision: int = 1,
    run_segment_id: str = "run-0001",
    session_id: str = "session-0001",
) -> dict:
    """A receipt fully valid under the canonical production finalization
    contract (asserted against ``coc_turn_finalization._valid_finalization``
    in tests): closed field set, pure-fiction segment composition with empty
    source ids, all structural hashes, projection bindings, and the
    integrity digest."""
    projection = {
        "schema_version": 1,
        "run_segment_id": run_segment_id,
        "session_id": session_id,
        "turn_id": turn_id,
        "source_digest": "sha256:" + "0" * 64,
        "settlement_snapshot_id": f"settle-{finalization_id}",
        "player_input": {
            "source_ref": f"player_input:{journal}",
            "text_sha256": _digest(player_text),
            "text": player_text,
        },
    }
    receipt = {
        "schema_version": 2,
        "finalization_id": finalization_id,
        "decision_id": f"finalize-{finalization_id}",
        "run_segment_id": run_segment_id,
        "session_id": session_id,
        "turn_id": turn_id,
        "journal_decision_id": journal,
        "journal_call_index": 1,
        "source_start_index": 0,
        "source_end_index": 1,
        "source_digest": "sha256:" + "0" * 64,
        "source_roll_ids": [],
        "obligation_ids": [],
        "coverage_ids": [],
        "settlement_snapshot_id": f"settle-{finalization_id}",
        "accepted_revision": revision,
        "accepted_draft_sha256": _digest(rendered),
        "rendered_text_sha256": _digest(rendered),
        "contract_projection_sha256": _digest(projection),
        "coverage_sha256": _digest([]),
        "bundle_sha256": _digest({}),
        "narration_review": None,
        "agency_claims": [],
        "contract_projection": projection,
        "bundle": {},
        "coverage": [],
        "segments": [{"segment_type": "fiction", "text": rendered, "source_ids": []}],
        "rendered_text": rendered,
    }
    receipt["integrity_digest"] = _digest(receipt)
    return receipt


def _turn_bundle(
    turn: int, journal: str, player_text: str, keeper_text: str,
    finalization_id: str, *, run_segment_id: str = "run-0001",
    session_id: str = "session-0001",
) -> tuple[list[dict], list[dict]]:
    turn_id = f"turn-{turn:04d}"
    rows = [
        _row(
            role="player", kind="player_turn", turn=turn, turn_id=turn_id,
            journal=journal, speaker="陈默", text=player_text,
            source_id=journal, run_segment_id=run_segment_id,
            session_id=session_id,
        ),
        _row(
            role="keeper", kind="finalized_keeper", turn=turn, turn_id=turn_id,
            journal=journal, speaker="KP", text=keeper_text,
            source_id=finalization_id, finalization_id=finalization_id,
            revision=1, run_segment_id=run_segment_id, session_id=session_id,
        ),
    ]
    receipts = [
        _receipt(
            finalization_id=finalization_id, journal=journal, turn_id=turn_id,
            rendered=keeper_text, player_text=player_text,
            run_segment_id=run_segment_id, session_id=session_id,
        ),
    ]
    return rows, receipts


_MAIN_TURN_1_ROWS, _MAIN_TURN_1_RECEIPTS = _turn_bundle(
    1, JOURNAL_1, PLAYER_1, KEEPER_1, "fin-t1"
)
_MAIN_TURN_2_ROWS, _MAIN_TURN_2_RECEIPTS = _turn_bundle(
    2, JOURNAL_2, PLAYER_2, KEEPER_2, "fin-t2"
)
_MAIN_TURN_3_ROWS, _MAIN_TURN_3_RECEIPTS = _turn_bundle(
    3, JOURNAL_3, PLAYER_3, KEEPER_3, "fin-t3"
)
_FORK_TURN_2_ROWS, _FORK_TURN_2_RECEIPTS = _turn_bundle(
    2, JOURNAL_FORK_2, FORK_PLAYER_2, FORK_KEEPER_2, "fin-f2"
)
_OPENING_ROW = _row(
    role="keeper", kind="table_opening", turn=0,
    turn_id="opening:run-0001", journal="", speaker="KP",
    text=OPENING_TEXT, source_id=OPENING_SOURCE,
)

_VARIANTS = (
    "corrupt_text_hash", "receipt_wording_mismatch", "receipt_integrity_corrupt",
    "row_run_mismatch", "row_session_mismatch", "row_turn_id_mismatch",
    "row_revision_mismatch", "player_run_mismatch", "player_turn_id_mismatch",
    "duplicate_identity", "malformed_jsonl", "oversized_text",
    "opening_coordinated_tamper",
)


# --------------------------------------------------------------------------- #
# Git workspace fixtures
# --------------------------------------------------------------------------- #

def _worktree(root: Path) -> Path:
    return root / ".coc" / "campaigns" / CAMP


def _repo(root: Path) -> Path:
    return root / ".coc" / "repos" / "campaigns" / f"{CAMP}.git"


def _env() -> dict[str, str]:
    env = os.environ.copy()
    env["GIT_CONFIG_NOSYSTEM"] = "1"
    env["GIT_CONFIG_GLOBAL"] = os.devnull
    env["GIT_CONFIG_SYSTEM"] = os.devnull
    env["GIT_TERMINAL_PROMPT"] = "0"
    return env


def _git(*args: str, cwd: Path) -> str:
    cmd = [
        "git",
        "-c", "user.name=xscript-test",
        "-c", "user.email=xscript-test@localhost",
        "-c", "commit.gpgsign=false",
        *args,
    ]
    completed = subprocess.run(
        cmd, cwd=str(cwd), env=_env(), capture_output=True, text=True,
        encoding="utf-8", check=False,
    )
    assert completed.returncode == 0, f"git {args} failed: {completed.stderr}"
    return completed.stdout


def _write(worktree: Path, relpath: str, text: str) -> None:
    path = worktree / relpath
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def _jsonl(rows: list[dict]) -> str:
    return "".join(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n"
                   for row in rows)


def _opening_evidence(row: dict) -> dict:
    """Tracked canonical evidence.table_opening toolbox receipt matching
    the production audit shape. It is deliberately a separate JSONL record
    from the transcript row so coordinated transcript/self-id edits fail."""
    return {
        "schema_version": 2,
        "ts": "2026-08-27T00:00:01Z",
        "tool": "evidence.table_opening",
        "ok": True,
        "access": "mutation",
        "args": {
            "decision_id": row["source_id"],
            "run_id": row["run_id"],
            "presented_roll_ids": [],
        },
        "data": dict(row),
        "visibility": "keeper_internal",
        "warnings": [],
        "hints": [],
        "attempt": 1,
        "max_attempts": 1,
        "retryable": False,
        "will_retry": False,
        "turn_number": 0,
    }


def _commit(worktree: Path, subject: str, trailers: list[tuple[str, str]]) -> str:
    message = subject + "\n\n" + "\n".join(f"{k}: {v}" for k, v in trailers)
    _git("add", "-A", "--", ".", cwd=worktree)
    _git("commit", "--allow-empty", "-m", message, cwd=worktree)
    return _git("rev-parse", "HEAD", cwd=worktree).strip()


def _turn2_rows_for_variant(variant: str | None) -> tuple[list[dict], list[dict]]:
    if variant == "oversized_text":
        return _turn_bundle(2, JOURNAL_2, PLAYER_2, OVERSIZED_KEEPER_2, "fin-t2")
    return _MAIN_TURN_2_ROWS, _MAIN_TURN_2_RECEIPTS


def _apply_variant_to_turn1(variant: str | None) -> tuple[list[dict], list[dict]]:
    rows = [dict(row) for row in [ _OPENING_ROW, *_MAIN_TURN_1_ROWS ]]
    receipts = [dict(row) for row in _MAIN_TURN_1_RECEIPTS]
    if variant == "corrupt_text_hash":
        rows[1]["text"] = PLAYER_1 + "（附加的伪造句）"
        # text_sha256 left pointing at the original wording.
    elif variant == "receipt_wording_mismatch":
        # Both sides hash-consistent internally, but the transcript row's
        # wording no longer matches the immutable receipt rendering.
        rows[2]["text"] = KEEPER_1 + "（被改写过的句子）"
        rows[2]["text_sha256"] = _digest(rows[2]["text"])
        rows[2]["rendered_text_sha256"] = _digest(KEEPER_1)
    elif variant == "row_run_mismatch":
        rows[2]["run_segment_id"] = "run-9999"
    elif variant == "row_session_mismatch":
        rows[2]["session_id"] = "session-9999"
    elif variant == "row_turn_id_mismatch":
        rows[2]["turn_id"] = "turn-9999"
    elif variant == "row_revision_mismatch":
        rows[2]["accepted_revision"] = 2
    elif variant == "player_run_mismatch":
        rows[1]["run_segment_id"] = "run-9999"
    elif variant == "player_turn_id_mismatch":
        rows[1]["turn_id"] = "turn-9999"
    elif variant == "opening_coordinated_tamper":
        # Recompute every transcript-local field an attacker can derive from
        # the row. The independent toolbox evidence stays canonical.
        rows[0]["source_id"] = "opening-tampered"
        rows[0]["source_ref"] = "table.opening#opening-tampered"
        rows[0]["entry_id"] = _entry_id("keeper", "opening-tampered")
        rows[0]["text"] = "被协调篡改的开场台词。"
        rows[0]["text_sha256"] = _digest(rows[0]["text"])
    return rows, receipts


def build_workspace(
    tmp_path: Path,
    *,
    fork: bool = False,
    confluence: bool = False,
    post_fork_main_turn: bool = False,
    variant: str | None = None,
    opening_source: str = OPENING_SOURCE,
    write_name: str = "workspace",
) -> dict:
    """Synthetic campaign with baseline + turn 1 + turn 2 commits, the
    sidecar bare repo, and optional Git-only worldlines (fork branch,
    real two-parent confluence merge). ``variant`` injects one adversarial
    defect into the committed evidence."""
    root = tmp_path / write_name
    worktree = _worktree(root)
    worktree.mkdir(parents=True)
    _git("init", "-b", "main", cwd=worktree)

    _write(worktree, "campaign.json",
           json.dumps({"campaign_id": CAMP, "title": "transcript ops"}) + "\n")
    _write(worktree, "party.json", json.dumps({"members": []}) + "\n")
    _write(worktree, "save/world-state.json", '{"day": 1}\n')
    baseline_sha = _commit(worktree, "coc baseline", [
        ("COC-Commit-Type", "baseline"),
        ("Campaign-Id", CAMP),
        ("Timeline-Id", TIMELINE_MAIN),
    ])

    turn1_rows, turn1_receipts = _apply_variant_to_turn1(variant)
    if opening_source != OPENING_SOURCE:
        # Colon-bearing opening decisions are valid semantic ids and must
        # round-trip through the escaped locator grammar.
        opening = turn1_rows[0]
        opening["source_id"] = opening_source
        opening["source_ref"] = f"table.opening#{opening_source}"
        opening["entry_id"] = _entry_id("keeper", opening_source)
    if variant == "receipt_integrity_corrupt":
        # Corrupt the turn-1 receipt in the turn-1 commit itself: flip a
        # bound field without recomputing the integrity digest.
        turn1_receipts = [dict(turn1_receipts[0])]
        turn1_receipts[0]["turn_id"] = "turn-9999"
    _write(worktree, "logs/table-transcript.jsonl", _jsonl(turn1_rows))
    # For a coordinated opening tamper, preserve the original canonical
    # receipt rather than reflecting the forged transcript row.
    evidence_row = (
        _OPENING_ROW if variant == "opening_coordinated_tamper" else turn1_rows[0]
    )
    _write(worktree, "logs/toolbox-calls.jsonl", _jsonl([_opening_evidence(evidence_row)]))
    _write(worktree, "logs/turn-finalizations.jsonl", _jsonl(turn1_receipts))
    sha_t1 = _commit(worktree, "coc turn 0001", [
        ("COC-Commit-Type", "turn"),
        ("Campaign-Id", CAMP),
        ("Timeline-Id", TIMELINE_MAIN),
        ("Turn-Number", "1"),
        ("Finalization-Id", "fin-t1"),
    ])

    turn2_rows, turn2_receipts = _turn2_rows_for_variant(variant)
    transcript_rows = turn1_rows + turn2_rows
    finalization_receipts = turn1_receipts + turn2_receipts
    if variant == "duplicate_identity":
        # A second player row reusing the same canonical journal identity
        # (and therefore the same canonical entry id).
        transcript_rows.append(dict(turn2_rows[0], text="重复身份的伪造台词。"))
        transcript_rows[-1]["text_sha256"] = _digest(transcript_rows[-1]["text"])
    _write(worktree, "save/world-state.json", '{"day": 2}\n')
    _write(worktree, "logs/table-transcript.jsonl", _jsonl(transcript_rows))
    transcript_text = _jsonl(transcript_rows)
    if variant == "malformed_jsonl":
        transcript_text = transcript_text + "这不是JSON{{{\n"
    _write(worktree, "logs/table-transcript.jsonl", transcript_text)
    _write(worktree, "logs/turn-finalizations.jsonl",
           _jsonl(finalization_receipts))
    _commit(worktree, "coc turn 0002", [
        ("COC-Commit-Type", "turn"),
        ("Campaign-Id", CAMP),
        ("Timeline-Id", TIMELINE_MAIN),
        ("Turn-Number", "2"),
        ("Finalization-Id", "fin-t2"),
    ])

    extra_records: list[dict] = []

    def add_worldline(timeline_id: str, rows: list[dict], receipts: list[dict],
                      finalization_id: str) -> None:
        _git("checkout", "-q", "-b", timeline_id, sha_t1, cwd=worktree)
        _write(worktree, "logs/table-transcript.jsonl",
               _jsonl(turn1_rows + rows))
        _write(worktree, "logs/turn-finalizations.jsonl",
               _jsonl(turn1_receipts + receipts))
        _write(worktree, "save/world-state.json",
               f'{{"day": 2, "tl": "{timeline_id}"}}\n')
        _commit(worktree, f"coc turn 0002 on {timeline_id}", [
            ("COC-Commit-Type", "turn"),
            ("Campaign-Id", CAMP),
            ("Timeline-Id", timeline_id),
            ("Turn-Number", "2"),
            ("Finalization-Id", finalization_id),
        ])
        extra_records.append({
            "timeline_id": timeline_id,
            "campaign_id": CAMP,
            "kind": "fork",
            "parents": [TIMELINE_MAIN],
            "fork_point": {
                "commit": sha_t1, "turn": 1,
                "episode_id": f"episode-{timeline_id}",
            },
            "created_by": "kp_decision",
        })

    if fork:
        add_worldline(TIMELINE_FORK, _FORK_TURN_2_ROWS, _FORK_TURN_2_RECEIPTS,
                      "fin-f2")
    if confluence:
        for branch, journal, player_text, keeper_text, fin in (
            ("tl-b", "journal-b-act", "岔路B：我沿走廊向左。", "走廊尽头是一扇上锁的铁门。", "fin-b2"),
            ("tl-c", "journal-c-act", "岔路C：我贴着墙向右摸。", "右侧的储物间里堆着发霉的木箱。", "fin-c2"),
        ):
            rows, receipts = _turn_bundle(2, journal, player_text, keeper_text, fin)
            add_worldline(branch, rows, receipts, fin)
        # A real two-parent Git merge: tl-merge's commit-DAG ancestry
        # genuinely contains both parents' turn-2 commits.
        _git("checkout", "-q", "-b", "tl-merge", "tl-b", cwd=worktree)
        _git(
            "merge", "-q", "-s", "ours",
            "-m", "coc confluence merge\n\nCOC-Commit-Type: confluence\nTimeline-Id: tl-merge",
            "tl-c",
            cwd=worktree,
        )
        extra_records.append({
            "timeline_id": "tl-merge",
            "campaign_id": CAMP,
            "kind": "confluence",
            "parents": ["tl-b", "tl-c"],
            "fork_point": {
                "commit": sha_t1, "turn": 1, "episode_id": "episode-merge",
            },
            "created_by": "confluence",
        })
    if post_fork_main_turn:
        # A parent-worldline turn committed AFTER the fork exists: it is on
        # tl-main's tip but must never be inherited by the fork.
        _git("checkout", "-q", "main", cwd=worktree)
        _write(worktree, "logs/table-transcript.jsonl",
               _jsonl(transcript_rows + _MAIN_TURN_3_ROWS))
        _write(worktree, "logs/turn-finalizations.jsonl",
               _jsonl(finalization_receipts + _MAIN_TURN_3_RECEIPTS))
        _write(worktree, "save/world-state.json", '{"day": 3}\n')
        _commit(worktree, "coc turn 0003", [
            ("COC-Commit-Type", "turn"),
            ("Campaign-Id", CAMP),
            ("Timeline-Id", TIMELINE_MAIN),
            ("Turn-Number", "3"),
            ("Finalization-Id", "fin-t3"),
        ])
    else:
        _git("checkout", "-q", "main", cwd=worktree)

    _git("init", "--bare", "-b", "main", str(_repo(root)), cwd=worktree)
    _git("push", str(_repo(root)), "main", cwd=worktree)
    for record in extra_records:
        _git(
            "push", str(_repo(root)),
            f"{record['timeline_id']}:refs/heads/timelines/{record['timeline_id']}",
            cwd=worktree,
        )
    _write(worktree, "save/timeline-state.json", json.dumps({
        "schema_generation": "timeline-state-1",
        "campaign_id": CAMP,
        "active_timeline_id": TIMELINE_MAIN,
        "timelines": [
            {
                "timeline_id": TIMELINE_MAIN,
                "campaign_id": CAMP,
                "kind": "root",
                "parents": [],
                "fork_point": None,
                "created_by": "initial",
            },
            *extra_records,
        ],
        "confluences": [],
        "game_reasons": {},
    }, ensure_ascii=False, indent=2) + "\n")
    return {"workspace": root, "campaign_id": CAMP}


def add_post_opening_transcript_commits(
    ws: dict, *, count: int, mutate_opening: bool = False
) -> None:
    """Append transcript-changing checkpoint commits without changing turn
    ownership. Used to prove opening resolution comes from the oldest Git
    path blob rather than a moving recent-commit window."""
    worktree = _worktree(ws["workspace"])
    transcript_path = worktree / "logs" / "table-transcript.jsonl"
    rows = [
        json.loads(line)
        for line in transcript_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    if mutate_opening:
        opening = rows[0]
        opening["text"] = "后续检查点中被伪造的开场台词。"
        opening["text_sha256"] = _digest(opening["text"])
    payload = _jsonl(rows)
    for index in range(count):
        # Blank lines are harmless JSONL formatting but make each commit a
        # real transcript-path mutation. The first checkpoint retains the
        # optional forged opening, later ones prove >200 horizon stability.
        payload += "\n"
        _write(worktree, "logs/table-transcript.jsonl", payload)
        _commit(worktree, f"transcript checkpoint {index + 1:04d}", [
            ("COC-Commit-Type", "checkpoint"),
            ("Campaign-Id", CAMP),
            ("Timeline-Id", TIMELINE_MAIN),
        ])
    _git("push", str(_repo(ws["workspace"])), "main", cwd=worktree)


def add_tip_rewrite_checkpoint(ws: dict) -> None:
    """Commit a deliberately rewritten old row in a later aggregate blob.
    Range/speaker locate must still source that row from its owning turn
    commit, not this tip checkpoint."""
    worktree = _worktree(ws["workspace"])
    transcript_path = worktree / "logs" / "table-transcript.jsonl"
    rows = [
        json.loads(line)
        for line in transcript_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    player_one = next(row for row in rows if row.get("source_id") == JOURNAL_1)
    player_one["speaker"] = "后来改写者"
    player_one["text"] = "后续聚合日志中被改写的第一回合玩家台词。"
    player_one["text_sha256"] = _digest(player_one["text"])
    _write(worktree, "logs/table-transcript.jsonl", _jsonl(rows))
    _commit(worktree, "transcript tip rewrite", [
        ("COC-Commit-Type", "checkpoint"),
        ("Campaign-Id", CAMP),
        ("Timeline-Id", TIMELINE_MAIN),
    ])
    _git("push", str(_repo(ws["workspace"])), "main", cwd=worktree)


def add_main_turn(ws: dict, turn: int) -> None:
    """Commit an additional settled turn on the main worldline tip."""
    worktree = _worktree(ws["workspace"])
    rows, receipts = _turn_bundle(
        turn, f"journal-extra-{turn}",
        f"追加的第{turn} turn玩家台词。", f"追加的第{turn} turn Keeper措辞。",
        f"fin-extra-{turn}",
    )
    transcript_path = worktree / "logs" / "table-transcript.jsonl"
    existing = [
        json.loads(line)
        for line in transcript_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    finals_path = worktree / "logs" / "turn-finalizations.jsonl"
    existing_finals = [
        json.loads(line)
        for line in finals_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    _write(worktree, "logs/table-transcript.jsonl", _jsonl(existing + rows))
    _write(worktree, "logs/turn-finalizations.jsonl",
           _jsonl(existing_finals + receipts))
    _commit(worktree, f"coc turn {turn:04d}", [
        ("COC-Commit-Type", "turn"),
        ("Campaign-Id", CAMP),
        ("Timeline-Id", TIMELINE_MAIN),
        ("Turn-Number", str(turn)),
        ("Finalization-Id", f"fin-extra-{turn}"),
    ])
    # The commit coordinator publishes every turn to the sidecar bare repo;
    # immutable resolution reads only that repo.
    _git("push", str(_repo(ws["workspace"])), "main", cwd=worktree)


@pytest.fixture(autouse=True)
def isolated_git_home(tmp_path, monkeypatch):
    home = tmp_path / "_empty_home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    for key in (
        "XDG_CONFIG_HOME", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_SYSTEM",
        "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE",
        "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL",
        "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL",
    ):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.delenv("COC_HOST", raising=False)


_PRIVATE_MODULE_ALIASES = {
    "coc_toolbox": "coc_toolbox_transcript",
    "coc_mcp_contract_archive": "coc_mcp_contract_archive_transcript",
    "coc_turn_finalization": "coc_turn_finalization_transcript",
}


@pytest.fixture(scope="module", autouse=True)
def fresh_dispatch_modules():
    """Purge cross-suite coc_* module generations once for this test module.

    The snapshot/restore boundary still isolates this slice from other test
    files, while module scope avoids reloading the full toolbox for every
    one of its deterministic Git fixtures (keeping full transcript
    attestation within the runtime verify budget)."""
    host = sys.modules[__name__]
    canonical_snapshot = {
        key: module
        for key, module in list(sys.modules.items())
        if key.startswith("coc_")
    }
    original_globals = {
        canonical: getattr(host, canonical, None)
        for canonical in _PRIVATE_MODULE_ALIASES
    }
    try:
        for key in canonical_snapshot:
            del sys.modules[key]

        def _load(name: str, path: Path):
            spec = importlib.util.spec_from_file_location(name, path)
            module = importlib.util.module_from_spec(spec)
            assert spec.loader is not None
            spec.loader.exec_module(module)
            return module

        host.coc_toolbox = _load("coc_toolbox_transcript", SCRIPTS / "coc_toolbox.py")
        host.coc_mcp_contract_archive = _load(
            "coc_mcp_contract_archive_transcript",
            SCRIPTS / "coc_mcp_contract_archive.py",
        )
        host.coc_turn_finalization = _load(
            "coc_turn_finalization_transcript",
            SCRIPTS / "coc_turn_finalization.py",
        )
        yield
    finally:
        stale_keys = [name for name in list(sys.modules) if name.startswith("coc_")]
        for key in stale_keys:
            del sys.modules[key]
        sys.modules.update(canonical_snapshot)
        for canonical, value in original_globals.items():
            if value is not None:
                setattr(host, canonical, value)
            else:
                try:
                    delattr(host, canonical)
                except AttributeError:
                    pass


def _run(ws: dict, tool: str, args: dict | None = None) -> dict:
    return coc_toolbox.run_tool(
        tool, ws["workspace"], ws["campaign_id"], args or {}
    )


def _data(ws: dict, tool: str, args: dict | None = None) -> dict:
    result = _run(ws, tool, args)
    assert result["ok"] is True, result
    return result["data"]


def _error(ws: dict, tool: str, args: dict | None = None) -> dict:
    result = _run(ws, tool, args)
    assert result["ok"] is False, result
    return result["error"]


def _locate(ws: dict, **selectors) -> dict:
    return _data(ws, "transcript.locate", selectors)


def _read_refs(ws: dict, refs: list[str], **extra) -> dict:
    return _data(ws, "transcript.read", {"refs": refs, **extra})


def _no_internal_hash_values(node, *, allow_text_digest: bool = False) -> None:
    """No machine-internal integrity evidence on the model surface: no key
    may carry sha/digest/parents/files, and no value may be a raw commit
    sha. The full-text digest on read rows is the one deliberate,
    code-attached exception."""
    if isinstance(node, dict):
        for key, value in node.items():
            if allow_text_digest and key == "text_sha256":
                assert isinstance(value, str) and value.startswith("sha256:")
                continue
            assert not re.search(r"sha|digest|parents|files", str(key)), key
            _no_internal_hash_values(value, allow_text_digest=allow_text_digest)
    elif isinstance(node, list):
        for item in node:
            _no_internal_hash_values(item, allow_text_digest=allow_text_digest)
    elif isinstance(node, str):
        assert not re.fullmatch(r"[0-9a-f]{40}", node), node


# --------------------------------------------------------------------------- #
# Fixture validity under the canonical production finalization contract
# --------------------------------------------------------------------------- #

def test_fixture_receipts_satisfy_the_canonical_production_contract():
    """The synthetic receipts are not a weaker local subset: every fixture
    receipt must pass the production validator exactly as written."""
    for receipt in (
        *_MAIN_TURN_1_RECEIPTS, *_MAIN_TURN_2_RECEIPTS,
        *_MAIN_TURN_3_RECEIPTS, *_FORK_TURN_2_RECEIPTS,
    ):
        assert coc_turn_finalization._valid_finalization(receipt), (
            receipt["finalization_id"]
        )


# --------------------------------------------------------------------------- #
# Registration, policy, and generated contract visibility
# --------------------------------------------------------------------------- #

def test_transcript_operations_registered_with_policy():
    for name in _LOCATOR_OPS:
        assert name in coc_toolbox.TOOLS
        spec = coc_toolbox.TOOLS[name]
        policy = coc_toolbox.operation_policy(name)
        assert spec["access"] == "query"
        assert spec["strict_read_only"] is True
        assert spec["write_domains"] == ()
        assert spec["recovery_domains"] == ()
        assert spec["response_mode"] == "full"
        assert spec["audit_mode"] == "reference"
        assert spec["execution_class"] == "serial_campaign"
        assert policy["audience"] == "keeper"
        assert policy["contract"] == "none"
        assert policy["kp_surface"] == "context"
    # Legal in live turns and recovery only — deliberately NOT during
    # pending_finalization, where the settled-output boundary governs.
    phases = coc_toolbox.operation_policy("transcript.locate")["phases"]
    assert phases == ["live_turn", "recovery"]
    assert "pending_finalization" not in phases
    assert coc_toolbox.operation_policy("transcript.read")["phases"] == [
        "live_turn", "recovery",
    ]


def test_typed_schemas_are_semantic_only():
    archive = coc_mcp_contract_archive.build_archive(coc_toolbox)
    expected_params = {
        "transcript.locate": {
            "timeline", "turn", "turn_from", "turn_to", "role", "speaker",
            "turn_id", "journal_decision_id", "finalization_id",
            "offset", "limit",
        },
        "transcript.read": {"refs", "text_offset", "text_limit"},
    }
    for name, params in expected_params.items():
        schema = archive["operations"][name]["inputSchema"]
        assert schema["additionalProperties"] is False
        assert set(schema["properties"]) == params | {"root", "campaign"}
        for key in schema["properties"]:
            assert not re.search(r"sha|digest|commit", key), (name, key)
        assert "campaign" in schema["required"]
    locate_schema = archive["operations"]["transcript.locate"]["inputSchema"]
    # No free-prose channel exists on the locate surface at all.
    for banned in ("text", "query", "keyword", "search", "needle", "prompt"):
        assert banned not in locate_schema["properties"]
    read_schema = archive["operations"]["transcript.read"]["inputSchema"]
    assert set(read_schema["required"]) == {"campaign", "refs"}
    assert read_schema["properties"]["refs"]["minItems"] == 1
    assert read_schema["properties"]["refs"]["maxItems"] == 8
    assert read_schema["properties"]["refs"]["uniqueItems"] is True
    role_enum = locate_schema["properties"]["role"]["enum"]
    assert role_enum == ["player", "keeper"]


def test_generated_catalog_and_policy_projection_pick_up_the_slice():
    archive = coc_mcp_contract_archive.load_and_validate(ARCHIVE_PATH)
    for name in _LOCATOR_OPS:
        assert name in archive["operations"]
        contract = archive["operations"][name]
        assert contract["policy"]["kp_surface"] == "context"
        assert contract["access"] == "query"
        assert contract["policy"]["phases"] == ["live_turn", "recovery"]
    projection = coc_mcp_contract_archive.validate_policy_projection(
        POLICY_TS_PATH, coc_toolbox
    )
    for name in _LOCATOR_OPS:
        assert projection["operation_policy"][name]["kp_surface"] == "context"
        assert name in projection["operations_by_surface"]["context"]
    policy_ts = POLICY_TS_PATH.read_text(encoding="utf-8")
    for name in _LOCATOR_OPS:
        assert f'"{name}"' in policy_ts


# --------------------------------------------------------------------------- #
# transcript.locate behavior
# --------------------------------------------------------------------------- #

def test_locate_narrows_by_turn_role_and_returns_semantic_identity_cards(tmp_path):
    ws = build_workspace(tmp_path)
    located = _locate(ws, timeline=TIMELINE_MAIN, turn=1)
    assert located["status"] == "matched"
    assert located["total_matches"] == 2
    assert located["timeline_id"] == TIMELINE_MAIN
    refs = {card["transcript_ref"] for card in located["candidates"]}
    assert refs == {REF_PLAYER_1, REF_KEEPER_1}
    player_card = next(
        card for card in located["candidates"] if card["role"] == "player"
    )
    assert player_card == {
        "transcript_ref": REF_PLAYER_1,
        "turn": 1,
        "turn_id": "turn-0001",
        "role": "player",
        "speaker": "陈默",
        "record_kind": "player_turn",
        "journal_decision_id": JOURNAL_1,
        "finalization_id": None,
        "text_char_count": len(PLAYER_1),
        "read_operation": "transcript.read",
    }
    keeper_card = next(
        card for card in located["candidates"] if card["role"] == "keeper"
    )
    assert keeper_card["finalization_id"] == "fin-t1"
    # Candidate cards never carry the wording and never carry a hash.
    assert "text" not in keeper_card
    _no_internal_hash_values(located)


def test_locate_by_speaker_journal_and_finalization_identity(tmp_path):
    ws = build_workspace(tmp_path)
    by_speaker = _locate(ws, speaker="陈默")
    assert by_speaker["total_matches"] == 2
    assert all(card["role"] == "player" for card in by_speaker["candidates"])
    by_journal = _locate(ws, journal_decision_id=JOURNAL_2)
    # The journal identity owns the player row and its settled keeper row.
    assert by_journal["total_matches"] == 2
    assert {card["role"] for card in by_journal["candidates"]} == {"player", "keeper"}
    assert all(card["turn"] == 2 for card in by_journal["candidates"])
    by_finalization = _locate(ws, finalization_id="fin-t2")
    assert by_finalization["total_matches"] == 1
    assert by_finalization["candidates"][0]["turn"] == 2
    by_kp_speaker = _locate(ws, speaker="KP", turn=0)
    assert by_kp_speaker["total_matches"] == 1
    assert by_kp_speaker["candidates"][0]["record_kind"] == "table_opening"


def test_locate_range_paging_and_no_result(tmp_path):
    ws = build_workspace(tmp_path)
    page_one = _locate(ws, turn_from=0, turn_to=2, offset=0, limit=2)
    assert page_one["total_matches"] == 5
    assert page_one["status"] == "matched"
    assert len(page_one["candidates"]) == 2
    assert page_one["next_offset"] == 2
    # Deterministic file order: opening row first.
    assert page_one["candidates"][0]["record_kind"] == "table_opening"
    page_three = _locate(ws, turn_from=0, turn_to=2, offset=4, limit=2)
    assert len(page_three["candidates"]) == 1
    assert page_three["next_offset"] is None
    beyond = _locate(ws, turn_from=0, turn_to=2, offset=5, limit=2)
    assert beyond["candidates"] == []
    assert beyond["total_matches"] == 5
    nobody = _locate(ws, speaker="不存在的发言者")
    assert nobody["status"] == "no_match"
    assert nobody["total_matches"] == 0
    assert nobody["candidates"] == []
    assert nobody["next_offset"] is None


def test_locate_rejects_free_prose_shape_and_bad_paging(tmp_path):
    ws = build_workspace(tmp_path)
    # At least one structured narrowing selector is required.
    error = _error(ws, "transcript.locate", {})
    assert error["code"] == "invalid_param"
    error = _error(ws, "transcript.locate", {"offset": 0, "limit": 2})
    assert error["code"] == "invalid_param"
    error = _error(ws, "transcript.locate", {"role": "narrator"})
    assert error["code"] == "invalid_param"
    error = _error(ws, "transcript.locate", {"turn_from": 2, "turn_to": 1})
    assert error["code"] == "invalid_param"
    error = _error(ws, "transcript.locate", {"turn_from": 0, "turn_to": 201})
    assert error["code"] == "invalid_param"
    error = _error(ws, "transcript.locate", {"turn": 1, "limit": 9})
    assert error["code"] == "invalid_param"
    error = _error(ws, "transcript.locate", {"turn": 1, "limit": 0})
    assert error["code"] == "invalid_param"
    error = _error(ws, "transcript.locate", {"turn": -1})
    assert error["code"] == "invalid_param"
    error = _error(ws, "transcript.locate", {"timeline": "not-semantic"})
    assert error["code"] == "invalid_param"
    error = _error(ws, "transcript.locate", {"turn": 1, "timeline": "tl-ghost"})
    assert error["code"] == "invalid_state"


# --------------------------------------------------------------------------- #
# transcript.read behavior: exact verified wording
# --------------------------------------------------------------------------- #

def test_read_returns_exact_chinese_wording_with_bindings(tmp_path):
    ws = build_workspace(tmp_path)
    located = _locate(ws, turn_from=0, turn_to=2, limit=5)
    refs = [card["transcript_ref"] for card in located["candidates"]]
    data = _read_refs(ws, refs)
    assert data["row_count"] == 5
    assert data["complete"] is True
    by_ref = {row["transcript_ref"]: row for row in data["rows"]}
    opening = by_ref[REF_OPENING]
    assert opening["text"] == OPENING_TEXT
    assert opening["speaker"] == "KP"
    assert "table_opening_evidence" in opening["verified_bindings"]
    player1 = by_ref[REF_PLAYER_1]
    assert player1["text"] == PLAYER_1
    assert player1["journal_decision_id"] == JOURNAL_1
    assert player1["source_ref"] == f"state.journal#{JOURNAL_1}"
    assert "journal_receipt+player_input" in player1["verified_bindings"]
    keeper1 = by_ref[REF_KEEPER_1]
    assert keeper1["text"] == KEEPER_1
    assert keeper1["finalization_id"] == "fin-t1"
    assert "turn_finalization_receipt" in keeper1["verified_bindings"]
    keeper2 = by_ref["xscript:tl-main:turn-2:keeper:finalized_keeper:fin-t2"]
    assert keeper2["text"] == KEEPER_2
    for row in data["rows"]:
        assert row["integrity"] == "verified"
        assert row["inherited"] is False
        assert row["timeline_id"] == TIMELINE_MAIN
        assert row["continuation"] is None
        # The full-text digest is the one code-attached integrity field and
        # it binds the exact stored wording.
        assert row["text_sha256"] == _digest(row["text"])
    _no_internal_hash_values(data, allow_text_digest=True)


def test_read_resolves_each_turn_through_its_own_commit(tmp_path):
    ws = build_workspace(tmp_path)
    # Turn 1 wording reads from the turn-1 commit even though turn 2 is the tip.
    turn1_only = _read_refs(ws, [REF_KEEPER_1])
    assert turn1_only["rows"][0]["turn"] == 1
    assert turn1_only["rows"][0]["text"] == KEEPER_1


def test_read_worldline_fork_reads(tmp_path):
    ws = build_workspace(tmp_path, fork=True)
    # Locate on the fork sees inherited turn 0/1 rows plus its own turn 2.
    located = _locate(ws, timeline=TIMELINE_FORK, turn_from=0, turn_to=2, limit=8)
    assert located["total_matches"] == 5
    fork_refs = {
        card["transcript_ref"] for card in located["candidates"]
        if card["turn"] == 2
    }
    assert fork_refs == {
        "xscript:tl-fork-a:turn-2:player:player_turn:journal-fork-door-close",
        "xscript:tl-fork-a:turn-2:keeper:finalized_keeper:fin-f2",
    }
    # The fork's own turn-2 wording differs from tl-main's turn 2.
    fork_read = _read_refs(
        ws, ["xscript:tl-fork-a:turn-2:keeper:finalized_keeper:fin-f2"]
    )
    row = fork_read["rows"][0]
    assert row["text"] == FORK_KEEPER_2
    assert row["timeline_id"] == TIMELINE_FORK
    assert row["inherited"] is False
    # Inherited read: turn 1 is a real commit-DAG ancestor on the parent
    # worldline and resolves there by canonical identity.
    inherited = _read_refs(ws, [
        "xscript:tl-fork-a:turn-1:keeper:finalized_keeper:fin-t1"
    ])
    row = inherited["rows"][0]
    assert row["text"] == KEEPER_1
    assert row["inherited"] is True
    assert row["timeline_id"] == TIMELINE_MAIN
    assert row["requested_timeline_id"] == TIMELINE_FORK
    # Same turn number, two worldlines: distinct exact wording, both verified.
    both = _read_refs(ws, [
        "xscript:tl-main:turn-2:keeper:finalized_keeper:fin-t2",
        "xscript:tl-fork-a:turn-2:keeper:finalized_keeper:fin-f2",
    ])
    texts = {row["text"] for row in both["rows"]}
    assert texts == {KEEPER_2, FORK_KEEPER_2}
    assert all(row["integrity"] == "verified" for row in both["rows"])


def test_fork_point_bounds_exclude_post_fork_parent_turns(tmp_path):
    ws = build_workspace(tmp_path, fork=True, post_fork_main_turn=True)
    # Turn 3 exists only on tl-main's tip, committed after the fork: it is
    # not in the fork's commit-DAG ancestry and must never be inherited.
    error = _error(ws, "transcript.read", {
        "refs": ["xscript:tl-fork-a:turn-3:keeper:finalized_keeper:fin-t3"],
    })
    assert error["code"] == "invalid_state"
    # Explicit-turn locate resolves the same commit as read, so it fails
    # closed on the same absent commit.
    error = _error(ws, "transcript.locate", {"timeline": TIMELINE_FORK, "turn": 3})
    assert error["code"] == "invalid_state"
    # The parent worldline itself reads turn 3 exactly.
    main_read = _read_refs(ws, [
        "xscript:tl-main:turn-3:keeper:finalized_keeper:fin-t3"
    ])
    assert main_read["rows"][0]["text"] == KEEPER_3


def test_worktree_timeline_state_tampering_cannot_redirect_worldlines(tmp_path):
    ws = build_workspace(tmp_path, fork=True)
    worktree = _worktree(ws["workspace"])
    # Mutable worktree metadata lies: it claims the fork is the root and
    # owns turn 1 directly. Git ancestry, not this file, decides ownership.
    _write(worktree, "save/timeline-state.json", json.dumps({
        "schema_generation": "timeline-state-1",
        "campaign_id": CAMP,
        "active_timeline_id": TIMELINE_FORK,
        "timelines": [{
            "timeline_id": TIMELINE_FORK,
            "campaign_id": CAMP,
            "kind": "root",
            "parents": [],
            "fork_point": None,
            "created_by": "initial",
        }],
        "confluences": [],
        "game_reasons": {},
    }, ensure_ascii=False) + "\n")
    inherited = _read_refs(ws, [
        "xscript:tl-fork-a:turn-1:keeper:finalized_keeper:fin-t1"
    ])
    row = inherited["rows"][0]
    assert row["text"] == KEEPER_1
    assert row["timeline_id"] == TIMELINE_MAIN
    assert row["inherited"] is True
    fork_read = _read_refs(ws, [
        "xscript:tl-fork-a:turn-2:keeper:finalized_keeper:fin-f2"
    ])
    assert fork_read["rows"][0]["text"] == FORK_KEEPER_2
    # Default-timeline reads must not silently trust the tampered metadata:
    # the invalid timeline set fails closed.
    error = _error(ws, "transcript.locate", {"role": "player"})
    assert error["code"] == "invalid_state"


def test_ambiguous_confluence_ownership_follows_real_git_merge_ancestry(tmp_path):
    ws = build_workspace(tmp_path, confluence=True)
    # tl-merge's DAG genuinely contains both parents' turn-2 commits
    # (a real two-parent merge), so ownership is ambiguous and fails closed.
    error = _error(ws, "transcript.read", {
        "refs": ["xscript:tl-merge:turn-2:keeper:finalized_keeper:fin-b2"],
    })
    assert error["code"] == "ambiguous_identity"
    # Inherited turn 1 is unambiguous (single tl-main ancestor).
    inherited = _read_refs(ws, [
        "xscript:tl-merge:turn-1:keeper:finalized_keeper:fin-t1"
    ])
    assert inherited["rows"][0]["text"] == KEEPER_1
    assert inherited["rows"][0]["timeline_id"] == TIMELINE_MAIN


def test_locators_are_stable_when_later_rows_are_appended(tmp_path):
    ws = build_workspace(tmp_path)
    located_before = _locate(ws, turn=1, role="keeper")
    ref = located_before["candidates"][0]["transcript_ref"]
    read_before = _read_refs(ws, [ref])
    add_main_turn(ws, 3)
    located_after = _locate(ws, turn=1, role="keeper")
    assert [card["transcript_ref"] for card in located_after["candidates"]] == [
        card["transcript_ref"] for card in located_before["candidates"]
    ]
    read_after = _read_refs(ws, [ref])
    assert read_after["rows"][0] == read_before["rows"][0]
    # The new turn is locatable and readable without disturbing old locators.
    new_card = _locate(ws, turn=3, role="player")["candidates"][0]
    assert new_card["transcript_ref"] == (
        "xscript:tl-main:turn-3:player:player_turn:journal-extra-3"
    )
    new_read = _read_refs(ws, [new_card["transcript_ref"]])
    assert new_read["rows"][0]["text"] == "追加的第3 turn玩家台词。"
    # The table opening stays bound to its immutable earliest commit.
    opening = _read_refs(ws, [REF_OPENING])
    assert opening["rows"][0]["text"] == OPENING_TEXT


def test_opening_requires_independent_table_opening_evidence(tmp_path):
    ws = build_workspace(tmp_path, variant="opening_coordinated_tamper")
    # The attacker recomputed transcript-local text hash/source/entry id,
    # but did not control the tracked evidence.table_opening receipt.
    error = _error(ws, "transcript.locate", {"turn": 0})
    assert error["code"] == "state_corrupt"
    error = _error(ws, "transcript.read", {
        "refs": [
            "xscript:tl-main:turn-0:keeper:table_opening:opening-tampered"
        ],
    })
    assert error["code"] == "state_corrupt"


def test_opening_anchor_survives_more_than_200_later_transcript_commits(tmp_path):
    ws = build_workspace(tmp_path)
    # The first later checkpoint forges the aggregate opening row, followed
    # by >200 transcript-changing commits. Historical opening lookup must
    # still choose the original Git blob, not the recent moving window.
    add_post_opening_transcript_commits(ws, count=201, mutate_opening=True)
    located = _locate(ws, turn=0)
    assert located["candidates"][0]["transcript_ref"] == REF_OPENING
    read = _read_refs(ws, [REF_OPENING])
    row = read["rows"][0]
    assert row["text"] == OPENING_TEXT
    assert "table_opening_evidence" in row["verified_bindings"]


def test_colon_bearing_semantic_source_ids_round_trip_and_bad_delimiters_fail(tmp_path):
    source_id = "opening:cellar:1"
    ws = build_workspace(tmp_path, opening_source=source_id)
    escaped_ref = (
        "xscript:tl-main:turn-0:keeper:table_opening:opening%3Acellar%3A1"
    )
    located = _locate(ws, turn=0)
    assert located["candidates"][0]["transcript_ref"] == escaped_ref
    read = _read_refs(ws, [escaped_ref])
    assert read["rows"][0]["text"] == OPENING_TEXT
    for malformed in (
        "xscript:tl-main:turn-0:keeper:table_opening:opening:cellar:1",
        "xscript:tl-main:turn-0:keeper:table_opening:opening%3acellar%3A1",
        "xscript:tl-main:turn-0:keeper:table_opening:opening%ZZcellar%3A1",
    ):
        error = _error(ws, "transcript.read", {"refs": [malformed]})
        assert error["code"] == "invalid_param", malformed


def test_range_speaker_locate_reads_each_owning_turn_blob_not_tip(tmp_path):
    ws = build_workspace(tmp_path)
    add_main_turn(ws, 3)  # real later append
    add_tip_rewrite_checkpoint(ws)  # later aggregate rewrite of turn 1
    # The tip appended turn 3 and changed turn-1 speaker/text, but
    # range+speaker locate must read turn 1 and turn 2 from their own
    # immutable commits.
    located = _locate(ws, speaker="陈默", turn_from=1, turn_to=2)
    assert [card["journal_decision_id"] for card in located["candidates"]] == [
        JOURNAL_1, JOURNAL_2,
    ]
    assert all(card["speaker"] == "陈默" for card in located["candidates"])
    read = _read_refs(ws, [
        card["transcript_ref"] for card in located["candidates"]
    ])
    assert [row["text"] for row in read["rows"]] == [PLAYER_1, PLAYER_2]


def test_read_fails_closed_on_duplicate_canonical_row_identities(tmp_path):
    ws = build_workspace(tmp_path, variant="duplicate_identity")
    error = _error(ws, "transcript.locate", {"turn": 2})
    assert error["code"] == "state_corrupt"
    error = _error(ws, "transcript.read", {
        "refs": ["xscript:tl-main:turn-2:player:player_turn:journal-lantern-raise"],
    })
    assert error["code"] == "state_corrupt"


def test_read_never_falls_back_to_the_active_worktree(tmp_path):
    ws = build_workspace(tmp_path)
    worktree = _worktree(ws["workspace"])
    transcript_path = worktree / "logs" / "table-transcript.jsonl"
    rows = [json.loads(line) for line in
            transcript_path.read_text(encoding="utf-8").splitlines() if line]
    # Uncommitted worktree edits: rewrite committed wording and append a row
    # for an uncommitted turn 3. Both must be invisible to locate/read.
    rows[2]["text"] = "工作区里被篡改的措辞。"
    rows[2]["text_sha256"] = _digest(rows[2]["text"])
    rows.append(_row(
        role="player", kind="player_turn", turn=3, turn_id="turn-0003",
        journal="journal-uncommitted", speaker="陈默",
        text="未提交的新台词。", source_id="journal-uncommitted",
    ))
    transcript_path.write_text(_jsonl(rows), encoding="utf-8")
    located = _locate(ws, role="player")
    assert located["total_matches"] == 2
    assert all(card["turn"] in (1, 2) for card in located["candidates"])
    read = _read_refs(ws, [REF_KEEPER_1])
    assert read["rows"][0]["text"] == KEEPER_1


# --------------------------------------------------------------------------- #
# Canonical contract binding: fail closed on every identity mismatch
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("variant", (
    "receipt_wording_mismatch",
    "row_run_mismatch",
    "row_session_mismatch",
    "row_turn_id_mismatch",
    "row_revision_mismatch",
))
def test_read_fails_closed_on_keeper_binding_mismatches(tmp_path, variant):
    ws = build_workspace(tmp_path, variant=variant)
    # Locate still reports the candidate (row shape and hash are intact)...
    located = _locate(ws, turn=1, role="keeper")
    assert located["total_matches"] == 1
    # ...but the read refuses wording the canonical receipt does not bind.
    error = _error(ws, "transcript.read", {"refs": [REF_KEEPER_1]})
    assert error["code"] == "state_corrupt"


@pytest.mark.parametrize("variant", ("player_run_mismatch", "player_turn_id_mismatch"))
def test_read_fails_closed_on_player_binding_mismatches(tmp_path, variant):
    ws = build_workspace(tmp_path, variant=variant)
    error = _error(ws, "transcript.read", {"refs": [REF_PLAYER_1]})
    assert error["code"] == "state_corrupt"


def test_read_fails_closed_on_corrupt_text_hash(tmp_path):
    ws = build_workspace(tmp_path, variant="corrupt_text_hash")
    error = _error(ws, "transcript.locate", {"turn": 1})
    assert error["code"] == "state_corrupt"
    error = _error(ws, "transcript.read", {"refs": [REF_PLAYER_1]})
    assert error["code"] == "state_corrupt"


def test_read_fails_closed_on_receipt_failing_the_production_contract(tmp_path):
    ws = build_workspace(tmp_path, variant="receipt_integrity_corrupt")
    error = _error(ws, "transcript.read", {"refs": [REF_KEEPER_1]})
    assert error["code"] == "state_corrupt"


def test_read_fails_closed_on_malformed_transcript_jsonl(tmp_path):
    ws = build_workspace(tmp_path, variant="malformed_jsonl")
    error = _error(ws, "transcript.locate", {"turn": 2})
    assert error["code"] == "state_corrupt"
    error = _error(ws, "transcript.read", {
        "refs": ["xscript:tl-main:turn-2:player:player_turn:journal-lantern-raise"],
    })
    assert error["code"] == "state_corrupt"


def test_read_fails_closed_on_missing_transcript_blob(tmp_path):
    ws = build_workspace(tmp_path, write_name="bare-base")
    # A turn commit that carries no transcript blob at all on an orphan
    # branch of the same campaign.
    worktree = _worktree(ws["workspace"])
    _git("checkout", "-q", "--orphan", "tl-bare", cwd=worktree)
    _git("rm", "-rf", "--quiet", "--", ".", cwd=worktree)
    _write(worktree, "campaign.json",
           json.dumps({"campaign_id": CAMP, "title": "transcript ops"}) + "\n")
    _write(worktree, "save/world-state.json", '{"day": 9}\n')
    _commit(worktree, "coc turn 0001 on tl-bare", [
        ("COC-Commit-Type", "turn"),
        ("Campaign-Id", CAMP),
        ("Timeline-Id", "tl-bare"),
        ("Turn-Number", "1"),
        ("Finalization-Id", "fin-bare"),
    ])
    _git("checkout", "-q", "main", cwd=worktree)
    _git("push", str(_repo(ws["workspace"])),
         "tl-bare:refs/heads/timelines/tl-bare", cwd=worktree)
    error = _error(ws, "transcript.locate", {"timeline": "tl-bare", "turn": 1})
    assert error["code"] == "invalid_state"
    error = _error(ws, "transcript.read", {
        "refs": ["xscript:tl-bare:turn-1:keeper:finalized_keeper:fin-bare"],
    })
    assert error["code"] == "invalid_state"


def test_read_fails_closed_on_wrong_timeline_or_missing_turn(tmp_path):
    ws = build_workspace(tmp_path, fork=True)
    error = _error(ws, "transcript.read", {
        "refs": ["xscript:tl-main:turn-9:keeper:finalized_keeper:fin-t1"],
    })
    assert error["code"] == "invalid_state"
    error = _error(ws, "transcript.read", {
        "refs": ["xscript:tl-fork-a:turn-9:player:player_turn:journal-cellar-push"],
    })
    assert error["code"] == "invalid_state"


# --------------------------------------------------------------------------- #
# Transport budget: bounded contiguous chunking, never truncation
# --------------------------------------------------------------------------- #

def test_oversized_row_is_chunked_exactly_and_reassembles(tmp_path):
    ws = build_workspace(tmp_path, variant="oversized_text")
    assert len(OVERSIZED_KEEPER_2) > READ_BUDGET_CHARS
    ref = "xscript:tl-main:turn-2:keeper:finalized_keeper:fin-t2"
    first = _read_refs(ws, [ref])
    row = first["rows"][0]
    assert row["text"] == OVERSIZED_KEEPER_2[:READ_BUDGET_CHARS]
    assert row["text_offset"] == 0
    assert row["text_chunk_chars"] == READ_BUDGET_CHARS
    assert row["text_total_chars"] == len(OVERSIZED_KEEPER_2)
    assert row["text_sha256"] == _digest(OVERSIZED_KEEPER_2)
    assert row["continuation"] == {
        "operation": "transcript.read",
        "refs": [ref],
        "text_offset": READ_BUDGET_CHARS,
    }
    assert first["complete"] is False
    # Deterministic multibyte-safe continuation through the whole text.
    pieces = [row["text"]]
    offset = READ_BUDGET_CHARS
    while True:
        page = _read_refs(ws, [ref], text_offset=offset)
        chunk_row = page["rows"][0]
        pieces.append(chunk_row["text"])
        assert chunk_row["text_sha256"] == _digest(OVERSIZED_KEEPER_2)
        if chunk_row["continuation"] is None:
            break
        offset = chunk_row["continuation"]["text_offset"]
    assert "".join(pieces) == OVERSIZED_KEEPER_2
    assert all("\ufffd" not in piece for piece in pieces)


def test_read_call_budget_bounds_multi_ref_responses(tmp_path):
    ws = build_workspace(tmp_path, variant="oversized_text")
    player_ref = "xscript:tl-main:turn-2:player:player_turn:journal-lantern-raise"
    keeper_ref = "xscript:tl-main:turn-2:keeper:finalized_keeper:fin-t2"
    data = _read_refs(ws, [player_ref, keeper_ref])
    assert data["row_count"] == 2
    assert data["complete"] is False
    used = sum(row["text_chunk_chars"] for row in data["rows"])
    assert used <= READ_BUDGET_CHARS
    assert data["rows"][0]["text"] == PLAYER_2
    oversized_row = data["rows"][1]
    assert oversized_row["text_chunk_chars"] == READ_BUDGET_CHARS - len(PLAYER_2)
    assert oversized_row["continuation"]["text_offset"] == (
        READ_BUDGET_CHARS - len(PLAYER_2)
    )
    # The unprocessed remainder is never silently dropped.
    assert data["pending"] == []


def test_read_paging_parameters_fail_closed(tmp_path):
    ws = build_workspace(tmp_path)
    error = _error(ws, "transcript.read", {
        "refs": [REF_KEEPER_1], "text_limit": READ_BUDGET_CHARS + 1,
    })
    assert error["code"] == "invalid_param"
    error = _error(ws, "transcript.read", {
        "refs": [REF_KEEPER_1], "text_offset": len(KEEPER_1),
    })
    assert error["code"] == "invalid_param"
    error = _error(ws, "transcript.read", {
        "refs": [REF_KEEPER_1, REF_KEEPER_1],
    })
    assert error["code"] == "invalid_param"


# --------------------------------------------------------------------------- #
# Locator surface hardening
# --------------------------------------------------------------------------- #

def test_read_rejects_bad_locator_surfaces(tmp_path):
    ws = build_workspace(tmp_path)
    error = _error(ws, "transcript.read", {})
    # The toolbox required-param gate fires before the handler.
    assert error["code"] == "missing_param"
    error = _error(ws, "transcript.read", {"refs": []})
    assert error["code"] == "invalid_param"
    error = _error(ws, "transcript.read", {
        "refs": "xscript:tl-main:turn-1:player:player_turn:journal-cellar-push"
    })
    assert error["code"] == "invalid_param"
    for bad_ref in (
        "xscript-bad-ref",
        "digest:xscript:tl-main:turn-1:player:player_turn:journal-cellar-push",
        "xscript:tl-main:turn-1:narrator:system_log:tool-log-1",
        "xscript:tl-main:turn-1:player:finalized_keeper:fin-t1",
        "xscript:tl-main:turn-one:player:player_turn:journal-cellar-push",
        "xscript:tl-main:turn-1:player:player_turn:",
        "xscript:tl-main:turn-1:player:player_turn:journal cellar push",
        "xscript:tl-main:turn-1:player:player_turn:state.journal#journal-x",
        "xscript:tl-main:turn-1:player:player_turn:journal-cellar-push:1",
    ):
        error = _error(ws, "transcript.read", {"refs": [bad_ref]})
        assert error["code"] == "invalid_param", bad_ref
    # A trailing extra segment re-anchors the locator grammar and stays a
    # parse-level rejection; see bad_ref list above.
    # Well-formed but unresolvable canonical identities fail closed at the
    # resolved commit instead of pretending to match a row.
    for unknown_ref in (
        f"xscript:tl-main:turn-1:player:player_turn:{'a' * 40}",
    ):
        error = _error(ws, "transcript.read", {"refs": [unknown_ref]})
        assert error["code"] == "state_corrupt", unknown_ref
    error = _error(ws, "transcript.read", {
        "refs": [REF_PLAYER_1] * 9,
    })
    assert error["code"] == "invalid_param"


def test_read_reports_only_canonical_table_rows(tmp_path):
    ws = build_workspace(tmp_path)
    located = _locate(ws, turn_from=0, turn_to=2, limit=8)
    assert all(
        card["record_kind"] in ("table_opening", "player_turn", "finalized_keeper")
        for card in located["candidates"]
    )
    data = _read_refs(
        ws, [card["transcript_ref"] for card in located["candidates"]]
    )
    assert all(
        row["record_kind"] in ("table_opening", "player_turn", "finalized_keeper")
        for row in data["rows"]
    )
    assert all(row["role"] in ("player", "keeper") for row in data["rows"])
