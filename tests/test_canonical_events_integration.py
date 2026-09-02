"""True end-to-end canonical-events integration (plan task t8).

Drives ONE real fixture campaign entirely through public typed toolbox
operations — ``rules.roll`` / ``state.record_clue`` / ``state.move_scene`` /
``rules.sanity_check`` / ``state.item_grant`` / ``npc.reaction`` /
``state.npc_update`` / ``state.belief_apply`` / ``state.journal`` /
``turn.output_context`` / ``turn.finalize`` — the same production surface a
live Keeper uses, then asserts external behavior across every layer the
coc-events-1 wave delivered:

- the canonical JSONL carries the exact wired fact classes in monotonic
  per-timeline sequence under full envelope validation;
- ``decision_id`` idempotency collapses replays and failed mutations leave
  no event behind;
- ``turn-finalized`` is the played turn's release boundary while the v1-
  permitted advisory ``memory-written`` follows it;
- the incremental SQLite projection is row-equivalent to delete-and-rebuild;
- structured ``events.query`` filters (timeline/types/entities/turn) and
  privacy views behave, and public surfaces can never observe the secret
  keeper-side grant;
- the completeness validator accepts the intact evidence, classifies the
  surviving uncovered-write rows precisely (decision-less, key-less sidecar
  echoes only — no settled operation, required die, or finalization among
  them), and fails on copied-fixture streams where a required event was
  removed, duplicated, or number-mismatched. Real evidence is never mutated.

Known documented gaps are NOT invented coverage: removal-without-holder,
finance purchase paths, and sanity-internal dice stay outside this flow
(exercising them would produce evidence rows the wave deliberately left
unwired).
"""
from __future__ import annotations

import json
import shutil
import sqlite3
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import coc_canonical_events as cem
import coc_canonical_events_validate as cv
import coc_starter
import coc_toolbox

CAMPAIGN = "ev8-integration"
TIMELINE = "tl-main"

#: Exact typed-op flow a live turn settles through public operations,
#: expressed as the canonical facts each settlement must leave behind.
EXPECTED_STREAM_TYPES = [
    "roll-resolved",
    "clue-discovered",
    "scene-moved",
    "sanity-changed",
    "item-transferred",  # investigator gear grant (public)
    "item-transferred",  # keeper-side NPC stash grant (secret)
    "npc-relationship-changed",  # first impression
    "npc-relationship-changed",  # trust delta
    "npc-relationship-changed",  # fear delta
    "belief-asserted",
    "player-declared",
    "turn-started",
    "turn-finalized",
    "memory-written",  # post-finalization advisory derivation
]


@pytest.fixture()
def _fresh_emission_runtime():
    cem.reset_emission_runtime_state()
    yield
    cem.reset_emission_runtime_state()


def _call(ws: dict[str, object], tool: str, args: dict | None = None) -> dict:
    return coc_toolbox.run_tool(
        tool, Path(ws["workspace"]), str(ws["campaign_id"]), dict(args or {}),
    )


def _ok(ws: dict[str, object], tool: str, args: dict | None = None) -> dict:
    result = _call(ws, tool, args)
    assert result.get("ok") is True, {tool: result.get("error")}
    return result


def _stream_rows(campaign_dir: Path) -> list[dict]:
    stream = Path(campaign_dir) / "logs" / cem.CANONICAL_STREAM_NAME
    if not stream.is_file():
        return []
    return [
        json.loads(line)
        for line in stream.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def _journey(ws: dict[str, object]) -> dict[str, object]:
    """Play one authored-free turn through public operations only."""
    investigator = str(ws["investigator_id"])
    campaign_dir = Path(ws["campaign_dir"])

    roll = _ok(ws, "rules.roll", {
        "investigator": investigator,
        "skill": "Library Use",
        "difficulty": "regular",
        "goal": "从档案中找到团伙活动的旧记录",
        "stakes": {"on_success": "找到相关卷宗", "on_failure": "暂时找不到"},
        "difficulty_basis": "keeper_judgment",
        "seed": 11,
        "decision_id": "integ-roll-1",
    })["data"]

    clue_id = str(_ok(ws, "clues.query")["data"]["clues"][0]["clue_id"])
    _ok(ws, "state.record_clue", {
        "clue_id": clue_id,
        "method": "exploration",
        "decision_id": "integ-clue-1",
    })

    move = _ok(ws, "state.move_scene", {
        "scene_id": "newspaper-morgue",
        "decision_id": "integ-move-1",
        "reason": "前往报社档案室核对旧报道",
    })["data"]
    assert move["to_scene_id"] == "newspaper-morgue"

    # Nonzero SAN change: probe deterministic seeds until the loss die bites.
    san_result = None
    for seed in range(1, 12):
        result = _ok(ws, "rules.sanity_check", {
            "investigator": investigator,
            "source": f"integ-apparition-{seed}",
            "loss_failure": "1D6",
            "loss_success": "0",
            "involuntary_action": {
                "kind": "freeze",
                "summary": "The investigator locks up for a beat.",
            },
            "seed": seed,
            "decision_id": f"integ-san-{seed}",
        })["data"]
        if result["san_before"] != result["san_after"]:
            san_result = result
            break
    assert san_result is not None, "no deterministic SAN loss across seeds"

    _ok(ws, "state.item_grant", {
        "investigator": investigator,
        "kind": "gear",
        "item_id": "old-flashlight",
        "label": "旧手电筒",
        "consumable": True,
        "quantity": 2,
        "note": "从报社储物间取得",
        "decision_id": "integ-grant-inv-1",
    })
    _ok(ws, "state.item_grant", {
        "npc_id": "integ-npc-stash",
        "kind": "gear",
        "item_id": "hidden-revolver",
        "label": "隐藏的左轮",
        "decision_id": "integ-grant-npc-secret-1",
    })

    agendas = json.loads(
        (campaign_dir / "scenario" / "npc-agendas.json").read_text(encoding="utf-8")
    )
    npc_id = next(
        str(npc["npc_id"]) for npc in agendas["npcs"]
        if isinstance(npc, dict) and npc.get("npc_id")
    )
    reaction = _ok(ws, "npc.reaction", {
        "npc_id": npc_id,
        "npc_display_name": "档案室管理员",
        "investigator": investigator,
        "context": {
            "player_conduct": "调查员清楚说明来意并尊重对方的工作边界",
            "scene_constraints": "当前场景的职责与安全边界仍然有效",
            "authored_or_relationship_boundary": "初次见面不会改写 NPC 的身份、立场或权限",
            "semantic_reason": "外表与信用只影响对方起初的接纳方式",
        },
        "seed": 7,
        "decision_id": "integ-reaction-1",
    })["data"]
    update = _ok(ws, "state.npc_update", {
        "npc_id": npc_id,
        "investigator": investigator,
        "trust_delta": 2,
        "fear_delta": -1,
        "decision_id": "integ-npcupd-1",
    })["data"]

    _ok(ws, "state.belief_apply", {
        "candidate_plan": {
            "decision_id": "integ-belief-1",
            "turn_input": {
                "turn_number": 1,
                "player_intent_rich": {
                    "primary_intent": "investigate",
                    "player_hypothesis": "报社档案室里藏着团伙活动的旧记录。",
                },
            },
        },
        "committed_clue_ids": [clue_id],
        "investigator": investigator,
        "decision_id": "integ-belief-1",
    })

    _ok(ws, "state.journal", {
        "summary": "调查员读信后前往报社档案室，用一次检索赌上了自己的方法。",
        "player_action": "按档案检索推进",
        "player_text": "我翻出 1920 年代的合订本，专找那栋房子的旧新闻。",
        "player_speaker": "玩家",
        "run_id": "integration-run-1",
        "intent_class": "investigate",
        "decision_id": "integ-journal-1",
    })

    output = _ok(ws, "turn.output_context")["data"]
    result_paragraph = "检索在合订本里咬住了目标：旧记录被找到了，而恐惧也随之而来。"
    draft = (
        "调查员把检索方法落实到眼前的合订本上。\n\n"
        + result_paragraph
    )
    coverage = [
        {
            "obligation_id": row["obligation_id"],
            "realization": "fictional_beat",
            "action_realization": "调查员完成了这轮已结算的检索行动",
            "response": "档案与场景按权威结算结果作出了对应反应",
            "causal_explanation": "该反应直接来自本轮已经结算的行动结果",
            "persona_fit": "保持调查员既有的身份与立场",
            "player_input_handling": "specific_preserved",
            "exact_excerpt": result_paragraph,
            "exceptional_beat": "",
        }
        for row in output["obligations"]
    ]
    placements = []
    for segment_type, source_key, after in (
        ("public_check", "roll_id", 0),
        ("state_delta", "effect_id", 1),
        ("exceptional_effect", "event_id", 1),
    ):
        bundle_rows = output["mechanics_bundle"].get(segment_type) or []
        if bundle_rows:
            placements.append({
                "after_paragraph": after,
                "segment_type": segment_type,
                "source_ids": [str(entry[source_key]) for entry in bundle_rows],
            })
    finalized = _ok(ws, "turn.finalize", {
        "draft": draft,
        "coverage": coverage,
        "mechanics_placements": placements,
        "revision": 1,
        "decision_id": "integ-finalize-1",
    })["data"]

    return {
        "roll": roll,
        "clue_id": clue_id,
        "san": san_result,
        "npc_id": npc_id,
        "reaction_tier": reaction["reaction_tier"],
        "psych_trust": int(update["psych"]["trust"]),
        "finalized": finalized,
        "investigator": investigator,
    }


@pytest.fixture(scope="module")
def journey(tmp_path_factory: pytest.TempPathFactory) -> dict[str, object]:
    """One real campaign played end-to-end once; every test reads evidence."""
    root = tmp_path_factory.mktemp("ev8-journey")
    workspace = root / "workspace"
    coc_root = workspace / ".coc"
    coc_root.mkdir(parents=True)
    (coc_root / "runtime.json").write_text(json.dumps({
        "schema_version": 2,
        "planner": {"kind": "deterministic"},
        "rules": {"kind": "deterministic"},
        "narrator": {"kind": "template"},
        "player": {"kind": "human"},
    }), encoding="utf-8")
    cem.reset_emission_runtime_state()
    try:
        quick = coc_starter.quick_start(
            coc_root, "the-haunting", "thomas-hayes",
            campaign_id=CAMPAIGN, title="Canonical Events Integration",
        )
        ws = {
            "workspace": workspace,
            "campaign_id": CAMPAIGN,
            "campaign_dir": Path(quick["campaign_dir"]),
            "investigator_id": str(quick["investigator_id"]),
        }
        outcomes = _journey(ws)
        ws.update(outcomes)
        ws["rows"] = _stream_rows(Path(ws["campaign_dir"]))
        return ws
    finally:
        cem.reset_emission_runtime_state()


# ---------------------------------------------------------------------------
# Stream-level external behavior
# ---------------------------------------------------------------------------


def test_stream_carries_exactly_the_wired_types_in_order(
    journey: dict[str, object],
) -> None:
    rows = journey["rows"]
    assert [row["type"] for row in rows] == EXPECTED_STREAM_TYPES

    sequences = [row["sequence"] for row in rows]
    assert sequences == list(range(1, len(rows) + 1))
    assert {row["timeline"] for row in rows} == {TIMELINE}

    secrets = [row for row in rows if row["privacy"] == "secret"]
    assert [(r["type"], r["decision_id"]) for r in secrets] == [
        ("item-transferred", "integ-grant-npc-secret-1"),
    ]

    for row in rows:
        cem.validate_event(row)
        assert row["specversion"] == cem.SPECVERSION
        assert row["campaign"] == CAMPAIGN
        assert row["turn"] == 1
        assert row["id"].startswith(f"{row['type']}-")
        assert isinstance(row["decision_id"], str) and row["decision_id"]


def test_settled_payloads_match_authoritative_results(
    journey: dict[str, object],
) -> None:
    rows = journey["rows"]

    roll_row = next(r for r in rows if r["type"] == "roll-resolved")
    roll = journey["roll"]
    assert roll_row["decision_id"] == "integ-roll-1"
    assert roll_row["data"]["roll_id"] == roll["roll_id"]
    assert roll_row["data"]["result_level"] == roll["outcome"]
    assert roll_row["data"]["target_value"] == roll["target"]

    clue_row = next(r for r in rows if r["type"] == "clue-discovered")
    assert clue_row["data"]["clue_id"] == journey["clue_id"]
    assert clue_row["data"]["discovered_by"] == journey["investigator"]

    san_row = next(r for r in rows if r["type"] == "sanity-changed")
    san = journey["san"]
    assert san_row["data"]["delta"] == (
        san["san_after"] - san["san_before"]
    ) < 0
    assert san_row["data"]["before"] == san["san_before"]
    assert san_row["data"]["after"] == san["san_after"]

    belief_row = next(r for r in rows if r["type"] == "belief-asserted")
    assert belief_row["data"]["holder"] == journey["investigator"]
    assert belief_row["data"]["mode"] == "asserted"

    relationship = [
        r for r in rows if r["type"] == "npc-relationship-changed"
    ]
    assert [r["data"]["channel"] for r in relationship] == [
        "first-impression", "trust", "fear",
    ]
    assert relationship[0]["data"]["after"] == journey["reaction_tier"]
    assert relationship[1]["data"]["after"] == journey["psych_trust"]


def test_finalized_is_release_boundary_and_memory_written_follows(
    journey: dict[str, object],
) -> None:
    rows = journey["rows"]
    finalized = next(row for row in rows if row["type"] == "turn-finalized")
    assert finalized["privacy"] == "public"
    assert finalized["decision_id"] == "integ-finalize-1"
    assert finalized["data"]["finalization_id"] == (
        journey["finalized"]["finalization_id"]
    )

    started = next(row for row in rows if row["type"] == "turn-started")
    assert finalized["turn"] == started["turn"] == 1

    # Authoritative release boundary, physical-tail position notwithstanding:
    # every same-turn non-advisory event precedes it; only the v1-permitted
    # advisory derivation may follow.
    after = rows[rows.index(finalized) + 1:]
    assert [row["type"] for row in after] == ["memory-written"]
    assert all(row["sequence"] > finalized["sequence"] for row in after)


def test_replayed_decision_appends_no_duplicate_event(
    journey: dict[str, object],
) -> None:
    ws = journey
    before = _stream_rows(Path(ws["campaign_dir"]))
    rolls_before = sum(
        1 for row in before if row["type"] == "roll-resolved"
    )

    replay = _ok(ws, "rules.roll", {
        "investigator": ws["investigator"],
        "skill": "Library Use",
        "difficulty": "regular",
        "goal": "从档案中找到团伙活动的旧记录",
        "stakes": {"on_success": "找到相关卷宗", "on_failure": "暂时找不到"},
        "difficulty_basis": "keeper_judgment",
        "seed": 11,
        "decision_id": "integ-roll-1",
    })["data"]
    assert replay["roll_id"] == ws["roll"]["roll_id"]

    after = _stream_rows(Path(ws["campaign_dir"]))
    assert len(after) == len(before)
    assert sum(1 for row in after if row["type"] == "roll-resolved") == (
        rolls_before
    )


def test_failed_mutations_leave_no_canonical_event(
    journey: dict[str, object], _fresh_emission_runtime: None,
) -> None:
    ws = journey
    before = _stream_rows(Path(ws["campaign_dir"]))

    missing_decision = _call(ws, "state.journal", {
        "summary": "缺少幂等键的声明不能落账",
        "player_text": "这条声明不应产生任何事件。",
    })
    bad_expression = _call(ws, "rules.sanity_check", {
        "investigator": ws["investigator"],
        "source": "integ-bad-source",
        "loss_failure": "这 不是 掷骰 表达式",
        "loss_success": "0",
        "involuntary_action": {
            "kind": "freeze",
            "summary": "The investigator locks up for a beat.",
        },
        "decision_id": "integ-bad-san-1",
    })
    assert missing_decision.get("ok") is False
    assert bad_expression.get("ok") is False

    after = _stream_rows(Path(ws["campaign_dir"]))
    assert [row["id"] for row in after] == [row["id"] for row in before]


# ---------------------------------------------------------------------------
# Privacy: secret keeper-side evidence never reaches public surfaces
# ---------------------------------------------------------------------------


def test_public_surfaces_cannot_observe_secret_grant(
    journey: dict[str, object],
) -> None:
    logs = Path(journey["campaign_dir"]) / "logs"

    player_view = cem.project_player_view(journey["rows"])
    assert "integ-grant-npc-secret-1" not in [
        row["decision_id"] for row in player_view
    ]

    public_query = cem.query_events(logs, types=["item-transferred"])
    assert [e["data"]["to_holder"] for e in public_query["events"]] == [
        journey["investigator"]
    ]

    secret_query = cem.query_events(
        logs, types=["item-transferred"], privacy="secret"
    )
    assert [e["decision_id"] for e in secret_query["events"]] == [
        "integ-grant-npc-secret-1"
    ]


# ---------------------------------------------------------------------------
# Projection layer: incremental apply vs delete+rebuild
# ---------------------------------------------------------------------------


def _dump_projection(db_path: Path) -> tuple[list[tuple], str]:
    conn = sqlite3.connect(db_path)
    try:
        rows = conn.execute(
            "SELECT timeline, sequence, turn, event_type, privacy,"
            " payload_json FROM events ORDER BY timeline, sequence"
        ).fetchall()
        digest = cem.events_projection_digest(conn)
    finally:
        conn.close()
    return rows, digest


def test_incremental_projection_is_row_equivalent_to_rebuild(
    journey: dict[str, object], _fresh_emission_runtime: None,
) -> None:
    logs = Path(journey["campaign_dir"]) / "logs"
    db_path = cem.events_projection_path(logs)
    assert db_path.is_file()  # hook-applied incrementally during the journey

    incremental_rows, incremental_digest = _dump_projection(db_path)

    rebuilt = cem.rebuild_events_projection(logs)
    assert rebuilt["status"] == "rebuilt"
    rebuilt_rows, rebuilt_digest = _dump_projection(db_path)

    assert incremental_rows == rebuilt_rows
    assert incremental_digest == rebuilt_digest
    assert len(rebuilt_rows) == len(EXPECTED_STREAM_TYPES)

    # Re-applying an already-consumed stream is a no-op.
    status = cem.apply_events_projection(logs)
    assert status["status"] == "unchanged"


# ---------------------------------------------------------------------------
# Structured query: filters / timeline / entities
# ---------------------------------------------------------------------------


def test_structured_query_filters_narrow_exactly(
    journey: dict[str, object],
) -> None:
    logs = Path(journey["campaign_dir"]) / "logs"
    roll_id = journey["roll"]["roll_id"]

    by_timeline = cem.query_events(logs, timeline=TIMELINE)
    # Default privacy view is public: the keeper-side secret grant is
    # structurally absent from it.
    assert len(by_timeline["events"]) == len(EXPECTED_STREAM_TYPES) - 1
    all_view = cem.query_events(logs, timeline=TIMELINE, privacy="all")
    assert len(all_view["events"]) == len(EXPECTED_STREAM_TYPES)
    assert all_view["count"] == len(EXPECTED_STREAM_TYPES)

    by_range = cem.query_events(
        logs, turn_from=1, turn_to=1, privacy="all"
    )
    assert len(by_range["events"]) == len(EXPECTED_STREAM_TYPES)

    by_types = cem.query_events(
        logs, types=["roll-resolved", "scene-moved"]
    )
    assert sorted(e["type"] for e in by_types["events"]) == [
        "roll-resolved", "scene-moved",
    ]

    by_entity = cem.query_events(logs, entity_refs=[roll_id])
    assert {e["type"] for e in by_entity["events"]} == {
        # The roll itself plus the finalized turn binding it.
        "roll-resolved", "turn-finalized",
    }
    unknown_entity = cem.query_events(logs, entity_refs=["no-such-entity"])
    assert unknown_entity["events"] == []

    limited = cem.query_events(logs, limit=3)
    assert limited["count"] == 3 and limited["truncated"] is True

    with pytest.raises(cem.ClosedEnumError):
        cem.query_events(logs, types=["roll-started"])


def test_registry_events_query_serves_strict_read_only_public_view(
    journey: dict[str, object],
) -> None:
    spec = coc_toolbox.TOOLS["events.query"]
    assert spec["access"] == "query"
    assert spec.get("strict_read_only") is True

    served = _ok(journey, "events.query", {"types": ["item-transferred"]})
    assert served["data"]["authority"] == "derived_evidence"
    assert served["data"]["privacy_view"] == "public"
    assert [e["data"]["to_holder"] for e in served["data"]["events"]] == [
        journey["investigator"]
    ]

    rejected = _call(journey, "events.query", {"types": ["roll-started"]})
    assert rejected.get("ok") is False
    assert rejected["error"]["code"] == "invalid_param"


# ---------------------------------------------------------------------------
# Completeness validator: intact pass + precise uncovered classification
# ---------------------------------------------------------------------------


_SIDECAR_ECHO_STREAMS = {
    "logs/events.jsonl",
    "logs/table-transcript.jsonl",
    "logs/toolbox-calls.jsonl",
}


def test_validator_accepts_intact_evidence(
    journey: dict[str, object], _fresh_emission_runtime: None,
) -> None:
    result = cv.validate_campaign(
        Path(journey["workspace"]), str(journey["campaign_id"])
    )
    assert result.ok and result.exit_code == 0
    assert result.status == cv.STATUS_PASS

    counts = result.counts
    assert counts["canonical_events"] == len(EXPECTED_STREAM_TYPES)
    assert counts["required_rolls"] == 1
    assert counts["rolls_paired"] == 1
    assert counts["rolls_missing"] == 0
    assert counts["finalizations_paired"] == 1
    assert counts["finalizations_missing"] == 0
    stats = result.timelines[TIMELINE]
    assert stats["written"] == len(EXPECTED_STREAM_TYPES)

    # Precise semantic uncovered-row classification instead of hiding the
    # ledger: every surviving row is a decision-less, key-less sidecar
    # transcript echo (journal/table narration bookkeeping), never a settled
    # typed operation, a required die, or a finalization fact.
    ledger = result.uncovered_ledger
    assert ledger["count"] >= 1
    refs = ledger["refs"]
    assert all(ref["decision_id"] is None for ref in refs)
    assert all(ref["record_key"] is None for ref in refs)
    assert {ref["stream"] for ref in refs} <= _SIDECAR_ECHO_STREAMS
    settled_keys = {
        journey["roll"]["roll_id"],
        journey["clue_id"],
        journey["finalized"]["finalization_id"],
        "old-flashlight",
        "hidden-revolver",
    }
    assert not any(
        ref["record_key"] in settled_keys or ref["decision_id"] in settled_keys
        for ref in refs
    )


# ---------------------------------------------------------------------------
# Tamper detection on copied fixture streams (real evidence untouched)
# ---------------------------------------------------------------------------


def _copied_workspace(
    journey: dict[str, object], tmp_path: Path, tag: str,
) -> Path:
    """Fresh workspace copy whose campaign dir the test may rewrite freely."""
    root = tmp_path / tag
    workspace = root / "workspace"
    campaign_copy = (
        workspace / ".coc" / "campaigns" / str(journey["campaign_id"])
    )
    campaign_copy.parent.mkdir(parents=True)
    shutil.copytree(
        Path(journey["campaign_dir"]), campaign_copy, symlinks=False
    )
    return workspace


def _rewrite_roll_event(stream_path: Path, mutate) -> None:
    lines = []
    touched = False
    for line in stream_path.read_text(encoding="utf-8").splitlines():
        row = json.loads(line)
        if row.get("type") == "roll-resolved":
            mutate(row)
            touched = True
            line = json.dumps(row, ensure_ascii=False)
        lines.append(line)
    assert touched
    stream_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


@pytest.mark.parametrize(
    ("tag", "tamper", "expected_code"),
    [
        (
            "removed",
            lambda sp: sp.write_text(
                "\n".join(
                    line for line in sp.read_text(encoding="utf-8").splitlines()
                    if line.strip()
                    and json.loads(line).get("type") != "roll-resolved"
                ) + "\n",
                encoding="utf-8",
            ),
            cv.CODE_ROLL_EVENT_MISSING,
        ),
        ("duplicate", None, cv.CODE_ROLL_EVENT_DUPLICATE),
        ("mismatch", None, cv.CODE_ROLL_TOTAL_MISMATCH),
    ],
)
def test_validator_fails_on_tampered_copies_without_touching_real_evidence(
    journey: dict[str, object],
    tmp_path: Path,
    _fresh_emission_runtime: None,
    tag: str,
    tamper,
    expected_code: str,
) -> None:
    workspace = _copied_workspace(journey, tmp_path, tag)
    stream_path = (
        workspace / ".coc" / "campaigns" / CAMPAIGN / "logs"
        / cem.CANONICAL_STREAM_NAME
    )

    def _duplicate(stream_path: Path) -> None:
        rows = [
            json.loads(line)
            for line in stream_path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        roll = next(row for row in rows if row["type"] == "roll-resolved")
        fork = dict(roll)
        fork["sequence"] = max(row["sequence"] for row in rows) + 1
        fork["id"] = f"roll-resolved-{CAMPAIGN}-{TIMELINE}-t1-occ-77"
        fork["decision_id"] = "skillcheck-integ-duplicate-fork"
        with stream_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(fork, ensure_ascii=False) + "\n")

    if tag == "duplicate":
        _duplicate(stream_path)
    elif tamper is not None:
        tamper(stream_path)
    else:
        _rewrite_roll_event(
            stream_path,
            lambda row: row["data"].update(dice="1d100=34"),
        )

    result = cv.validate_campaign(workspace, CAMPAIGN)
    assert result.exit_code == 1 and result.status == cv.STATUS_FAIL
    assert expected_code in {f.code for f in result.errors}

    # The canonical evidence in the real fixture campaign is untouched.
    intact = cv.validate_campaign(
        Path(journey["workspace"]), str(journey["campaign_id"])
    )
    assert intact.ok and intact.exit_code == 0
