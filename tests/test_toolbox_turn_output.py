"""Behavior tests owned by the turn-output operation cell."""
from toolbox_test_support import *

def test_state_journal_requires_exact_player_text_and_backfills_idempotently(
    campaign_ws,
):
    missing = _run(
        campaign_ws,
        "state.journal",
        {
            "summary": "不能以摘要或 player_action 代替原始玩家消息。",
            "player_action": "调查现场",
            "decision_id": "journal-missing-player-text",
        },
    )
    assert missing["ok"] is False
    assert missing["error"]["code"] == "missing_param"

    blank = _run(
        campaign_ws,
        "state.journal",
        {
            "summary": "空白原文不能关闭回合。",
            "player_action": "调查现场",
            "player_text": " \t\n",
            "decision_id": "journal-blank-player-text",
        },
    )
    assert blank["ok"] is False
    assert blank["error"]["code"] == "invalid_param"

    exact_player_text = "  我仔细检查门锁，再听一听屋内。  \n"
    args = {
        "summary": "调查员检查门锁并留意屋内动静。",
        "player_action": "检查门锁并倾听",
        "player_text": exact_player_text,
        "decision_id": "journal-exact-player-text",
    }
    first = _run(campaign_ws, "state.journal", args)
    assert first["ok"] is True, first
    transcript_path = campaign_ws["campaign_dir"] / "logs" / "table-transcript.jsonl"
    rows = _read_jsonl(transcript_path)
    assert len(rows) == 1
    assert rows[0]["role"] == "player"
    assert rows[0]["text"] == exact_player_text

    replay = _run(campaign_ws, "state.journal", args)
    assert replay["ok"] is True, replay
    assert _read_jsonl(transcript_path) == rows

    conflict = _run(
        campaign_ws,
        "state.journal",
        {**args, "player_text": "我改口说完全不同的话。"},
    )
    assert conflict["ok"] is False
    assert conflict["error"]["code"] == "idempotency_conflict"

    # A legacy successful journal can lack its player row. Retrying it with the
    # same exact text performs the one canonical backfill; later different
    # text remains an idempotency conflict.
    transcript_path.write_text("", encoding="utf-8")
    backfilled = _run(campaign_ws, "state.journal", args)
    assert backfilled["ok"] is True, backfilled
    rows = _read_jsonl(transcript_path)
    assert len(rows) == 1
    assert rows[0]["text"] == exact_player_text
    conflict_after_backfill = _run(
        campaign_ws,
        "state.journal",
        {**args, "player_text": "我仍然改口说别的话。"},
    )
    assert conflict_after_backfill["ok"] is False
    assert conflict_after_backfill["error"]["code"] == "idempotency_conflict"

def test_missing_required_args_are_reported_together(campaign_ws):
    envelope = _run(campaign_ws, "turn.finalize", {"text": "wrong alias"})
    assert envelope["ok"] is False
    assert envelope["error"]["code"] == "missing_param"
    assert envelope["error"]["details"]["missing_parameters"] == [
        "draft", "coverage", "decision_id", "revision",
    ]
    assert envelope["error"]["details"]["provided_parameters"] == ["text"]

@pytest.mark.parametrize(
    "document",
    [
        {"schema_version": 1, "receipts": {}},
        {"schema_version": 2, "receipts": {}, "pending_side_effects": {}},
        {
            "schema_version": 3,
            "receipts": {},
            "legacy_receipts": {},
            "pending_side_effects": {},
        },
    ],
)
def test_noncurrent_roll_receipt_documents_are_rejected_without_rewrite(
    campaign_ws, document,
):
    path = (
        campaign_ws["campaign_dir"] / "save" / "roll-operation-receipts.json"
    )
    _write_json(path, document)
    before = path.read_bytes()

    rejected = _run(
        campaign_ws,
        "state.journal",
        {"summary": "must not migrate", "player_text": "我继续调查。", "decision_id": "reject-old-roll-doc"},
    )

    assert rejected["ok"] is False
    assert rejected["error"]["code"] == "state_corrupt"
    assert path.read_bytes() == before

def test_malformed_or_decision_only_ledger_is_never_overwritten(campaign_ws):
    path = campaign_ws["campaign_dir"] / "save" / "toolbox-ledger.json"
    path.write_text("{broken", encoding="utf-8")
    before = path.read_bytes()
    malformed = _run(
        campaign_ws,
        "state.journal",
        {"summary": "must not replace", "player_text": "我继续调查。", "decision_id": "bad-ledger-json"},
    )
    assert malformed["ok"] is False
    assert malformed["error"]["code"] == "state_corrupt"
    assert path.read_bytes() == before

    _write_json(path, {
        "schema_version": coc_toolbox._LEDGER_SCHEMA_VERSION,
        "entries": {
            "decision-only": {
                "entry_schema_version": 2,
                "tool": "state.journal",
                "decision_id": "decision-only",
                "ts": "2026-01-01T00:00:00+00:00",
                "data": {},
            },
        },
    })
    before = path.read_bytes()
    rejected = _run(
        campaign_ws,
        "state.journal",
        {"summary": "must use composite key", "player_text": "我继续调查。", "decision_id": "another-id"},
    )
    assert rejected["ok"] is False
    assert rejected["error"]["code"] == "state_corrupt"
    assert path.read_bytes() == before

def test_pending_journal_rejects_terminal_state_mutation(campaign_ws):
    journaled = _run(campaign_ws, "state.journal", {
        "summary": "普通回合已经写入。",
        "player_text": "我完成这一轮行动。",
        "decision_id": "journal-before-illegal-ending",
    })
    assert journaled["ok"] is True
    ended = _run(campaign_ws, "state.end_session", {
        "kind": "retreat",
        "summary": "过晚的终局写入。",
        "decision_id": "illegal-ending-after-journal",
    })
    assert ended["ok"] is False
    assert ended["error"]["code"] == "turn_pending_finalization"

def test_state_end_session_idempotent_on_decision_id(campaign_ws):
    args = {
        "kind": "conclusion",
        "summary": "once",
        "decision_id": "toolbox-end-dup",
    }
    first = _run(campaign_ws, "state.end_session", args)
    second = _run(campaign_ws, "state.end_session", args)
    assert first["ok"] and second["ok"]
    assert second["data"] == first["data"]
    assert any("duplicate decision_id" in w for w in second["warnings"])
    endings = [
        e
        for e in _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "events.jsonl")
        if e.get("event_type") == "session_ending" and e.get("summary") == "once"
    ]
    assert len(endings) == 1

def test_state_end_session_process_retry_reuses_persisted_ending(
    campaign_ws, monkeypatch
):
    original = coc_toolbox.coc_runtime_ops.settle_development

    def crash_before_settlement(*_args, **_kwargs):
        raise SystemExit("simulated host process exit")

    monkeypatch.setattr(
        coc_toolbox.coc_runtime_ops,
        "settle_development",
        crash_before_settlement,
    )
    args = {
        "kind": "cliffhanger",
        "summary": "ending survives a host crash",
        "decision_id": "toolbox-end-crash-retry",
    }
    with pytest.raises(SystemExit, match="simulated host process exit"):
        _run(campaign_ws, "state.end_session", args)

    added_investigator = _add_eleanor_to_party(campaign_ws)
    # Party membership may change while a crashed ending is pending.  The
    # durable ending still owns its original target, even when that actor is
    # no longer in the current party projection.
    coc_state.link_party(
        campaign_ws["workspace"],
        campaign_ws["campaign_id"],
        [added_investigator],
    )

    monkeypatch.setattr(
        coc_toolbox.coc_runtime_ops,
        "settle_development",
        original,
    )
    recovered = _run(campaign_ws, "state.end_session", args)
    assert recovered["ok"] is True
    assert recovered["data"]["development"]["status"] == "PASS"
    assert recovered["data"]["investigator_ids"] == [campaign_ws["investigator_id"]]
    assert recovered["data"]["retry_target_conflict"] == {
        "code": "SETTLEMENT_TARGET_CONFLICT",
        "frozen_investigator_ids": [campaign_ws["investigator_id"]],
        "retry_investigator_ids": [added_investigator],
        "resolution": "frozen_targets_preserved",
    }
    assert any(
        "SETTLEMENT_TARGET_CONFLICT" in warning
        for warning in recovered["warnings"]
    )
    endings = [
        row
        for row in _read_jsonl(
            campaign_ws["campaign_dir"] / "logs" / "events.jsonl"
        )
        if row.get("event_type") == "session_ending"
        and row.get("decision_id") == args["decision_id"]
    ]
    assert len(endings) == 1
    assert endings[0]["investigator_ids"] == [campaign_ws["investigator_id"]]
    assert not (
        campaign_ws["campaign_dir"]
        / "save"
        / "development-settlements"
        / f"{added_investigator}.json"
    ).exists()

def test_pending_ending_capsule_survives_newer_ending_with_its_own_inputs(
    campaign_ws, monkeypatch
):
    investigator_id = campaign_ws["investigator_id"]
    state_path = (
        campaign_ws["campaign_dir"] / "save" / "investigator-state"
        / f"{investigator_id}.json"
    )
    spot_tick = coc_toolbox.coc_development.record_skill_tick(
        campaign_ws["campaign_dir"],
        investigator_id,
        "Spot Hidden",
        {
            "skill": "Spot Hidden",
            "outcome": "regular_success",
            "success": True,
            "roll": 20,
            "target": 50,
            "kind": "skill_check",
        },
        source_event_id="capsule-pending-spot",
        source_kind="toolbox-test",
    )
    assert spot_tick is not None

    original = coc_toolbox.coc_runtime_ops.settle_development

    def unavailable(*_args, **_kwargs):
        raise OSError("first ending settlement is offline")

    monkeypatch.setattr(
        coc_toolbox.coc_runtime_ops, "settle_development", unavailable
    )
    first_args = {
        "kind": "cliffhanger",
        "summary": "first ending remains pending",
        "decision_id": "ending-capsule-first-pending",
    }
    first = _run(campaign_ws, "state.end_session", first_args)
    assert first["ok"] is True
    assert first["data"]["development"]["status"] == "PENDING"
    first_ending_id = first["data"]["ending_id"]
    first_capsule = coc_toolbox.coc_development.load_ending_settlement_capsule(
        campaign_ws["campaign_dir"], first_ending_id
    )
    assert first_capsule is not None
    assert first_capsule["development_inputs"][investigator_id][
        "skills_checked"
    ] == ["Spot Hidden"]
    first_story_digest = first_capsule["source_digest"]["story_graph"]
    assert first_story_digest["exists"] is True
    assert first_capsule["source_digest"]["combat_snapshot"]["exists"] is False

    # Play continues without a narrative gate.  A later ending sees the old
    # capsule's durable claim and owns only the newly earned Listen check.
    # Even if current scenario/combat inputs change, retrying the first ending
    # must continue to consume its own immutable source/evidence snapshot.
    graph_path = campaign_ws["campaign_dir"] / "scenario" / "story-graph.json"
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    graph["test_revision"] = "newer-ending-only"
    _write_json(graph_path, graph)
    combat_path = campaign_ws["campaign_dir"] / "save" / "combat.json"
    _write_json(combat_path, {"status": "newer-ending-only"})
    listen_tick = coc_toolbox.coc_development.record_skill_tick(
        campaign_ws["campaign_dir"],
        investigator_id,
        "Listen",
        {
            "skill": "Listen",
            "outcome": "regular_success",
            "success": True,
            "roll": 20,
            "target": 50,
            "kind": "skill_check",
        },
        source_event_id="capsule-pending-listen",
        source_kind="toolbox-test",
    )
    assert listen_tick is not None
    monkeypatch.setattr(
        coc_toolbox.coc_runtime_ops, "settle_development", original
    )
    second = _run(
        campaign_ws,
        "state.end_session",
        {
            "kind": "retreat",
            "summary": "a newer ending settles first",
            "decision_id": "ending-capsule-second",
        },
    )
    assert second["ok"] is True
    assert second["data"]["development"]["status"] == "PASS"
    second_ending_id = second["data"]["ending_id"]
    assert second_ending_id != first_ending_id
    second_capsule = coc_toolbox.coc_development.load_ending_settlement_capsule(
        campaign_ws["campaign_dir"], second_ending_id
    )
    assert second_capsule is not None
    assert second_capsule["source_digest"]["story_graph"] != first_story_digest
    assert second_capsule["source_digest"]["combat_snapshot"]["exists"] is True
    second_result = second["data"]["development"]["settlements"][0][
        "receipt"
    ]["result"]
    assert second_result["ending_evidence"]["ending_id"] == second_ending_id
    assert second_result["skills_checked"] == ["Listen"]
    assert json.loads(state_path.read_text(encoding="utf-8"))[
        "skill_checks_earned"
    ] == []

    recovered = _run(campaign_ws, "state.end_session", first_args)
    assert recovered["ok"] is True
    assert recovered["data"]["ending_id"] == first_ending_id
    first_result = recovered["data"]["development"]["settlements"][0][
        "receipt"
    ]["result"]
    assert first_result["ending_evidence"]["ending_id"] == first_ending_id
    assert first_result["ending_evidence"]["source_digest"] == first_capsule[
        "source_digest"
    ]
    assert first_result["ending_evidence"]["conclusion_evidence"] == (
        first_capsule["conclusion_evidence"]
    )
    assert first_result["skills_checked"] == ["Spot Hidden"]
    assert coc_toolbox.coc_development.ending_settlement_path(
        campaign_ws["campaign_dir"], first_ending_id, investigator_id
    ).is_file()
    assert coc_toolbox.coc_development.ending_settlement_path(
        campaign_ws["campaign_dir"], second_ending_id, investigator_id
    ).is_file()
    assert not (
        campaign_ws["campaign_dir"] / "save" / "development-settlements"
        / f"{investigator_id}.json"
    ).exists()

def test_current_settlement_writes_only_exact_ending_receipt(campaign_ws):
    investigator_id = campaign_ws["investigator_id"]
    base_layout = (
        campaign_ws["campaign_dir"] / "save" / "development-settlements"
        / f"{investigator_id}.json"
    )
    ended = _run(campaign_ws, "state.end_session", {
        "kind": "cliffhanger",
        "summary": "only the exact ending receipt is current state",
        "decision_id": "exact-only-ending",
    })

    assert ended["ok"] is True
    assert ended["data"]["development"]["status"] == "PASS"
    receipt = ended["data"]["development"]["settlements"][0]["receipt"]
    assert receipt["status"] == "PASS"
    assert "projection_repair_needed" not in receipt
    assert "warnings" not in receipt
    exact = coc_toolbox.coc_development.ending_settlement_path(
        campaign_ws["campaign_dir"], ended["data"]["ending_id"], investigator_id
    )
    assert exact.is_file()
    assert not base_layout.exists()

def test_end_session_rejects_unsafe_target_before_lock_path_creation(campaign_ws):
    outside = campaign_ws["workspace"] / "escaped-lock-target"
    escaped_lock = outside / ".investigator.lock"
    result = _run(campaign_ws, "state.end_session", {
        "kind": "cliffhanger",
        "investigator": "../../../escaped-lock-target",
        "decision_id": "unsafe-ending-target",
    })

    assert result["ok"] is False
    assert result["error"]["code"] == "invalid_param"
    assert not outside.exists()
    assert not escaped_lock.exists()

def test_versioned_ending_does_not_recompile_when_capsule_is_missing(
    campaign_ws, monkeypatch
):
    original = coc_toolbox.coc_runtime_ops.settle_development

    def unavailable(*_args, **_kwargs):
        raise OSError("settlement temporarily offline")

    monkeypatch.setattr(
        coc_toolbox.coc_runtime_ops, "settle_development", unavailable
    )
    args = {
        "kind": "cliffhanger",
        "summary": "capsule loss must fail closed",
        "decision_id": "ending-capsule-missing",
    }
    first = _run(campaign_ws, "state.end_session", args)
    assert first["ok"] is True
    assert first["data"]["development"]["status"] == "PENDING"
    ending_id = first["data"]["ending_id"]
    capsule_path = coc_toolbox.coc_development.ending_settlement_capsule_path(
        campaign_ws["campaign_dir"], ending_id
    )
    capsule_path.unlink()
    monkeypatch.setattr(
        coc_toolbox.coc_runtime_ops, "settle_development", original
    )

    retried = _run(campaign_ws, "state.end_session", args)

    assert retried["ok"] is True
    assert retried["data"]["development"]["status"] == "PENDING"
    assert retried["data"]["development"]["error"] == (
        "persisted ending evidence is unavailable"
    )
    assert not coc_toolbox.coc_development.ending_settlement_path(
        campaign_ws["campaign_dir"], ending_id, campaign_ws["investigator_id"]
    ).exists()

def test_event_only_retry_preserves_explicit_empty_ending_targets(
    campaign_ws, monkeypatch
):
    coc_state.link_party(
        campaign_ws["workspace"], campaign_ws["campaign_id"], []
    )
    original_record = coc_toolbox.Ctx.ledger_record

    def crash_before_ledger(self, decision_id, tool, data):
        if tool == "state.end_session" and decision_id == "ending-empty-crash":
            raise SystemExit("crash after empty ending event")
        return original_record(self, decision_id, tool, data)

    monkeypatch.setattr(coc_toolbox.Ctx, "ledger_record", crash_before_ledger)
    args = {
        "kind": "cliffhanger",
        "summary": "no investigators are linked",
        "decision_id": "ending-empty-crash",
    }
    with pytest.raises(SystemExit, match="empty ending event"):
        _run(campaign_ws, "state.end_session", args)

    monkeypatch.setattr(coc_toolbox.Ctx, "ledger_record", original_record)
    coc_state.link_party(
        campaign_ws["workspace"],
        campaign_ws["campaign_id"],
        [campaign_ws["investigator_id"]],
    )
    replay = _run(campaign_ws, "state.end_session", args)
    assert replay["ok"] is True
    assert replay["data"]["investigator_ids"] == []
    assert replay["data"]["development"] == {
        "status": "PASS",
        "ending_id": replay["data"]["ending_id"],
        "settlements": [],
    }
    assert replay["data"]["retry_target_conflict"] == {
        "code": "SETTLEMENT_TARGET_CONFLICT",
        "frozen_investigator_ids": [],
        "retry_investigator_ids": [campaign_ws["investigator_id"]],
        "resolution": "frozen_targets_preserved",
    }
    endings = [
        row for row in _read_jsonl(
            campaign_ws["campaign_dir"] / "logs" / "events.jsonl"
        )
        if row.get("decision_id") == args["decision_id"]
        and row.get("event_type") == "session_ending"
    ]
    assert len(endings) == 1
    assert endings[0]["investigator_ids"] == []

def test_state_end_session_rejects_unknown_ending_kind(campaign_ws):
    envelope = _run(
        campaign_ws,
        "state.end_session",
        {
            "kind": "combat_finished",
            "summary": "not a canonical session boundary",
            "decision_id": "toolbox-end-invalid-kind",
        },
    )
    assert envelope["ok"] is False
    assert envelope["error"]["code"] == "invalid_param"

def test_toolbox_returns_typed_recovery_conflict_without_touching_foreign_state(
    campaign_ws, monkeypatch
):
    runtime_ops = coc_toolbox.coc_runtime_ops
    character_path = (
        campaign_ws["coc_root"]
        / "investigators"
        / campaign_ws["investigator_id"]
        / "character.json"
    )
    original_write = runtime_ops.coc_fileio.write_text_atomic
    crashed = False

    def crash_after_character(path, text):
        nonlocal crashed
        original_write(path, text)
        if Path(path) == character_path and not crashed:
            crashed = True
            raise SystemExit("toolbox settlement process crash")

    monkeypatch.setattr(
        runtime_ops.coc_fileio, "write_text_atomic", crash_after_character
    )
    with pytest.raises(SystemExit, match="toolbox settlement process crash"):
        _run(
            campaign_ws,
            "state.end_session",
            {
                "kind": "cliffhanger",
                "summary": "durable ending before recovery conflict",
                "decision_id": "toolbox-recovery-conflict-ending",
            },
        )
    monkeypatch.setattr(
        runtime_ops.coc_fileio, "write_text_atomic", original_write
    )

    inv_path = (
        campaign_ws["campaign_dir"]
        / "save"
        / "investigator-state"
        / f"{campaign_ws['investigator_id']}.json"
    )
    foreign = json.loads(inv_path.read_text(encoding="utf-8"))
    foreign["foreign_integrity_receipt"] = "preserve-exactly"
    _write_json(inv_path, foreign)
    bytes_before = inv_path.read_bytes()
    event_path = campaign_ws["campaign_dir"] / "logs" / "events.jsonl"
    turns_before = len([
        row for row in _read_jsonl(event_path)
        if row.get("event_type") == "turn"
    ])

    blocked = _run(
        campaign_ws,
        "state.journal",
        {
            "summary": "must not commit while integrity is unresolved",
            "player_text": "我继续调查。",
            "decision_id": "journal-after-recovery-conflict",
        },
    )
    assert blocked["ok"] is False
    assert blocked["error"]["code"] == "recovery_conflict"
    assert blocked["recovery"]["status"] == "RECOVERY_CONFLICT"
    assert (
        f"campaigns/{campaign_ws['campaign_id']}/save/investigator-state/"
        f"{campaign_ws['investigator_id']}.json"
    ) in blocked["recovery"]["conflicting_paths"]
    assert inv_path.read_bytes() == bytes_before
    assert json.loads(inv_path.read_text(encoding="utf-8"))[
        "foreign_integrity_receipt"
    ] == "preserve-exactly"
    assert len([
        row for row in _read_jsonl(event_path)
        if row.get("event_type") == "turn"
    ]) == turns_before

@pytest.mark.parametrize("play_language", ["en-US", "ja-JP"])
def test_narration_brief_uses_campaign_play_language(campaign_ws, play_language):
    description = coc_toolbox.TOOLS["narration.brief"]["summary"]
    assert "Chinese" not in description
    assert "play_language" in description
    campaign_path = campaign_ws["campaign_dir"] / "campaign.json"
    campaign = json.loads(campaign_path.read_text(encoding="utf-8"))
    campaign["play_language"] = play_language
    campaign_path.write_text(
        json.dumps(campaign, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    narration = _run(campaign_ws, "narration.brief", {
        "candidate_plan": {},
        "applied_events": [],
    })

    assert narration["ok"] is True, narration
    style = narration["data"]["style_contract"]
    assert style["language"] == play_language
    assert style["deterministic_guard"] == "unavailable"
