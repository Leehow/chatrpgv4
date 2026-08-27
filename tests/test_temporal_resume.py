"""session.resume as a bounded recovery consumer of the temporal subsystem.

Covers the Git/history/temporal-memory integration in the real
continuation/recovery branch of ``session.resume``:

- recovery maintenance rebuilds the deletable history projection from Git;
- the active timeline / current finalized turn resolve through the Git
  history coordinator from semantic ids only (never a relayed sha);
- the temporal capsule is bounded, advisory, privacy-preserving, and
  explicit about absent state;
- a corrupt projection cache is rebuilt, a corrupt canonical temporal
  store fails closed, and failures preserve Git/campaign evidence;
- the already-acknowledged no-op never re-runs recovery maintenance.
"""
from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import coc_git_history
import coc_history_projection
import coc_history_projection_schema
import coc_host_context
import coc_starter
import coc_temporal_memory
import coc_temporal_memory_contract as tm_contract
import coc_toolbox


_HEX40 = re.compile(r"\b[0-9a-f]{40}\b")


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def _workspace(tmp_path: Path, campaign_id: str) -> dict[str, object]:
    workspace = tmp_path / "workspace"
    _write_json(
        workspace / ".coc" / "runtime.json",
        {
            "schema_version": 2,
            "planner": {"kind": "deterministic"},
            "rules": {"kind": "deterministic"},
            "narrator": {"kind": "template"},
            "player": {"kind": "human"},
        },
    )
    quick = coc_starter.quick_start(
        workspace / ".coc",
        "the-haunting",
        "thomas-hayes",
        campaign_id=campaign_id,
        title="Temporal Resume Contract",
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


def _run(ws: dict[str, object], tool: str, args: dict | None = None) -> dict:
    return coc_toolbox.run_tool(
        tool,
        Path(ws["workspace"]),
        str(ws["campaign_id"]),
        dict(args or {}),
    )


def _journal(ws: dict[str, object], *, decision_id: str, player_text: str) -> dict:
    return _call(ws, "state.journal", {
        "summary": f"玩家行动已在 {decision_id} 中得到连续回应。",
        "player_action": "按当前场景中的既定方法继续调查",
        "player_text": player_text,
        "player_speaker": "玩家",
        "run_id": "temporal-resume-test-run",
        "intent_class": "investigate",
        "decision_id": decision_id,
    })


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
            "revision": 1,
            "decision_id": decision_id,
        },
    )


def _record_turn_memory(
    ws: dict[str, object],
    *,
    turn: int,
    finalization_id: str,
    player_text: str,
) -> None:
    """Seed keeper-side assertions/hooks for a turn `_finalize` closed.

    Since ``turn.finalize`` runs
    ``_enqueue_finalized_turn_memory_extraction``, the episode for a
    finalized turn is ALREADY recorded canonically (empty subjects/
    entities, receipts machine-bound). This helper must not replay
    ``record_turn_episode`` — an enriched second write drifts from the
    immutable auto-recorded episode and fails closed on the replay digest.
    Participants/entities enrichment belongs to the canonical
    extraction/settle path in real play, never a second episode write.
    """
    campaign_id = str(ws["campaign_id"])
    campaign_dir = Path(ws["campaign_dir"])
    party_subject = tm_contract.subject_id_for("party", campaign_id, "")
    coc_temporal_memory.record_assertion({
        "assertion_id": f"mem-{campaign_id}-knowledge-{turn}",
        "kind": "knowledge",
        "subject_id": party_subject,
        "statement": f"第 {turn} 轮确认尸体上有新鲜的抓痕",
        "privacy": "keeper_only",
        "source_turn": turn,
        "source_receipts": [finalization_id],
    }, campaign_dir=campaign_dir)
    coc_temporal_memory.record_assertion({
        "assertion_id": f"mem-{campaign_id}-player-suspicion-{turn}",
        "kind": "player_assertion",
        "subject_id": tm_contract.subject_id_for("player", None, "table"),
        "statement": f"玩家在第 {turn} 轮怀疑管家",
        "privacy": "player_safe",
        "source_turn": turn,
        "source_receipts": [finalization_id],
    }, campaign_dir=campaign_dir)
    coc_temporal_memory.register_hook(
        f"hook-{campaign_id}-scratch-{turn}",
        f"mem-{campaign_id}-knowledge-{turn}",
        campaign_dir=campaign_dir,
        possible_payoff="抓痕的去向仍待确认",
    )


def _git_state(ws: dict[str, object]) -> tuple[str, str]:
    repo = coc_git_history.repo_path_for(
        Path(ws["workspace"]), str(ws["campaign_id"])
    )
    refs = subprocess.run(
        ["git", "--git-dir", str(repo), "for-each-ref"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    head = subprocess.run(
        ["git", "--git-dir", str(repo), "rev-parse", "HEAD"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    return refs, head


def _campaign_file_digests(ws: dict[str, object]) -> dict[str, str]:
    digests: dict[str, str] = {}
    for path in sorted(Path(ws["campaign_dir"]).rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(Path(ws["campaign_dir"])).as_posix()
        if (
            rel == "memory/history-projection.db"
            or rel == "logs/toolbox-calls.jsonl"  # the probe call's own audit row
            or rel.startswith("save/checkpoint")
            or rel.endswith(".campaign.lock")
            or "/.history-projection-" in rel
        ):
            continue
        digests[rel] = hashlib.sha256(path.read_bytes()).hexdigest()
    return digests


def test_fresh_campaign_reports_explicit_empty_temporal_state(
    tmp_path: Path,
) -> None:
    ws = _workspace(tmp_path, "temporal-fresh")
    legacy_card = Path(ws["campaign_dir"]) / "memory" / "cards" / "keeper"
    legacy_card.mkdir(parents=True, exist_ok=True)
    (legacy_card / "legacy-note.md").write_text(
        "---\nkind: knowledge\n---\n旧版 Markdown 记忆卡内容\n",
        encoding="utf-8",
    )

    resumed = _call(ws, "session.resume")["data"]

    history = resumed["history_projection_recovery"]
    assert history["status"] == "rebuilt"
    assert history["commit_count"] >= 1  # quick-start baseline
    assert history["canonical_sources_unchanged"] is True
    capsule = resumed["temporal_capsule"]
    assert capsule["status"] == "no_finalized_history"
    assert capsule["timeline_id"] == "tl-main"
    assert capsule["current_finalized_turn"] is None
    assert capsule["authority"] == "advisory"
    assert capsule["hard_gate"] is False
    for field in (
        "recent_episodes", "active_assertions", "open_hooks",
        "pending_candidates", "session_summaries",
    ):
        assert capsule[field] == []
    # Reading never bootstraps the canonical temporal store, and legacy
    # Markdown memory cards are never read.
    assert not (Path(ws["campaign_dir"]) / "memory" / "temporal").exists()
    assert (legacy_card / "legacy-note.md").read_text(encoding="utf-8")


def test_normal_active_timeline_projects_bounded_temporal_capsule(
    tmp_path: Path,
) -> None:
    ws = _workspace(tmp_path, "temporal-active")
    _journal(ws, decision_id="journal-one", player_text="我检查尸体上的抓痕。")
    finalized = _finalize(ws, decision_id="finalize-one")
    finalization_id = str(finalized["data"]["finalization_id"])
    _record_turn_memory(
        ws, turn=1, finalization_id=finalization_id,
        player_text="我检查尸体上的抓痕。",
    )

    resumed = _call(ws, "session.resume")
    capsule = resumed["data"]["temporal_capsule"]
    assert capsule["status"] == "ready"
    assert capsule["timeline_id"] == "tl-main"
    assert capsule["current_finalized_turn"] == 1
    assert capsule["authority"] == "advisory"
    assert capsule["hard_gate"] is False
    assert capsule["schema_generation"] == coc_temporal_memory.SCHEMA_GENERATION

    episodes = capsule["recent_episodes"]
    assert len(episodes) == 1
    assert episodes[0]["episode_id"] == (
        f"episode-temporal-active-tl-main-turn-1"
    )
    assert episodes[0]["turn_number"] == 1
    # Machine-internal commit identity never enters the model-facing capsule.
    assert "commit" not in episodes[0]
    assert "player_text_sha256" not in episodes[0]

    by_id = {
        row["assertion_id"]: row
        for row in capsule["active_assertions"]
    }
    knowledge = by_id["mem-temporal-active-knowledge-1"]
    assert knowledge["privacy"] == "keeper_only"
    assert knowledge["state"] == "accurate"
    assert "source_commit" not in knowledge
    assert "covers_commits" not in knowledge
    pending = capsule["pending_candidates"]
    assert [row["assertion_id"] for row in pending] == [
        "mem-temporal-active-player-suspicion-1"
    ]
    assert pending[0]["kind"] == "player_assertion"

    hooks = capsule["open_hooks"]
    assert [row["memory_id"] for row in hooks] == [
        "hook-temporal-active-scratch-1"
    ]
    assert hooks[0]["status"] == "open"

    # Bounded capsule: component limits, no full-history dump, no sha relay.
    serialized = json.dumps(capsule, ensure_ascii=False)
    assert not _HEX40.search(serialized.replace(finalization_id, ""))
    assert len(capsule["recent_episodes"]) <= 6
    assert len(capsule["active_assertions"]) <= 24
    assert len(capsule["open_hooks"]) <= 16
    assert resumed["data"]["history_projection_recovery"]["commit_count"] >= 2
    assert any(
        "temporal_capsule" in hint for hint in resumed.get("hints", [])
    )
    assert any(
        "keeper_only" in hint for hint in resumed.get("hints", [])
    )


def test_forked_active_timeline_scopes_capsule_to_active_timeline(
    tmp_path: Path,
) -> None:
    ws = _workspace(tmp_path, "temporal-fork")
    finalization_ids: list[str] = []
    for turn in (1, 2):
        _journal(
            ws,
            decision_id=f"journal-{turn}",
            player_text=f"第 {turn} 轮，我继续追踪划痕的去向。",
        )
        finalized = _finalize(ws, decision_id=f"finalize-{turn}")
        finalization_id = str(finalized["data"]["finalization_id"])
        finalization_ids.append(finalization_id)
        _record_turn_memory(
            ws,
            turn=turn,
            finalization_id=finalization_id,
            player_text=f"第 {turn} 轮，我继续追踪划痕的去向。",
        )

    forked = coc_git_history.fork_timeline(
        Path(ws["workspace"]),
        str(ws["campaign_id"]),
        timeline_id="tl-fork-scratch",
        game_reason="player wants to revisit the scratch decision",
        source_timeline_id="tl-main",
        source_turn=2,
        activate=True,
    )
    assert forked["timeline_id"] == "tl-fork-scratch"

    resumed = _call(ws, "session.resume")["data"]
    capsule = resumed["temporal_capsule"]

    # Semantic resolution follows the active timeline pointer through the
    # Git coordinator; the fork head is the finalized turn-2 commit.
    assert capsule["timeline_id"] == "tl-fork-scratch"
    assert capsule["current_finalized_turn"] == 2
    assert capsule["status"] == "ready"
    # Per-timeline truth: no episode has been finalized ON the fork yet, so
    # the capsule reports the empty per-timeline state instead of importing
    # parent-line episodes implicitly.
    assert capsule["recent_episodes"] == []
    # Cross-timeline knowledge only enters through explicit transfer, never
    # by leaking tl-main assertions into the fork capsule.
    assert all(
        row.get("timeline_id") in (None, "tl-fork-scratch")
        for row in capsule["active_assertions"]
    )
    assert resumed["history_projection_recovery"]["status"] == "rebuilt"


def test_resume_projection_orders_hot_newest_first_and_isolates_foreign_campaign(
    tmp_path: Path,
) -> None:
    """Direct capsule unit: hot tier = newest-effective-first, campaign-pinned."""
    camp = tmp_path / ".coc" / "campaigns" / "resume-hot-order"
    camp.mkdir(parents=True)
    cid = camp.name
    subject = coc_temporal_memory.contract.subject_id_for("party", cid, "")

    def seed(assertion_id: str, source_turn: int, campaign_id: str = cid) -> None:
        coc_temporal_memory.record_assertion(
            {
                "assertion_id": assertion_id,
                "kind": "knowledge",
                "scope": "campaign",
                "campaign_id": campaign_id,
                "timeline_id": "tl-main",
                "subject_id": subject,
                "knowers": [subject],
                "privacy": "player_safe",
                "state": "accurate",
                "statement": f"{assertion_id} 的陈述。",
                "entities": ["entity-location-cellar"],
                "occurred_turn": source_turn,
                "valid_from_turn": source_turn,
                "source_commit": "a" * 40,
                "source_turn": source_turn,
                "source_receipts": [f"receipt-{assertion_id}"],
            },
            campaign_dir=camp,
        )

    seed("mem-resume-hot-order-early", 2)
    seed("mem-resume-hot-order-late", 9)
    # A foreign campaign row physically present in the same store never
    # enters this campaign's resume capsule.
    seed("mem-other-camp-foreign", 12, campaign_id="other-camp")

    capsule = coc_temporal_memory.build_resume_projection(
        cid, 10, campaign_dir=camp, timeline_id="tl-main",
    )
    assert capsule["authority"] == "advisory"
    assert capsule["turn_number"] == 10
    assert [row["assertion_id"] for row in capsule["active_assertions"]] == [
        "mem-resume-hot-order-late",
        "mem-resume-hot-order-early",
    ]


def test_resume_projection_read_never_bootstraps_store(tmp_path: Path) -> None:
    camp = tmp_path / ".coc" / "campaigns" / "resume-absent-store"
    camp.mkdir(parents=True)
    capsule = coc_temporal_memory.build_resume_projection(
        camp.name, 4, campaign_dir=camp,
    )
    for field in (
        "recent_episodes", "active_assertions", "open_hooks",
        "pending_candidates", "session_summaries",
    ):
        assert capsule[field] == []
    # Reading an absent store must not materialize it.
    assert not (camp / "memory" / "temporal").exists()


def test_resume_capsule_pending_candidates_are_canonically_isolated(
    tmp_path: Path,
) -> None:
    """Pending player candidates enter the capsule through the same pinned,
    validated core: foreign / wrong-timeline / future / closed / non-candidate
    / unbound-cross-campaign rows never leak, ordering stays id-ascending."""
    camp = tmp_path / ".coc" / "campaigns" / "resume-pending"
    camp.mkdir(parents=True)
    cid = camp.name
    subject = coc_temporal_memory.contract.subject_id_for("party", cid, "")

    def seed(
        assertion_id: str,
        *,
        source_turn: int = 3,
        campaign_id: str = cid,
        timeline_id: str = "tl-main",
        kind: str = "player_assertion",
        valid_until_turn: int | None = None,
    ) -> None:
        if kind == "player_assertion":
            row_subject = "subject-player-table"
        else:
            row_subject = subject
        coc_temporal_memory.record_assertion(
            {
                "assertion_id": assertion_id,
                "kind": kind,
                "scope": "campaign",
                "campaign_id": campaign_id,
                "timeline_id": timeline_id,
                "subject_id": row_subject,
                "knowers": [row_subject],
                "privacy": "player_safe",
                "state": "uncertain",
                "statement": f"{assertion_id} 的猜测。",
                "entities": ["entity-location-cellar"],
                "occurred_turn": source_turn,
                "valid_from_turn": source_turn,
                "source_commit": "a" * 40,
                "source_turn": source_turn,
                "source_receipts": [f"receipt-{assertion_id}"],
                "valid_until_turn": valid_until_turn,
                "superseded_by": (
                    [f"mem-{campaign_id}-superseding-{assertion_id}"]
                    if valid_until_turn is not None
                    else []
                ),
            },
            campaign_dir=camp,
        )

    # id order differs from recency order: pins the id-ascending shape.
    seed("mem-resume-pending-own", source_turn=3)
    seed("mem-resume-pending-aearlier-id", source_turn=9)
    seed("mem-resume-pending-future", source_turn=11)
    seed("mem-resume-pending-fork", timeline_id="tl-fork")
    seed("mem-resume-pending-closed", valid_until_turn=5)
    seed("mem-resume-pending-known", kind="knowledge")
    seed("mem-other-camp-foreign-pending", campaign_id="other-camp")
    coc_temporal_memory.record_assertion(
        {
            "assertion_id": "mem-xc-unbound-pending",
            "kind": "player_assertion",
            "scope": "cross_campaign",
            "campaign_id": None,
            "timeline_id": None,
            "subject_id": "subject-player-table",
            "knowers": ["subject-player-table"],
            "privacy": "player_safe",
            "state": "uncertain",
            "statement": "无绑定的跨战役猜测。",
            "entities": [],
            "occurred_turn": 3,
            "valid_from_turn": 3,
            "source_commit": "a" * 40,
            "source_turn": 3,
            "source_receipts": ["receipt-xc-unbound"],
        },
        campaign_dir=camp,
    )

    capsule = coc_temporal_memory.build_resume_projection(
        cid, 10, campaign_dir=camp, timeline_id="tl-main",
    )
    assert [row["assertion_id"] for row in capsule["pending_candidates"]] == [
        "mem-resume-pending-aearlier-id",
        "mem-resume-pending-own",
    ]
    assert len(capsule["pending_candidates"]) <= 16


def test_resume_capsule_fails_closed_on_contract_invalid_rows(
    tmp_path: Path,
) -> None:
    """A contract-invalid row is store corruption: the capsule fails closed
    (session.resume's temporal_store_corrupt path), it never silently drops
    or projects the row."""
    camp = tmp_path / ".coc" / "campaigns" / "resume-pending-corrupt"
    camp.mkdir(parents=True)
    cid = camp.name
    coc_temporal_memory.record_assertion(
        {
            "assertion_id": f"mem-{cid}-pending-ok",
            "kind": "player_assertion",
            "scope": "campaign",
            "campaign_id": cid,
            "timeline_id": "tl-main",
            "subject_id": "subject-player-table",
            "knowers": ["subject-player-table"],
            "privacy": "player_safe",
            "state": "uncertain",
            "statement": "有效的猜测。",
            "entities": ["entity-location-cellar"],
            "occurred_turn": 3,
            "valid_from_turn": 3,
            "source_commit": "a" * 40,
            "source_turn": 3,
            "source_receipts": ["receipt-ok"],
        },
        campaign_dir=camp,
    )
    assertions_path = camp / "memory" / "temporal" / "assertions.jsonl"
    with assertions_path.open("a", encoding="utf-8") as handle:
        handle.write(
            json.dumps({"assertion_id": f"mem-{cid}-broken", "kind": "belief"})
            + "\n"
        )

    with pytest.raises(
        coc_temporal_memory.TemporalMemoryError, match="corruption"
    ):
        coc_temporal_memory.build_resume_projection(
            cid, 10, campaign_dir=camp, timeline_id="tl-main",
        )


def test_resume_capsule_pending_selection_is_not_precapped_or_preranked(
    tmp_path: Path,
) -> None:
    """With 70 valid pending candidates the id-ordered first 16 win even
    though the lexically-first ids are recency-late (a warm rank/cap would
    drop exactly those); an accepted candidate is removed after full-pool
    selection, never before."""
    camp = tmp_path / ".coc" / "campaigns" / "resume-pending-cap"
    camp.mkdir(parents=True)
    cid = camp.name
    subject = "subject-player-table"
    ids = [f"mem-{cid}-pending-{i:03d}" for i in range(70)]
    for i, assertion_id in enumerate(ids):
        coc_temporal_memory.record_assertion(
            {
                "assertion_id": assertion_id,
                "kind": "player_assertion",
                "scope": "campaign",
                "campaign_id": cid,
                "timeline_id": "tl-main",
                "subject_id": subject,
                "knowers": [subject],
                "privacy": "player_safe",
                "state": "uncertain",
                "statement": f"{assertion_id} 的猜测。",
                "entities": ["entity-location-cellar"],
                "occurred_turn": i + 1,
                "valid_from_turn": i + 1,
                "source_commit": "a" * 40,
                "source_turn": i + 1,
                "source_receipts": [f"receipt-{assertion_id}"],
            },
            campaign_dir=camp,
        )

    capsule = coc_temporal_memory.build_resume_projection(
        cid, 200, campaign_dir=camp, timeline_id="tl-main",
    )
    # id-ascending, fill-to-16 over the complete valid pool: ids 000..005
    # are the recency-late rows a warm rank/cap would have dropped first.
    assert [row["assertion_id"] for row in capsule["pending_candidates"]] == (
        ids[:16]
    )

    # Accepted adjudication is removed after full-pool selection.
    coc_temporal_memory.adjudicate_candidate(
        "adj-pending-cap-accept", ids[0], "accept",
        campaign_dir=camp, kind="belief",
    )
    capsule = coc_temporal_memory.build_resume_projection(
        cid, 200, campaign_dir=camp, timeline_id="tl-main",
    )
    assert [row["assertion_id"] for row in capsule["pending_candidates"]] == (
        ids[1:17]
    )


def test_temporal_capsule_degrades_to_counts_under_budget() -> None:
    oversized = {
        "host_input": {"text": "玩家未分类输入" * 4000},
        "host_context": {"before_resume": {"session_id": "budget-host"}},
        "delivery": {
            "finalization_id": "finalization-budget",
            "rendered_sha256": "a" * 64,
            "exact_text": "尚未确认送达的精确台词" * 4000,
        },
        "temporal_capsule": {
            "schema_version": 1,
            "status": "ready",
            "authority": "advisory",
            "hard_gate": False,
            "campaign_id": "budget-campaign",
            "timeline_id": "tl-main",
            "current_finalized_turn": 40,
            "recent_episodes": [
                {"episode_id": f"episode-budget-turn-{turn}", "statement": "回" * 900}
                for turn in range(6)
            ],
            "active_assertions": [
                {"assertion_id": f"mem-budget-know-{turn}", "statement": "记" * 900}
                for turn in range(12)
            ],
            "open_hooks": [
                {"memory_id": f"hook-budget-{turn}", "possible_payoff": "钩" * 400}
                for turn in range(16)
            ],
            "pending_candidates": [
                {"assertion_id": f"mem-budget-assert-{turn}", "statement": "猜" * 400}
                for turn in range(16)
            ],
            "session_summaries": [
                {"turn_number": turn, "summary": "摘要" * 600}
                for turn in range(6)
            ],
        },
    }
    bounded = coc_toolbox._bound_session_resume_data(oversized)
    assert coc_toolbox._wire_bytes(bounded) <= (
        coc_toolbox._SESSION_RESUME_DATA_MAX_BYTES
    )
    budget = bounded["resume_budget"]
    assert "temporal_capsule_to_counts" in budget["reductions"]
    capsule = bounded["temporal_capsule"]
    assert capsule["status"] == "ready"
    assert capsule["current_finalized_turn"] == 40
    assert capsule["recent_episodes"] == []
    assert capsule["recent_episodes_count"] == 6
    assert capsule["active_assertions"] == []
    assert capsule["active_assertions_count"] == 12
    assert capsule["open_hooks_count"] == 16
    assert capsule["pending_candidates_count"] == 16
    assert capsule["session_summaries_count"] == 6
    assert budget["canonical_sources_unchanged"] is True


def test_already_acknowledged_no_op_skips_temporal_recovery(
    tmp_path: Path,
    monkeypatch,
) -> None:
    ws = _workspace(tmp_path, "temporal-noop")
    workspace = Path(ws["workspace"])
    session_id = "temporal-resume-noop-session"
    marker = coc_host_context.mark_lifecycle(
        workspace,
        session_id=session_id,
        host="grok",
        event="session_start",
        source="startup",
    )

    rebuild_calls: list[str] = []
    original = coc_history_projection.rebuild_history_projection

    def counting_rebuild(root, campaign_id):
        rebuild_calls.append(str(campaign_id))
        return original(root, campaign_id)

    monkeypatch.setattr(
        coc_history_projection,
        "rebuild_history_projection",
        counting_rebuild,
    )

    resumed = _call(ws, "session.resume", {
        "host_session_id": session_id,
        "context_epoch": marker["context_epoch"],
    })
    assert resumed["data"]["temporal_capsule"]["status"] == (
        "no_finalized_history"
    )
    assert rebuild_calls == ["temporal-noop"]

    repeated = _call(ws, "session.resume")
    assert repeated["data"]["mode"] == "already_acknowledged"
    assert repeated["data"]["reuse_existing_working_set"] is True
    # The no-op returns no recovery maintenance at all.
    assert "temporal_capsule" not in repeated["data"]
    assert "history_projection_recovery" not in repeated["data"]
    assert rebuild_calls == ["temporal-noop"]


def test_corrupt_projection_cache_is_rebuilt_from_git(
    tmp_path: Path,
) -> None:
    ws = _workspace(tmp_path, "temporal-cache-rebuild")
    _journal(ws, decision_id="journal-one", player_text="我检查尸体上的抓痕。")
    _finalize(ws, decision_id="finalize-one")

    db_path = coc_history_projection_schema.projection_path(
        Path(ws["workspace"]), str(ws["campaign_id"])
    )
    db_path.parent.mkdir(parents=True, exist_ok=True)
    db_path.write_bytes(b"not-a-sqlite-database-at-all")

    resumed = _call(ws, "session.resume")
    assert resumed["data"]["history_projection_recovery"]["status"] == (
        "rebuilt"
    )
    # The corrupt cache was replaced by a validated build served from Git.
    connection = coc_history_projection_schema.open_projection_db(
        Path(ws["workspace"]), str(ws["campaign_id"])
    )
    try:
        rows = connection.execute(
            "SELECT COUNT(*) FROM commits WHERE commit_type = 'turn'"
        ).fetchone()
    finally:
        connection.close()
    assert rows[0] == 1
    capsule = resumed["data"]["temporal_capsule"]
    # Finalize-hook semantics: the settled turn was already auto-recorded
    # into the canonical temporal store, so resume correctly reports ready
    # with exactly the one bounded turn-1 episode, not an absent-store gap.
    assert capsule["status"] == "ready"
    assert capsule["current_finalized_turn"] == 1
    episodes = capsule["recent_episodes"]
    assert len(episodes) == 1
    assert episodes[0]["episode_id"] == (
        "episode-temporal-cache-rebuild-tl-main-turn-1"
    )


def test_corrupt_projection_cache_without_any_finalized_turn_reports_explicit_empty_state(
    tmp_path: Path,
) -> None:
    ws = _workspace(tmp_path, "temporal-no-finalized-turn")
    db_path = coc_history_projection_schema.projection_path(
        Path(ws["workspace"]), str(ws["campaign_id"])
    )
    db_path.parent.mkdir(parents=True, exist_ok=True)
    db_path.write_bytes(b"not-a-sqlite-database-at-all")

    resumed = _call(ws, "session.resume")
    history = resumed["data"]["history_projection_recovery"]
    assert history["status"] == "rebuilt"
    assert history["commit_count"] >= 1  # quick-start baseline commit
    # Baseline-only history: no finalized turn resolves, and reading never
    # bootstraps the canonical store — the capsule stays explicit empty
    # state instead of synthesizing episodes or guessing a latest turn.
    capsule = resumed["data"]["temporal_capsule"]
    assert capsule["status"] == "no_finalized_history"
    assert capsule["current_finalized_turn"] is None
    assert capsule["recent_episodes"] == []


def test_projection_rebuild_failure_preserves_canonical_state(
    tmp_path: Path,
    monkeypatch,
) -> None:
    ws = _workspace(tmp_path, "temporal-rebuild-failure")
    _journal(ws, decision_id="journal-one", player_text="我检查尸体上的抓痕。")
    finalized = _finalize(ws, decision_id="finalize-one")
    finalization_id = str(finalized["data"]["finalization_id"])
    _record_turn_memory(
        ws, turn=1, finalization_id=finalization_id,
        player_text="我检查尸体上的抓痕。",
    )
    assert _call(ws, "session.resume")["data"]["temporal_capsule"]["status"] == (
        "ready"
    )

    refs_before, head_before = _git_state(ws)
    files_before = _campaign_file_digests(ws)
    db_path = coc_history_projection_schema.projection_path(
        Path(ws["workspace"]), str(ws["campaign_id"])
    )
    db_bytes_before = db_path.read_bytes()

    def failing_rebuild(root, campaign_id):
        raise coc_history_projection.HistoryProjectionRebuildError(
            "probe: forced rebuild failure"
        )

    monkeypatch.setattr(
        coc_history_projection,
        "rebuild_history_projection",
        failing_rebuild,
    )
    resumed = _run(ws, "session.resume")
    assert resumed["ok"] is True, resumed

    history = resumed["data"]["history_projection_recovery"]
    assert history["status"] == "rebuild_failed"
    assert "probe: forced rebuild failure" in history["reason"]
    assert history["canonical_sources_unchanged"] is True
    assert any(
        "history projection rebuild failed" in warning
        for warning in resumed["warnings"]
    )
    # The capsule still resolves through the Git coordinator and the
    # canonical temporal store without the projection cache.
    capsule = resumed["data"]["temporal_capsule"]
    assert capsule["status"] == "ready"
    assert capsule["current_finalized_turn"] == 1

    # Prior evidence preserved byte-for-byte.
    refs_after, head_after = _git_state(ws)
    assert refs_after == refs_before
    assert head_after == head_before
    assert db_path.read_bytes() == db_bytes_before
    assert _campaign_file_digests(ws) == files_before


def test_corrupt_temporal_store_fails_closed(
    tmp_path: Path,
) -> None:
    ws = _workspace(tmp_path, "temporal-corrupt-store")
    _journal(ws, decision_id="journal-one", player_text="我检查尸体上的抓痕。")
    finalized = _finalize(ws, decision_id="finalize-one")
    finalization_id = str(finalized["data"]["finalization_id"])
    _record_turn_memory(
        ws, turn=1, finalization_id=finalization_id,
        player_text="我检查尸体上的抓痕。",
    )
    assert _call(ws, "session.resume")["data"]["temporal_capsule"]["status"] == (
        "ready"
    )

    refs_before, head_before = _git_state(ws)
    assertions_path = (
        Path(ws["campaign_dir"]) / "memory" / "temporal" / "assertions.jsonl"
    )
    with assertions_path.open("a", encoding="utf-8") as handle:
        handle.write('{"assertion_id": "not json at all\n')

    failed = _run(ws, "session.resume")
    assert failed["ok"] is False, failed
    assert failed["error"]["code"] == "temporal_store_corrupt"
    details = failed["error"]["details"]
    assert details["campaign_id"] == "temporal-corrupt-store"
    assert details["timeline_id"] == "tl-main"
    assert details["turn_number"] == 1

    # Failing closed preserves the canonical evidence exactly.
    refs_after, head_after = _git_state(ws)
    assert refs_after == refs_before
    assert head_after == head_before
    assert "not json at all" in assertions_path.read_text(encoding="utf-8")
