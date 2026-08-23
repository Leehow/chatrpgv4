import hashlib
import importlib.util
import json
import sys
from pathlib import Path

import pytest

SCRIPT = Path("plugins/coc-keeper/skills/coc-export-battle-report/scripts/export_battle_report.py")
JSON_OUTPUT = "battle-report-evidence.json"
MARKDOWN_OUTPUT = "battle-report.md"


def _load():
    spec = importlib.util.spec_from_file_location("coc_export_battle_report_test", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _canonical_digest(value):
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def _review(
    review_id, *, turn_id="turn-1", revision=1, findings=None,
    draft_text="门上写着 **勿入**。\n第二行有 `code`。",
):
    row = {
        "schema_version": 1,
        "visibility": "keeper_internal",
        "authority": "advisory",
        "hard_gate": False,
        "decision_id": f"{review_id}-decision",
        "review_id": review_id,
        "turn_id": turn_id,
        "source_digest": "sha256:source-1",
        "revision": revision,
        "draft_sha256": _canonical_digest(draft_text),
        "request_digest": "sha256:request-1",
        "findings": list(findings or []),
        "recommendation": "consider_revision" if findings else "no_revision_suggested",
    }
    row["review_digest"] = _canonical_digest(row)
    return row


def _finalization_receipt(
    finalization_id, roll_ids, *, rendered_text="", turn_id="turn-1",
    revision=1, review=None, agency_claims=None, control_overrides=None,
):
    bundle = {
        "public_check": [], "state_delta": [], "asset_delta": [],
        "exceptional_effect": [],
    }
    coverage = []
    settlement_snapshot_id = f"turn-effect-v1:{finalization_id}"
    source_digest = "sha256:source-1"
    contract_projection = {
        "turn_id": turn_id,
        "source_digest": source_digest,
        "settlement_snapshot_id": settlement_snapshot_id,
        "control_overrides": list(control_overrides or []),
    }
    segments = [{"segment_type": "fiction", "text": rendered_text, "source_ids": []}]
    row = {
        "schema_version": 2,
        "finalization_id": finalization_id,
        "decision_id": f"{finalization_id}-decision",
        "journal_decision_id": f"{finalization_id}-journal",
        "journal_call_index": 0,
        "source_start_index": 0,
        "source_end_index": 0,
        "source_roll_ids": list(roll_ids),
        "obligation_ids": [],
        "coverage_ids": [],
        "run_segment_id": "run-1",
        "session_id": "session-1",
        "turn_id": turn_id,
        "source_digest": source_digest,
        "settlement_snapshot_id": settlement_snapshot_id,
        "rendered_text": rendered_text,
        "rendered_text_sha256": _canonical_digest(rendered_text),
        "accepted_draft_sha256": _canonical_digest(rendered_text),
        "accepted_revision": revision,
        "narration_review": (
            {
                "review_id": review["review_id"],
                "review_digest": review["review_digest"],
                "draft_sha256": _canonical_digest(rendered_text),
            }
            if isinstance(review, dict) else None
        ),
        "agency_claims": list(agency_claims or []),
        "contract_projection": contract_projection,
        "contract_projection_sha256": _canonical_digest(contract_projection),
        "bundle": bundle,
        "bundle_sha256": _canonical_digest(bundle),
        "coverage": coverage,
        "coverage_sha256": _canonical_digest(coverage),
        "segments": segments,
    }
    row["integrity_digest"] = _canonical_digest(row)
    return row


def _refresh_receipt(receipt):
    receipt["contract_projection_sha256"] = _canonical_digest(receipt["contract_projection"])
    receipt["bundle_sha256"] = _canonical_digest(receipt["bundle"])
    receipt["coverage_sha256"] = _canonical_digest(receipt["coverage"])
    receipt["accepted_draft_sha256"] = _canonical_digest(
        "\n\n".join(
            segment["text"] for segment in receipt["segments"]
            if segment["segment_type"] == "fiction"
        )
    )
    receipt["rendered_text_sha256"] = _canonical_digest(receipt["rendered_text"])
    receipt.pop("integrity_digest", None)
    receipt["integrity_digest"] = _canonical_digest(receipt)
    return receipt


SCRIPTS = Path("plugins/coc-keeper/scripts")


def _load_script(name: str, path: Path):
    cached = sys.modules.get(name)
    if cached is not None:
        return cached
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def _canonical_transcript_path(run: Path):
    return run / "sandbox" / ".coc" / "campaigns" / "case-1" / "logs" / "table-transcript.jsonl"


def _canonical_run_identity(campaign_id="case-1"):
    return {
        "schema_version": 1,
        "campaign_id": campaign_id,
        "run_segment_id": "run-1",
        "session_id": "session-1",
        "plugin_version": "0.4.0-alpha.0",
        "ruleset_id": "coc7",
        "ruleset_version": "1.0.0",
    }


def _write_run_identity(campaign: Path, **overrides):
    payload = _canonical_run_identity(campaign.name)
    payload.update(overrides)
    _write_json(campaign / "save" / "run-identity.json", payload)
    return payload


def _prove_git_state(run: Path, campaign_id="case-1"):
    hist = _load_script("coc_git_history_export_test", SCRIPTS / "coc_git_history.py")
    state = _load_script("coc_state_export_test", SCRIPTS / "coc_state.py")
    root = run / "sandbox"
    campaign = root / ".coc" / "campaigns" / campaign_id
    if not (campaign / "campaign.json").exists():
        _write_json(campaign / "campaign.json", {
            "schema_version": 3,
            "campaign_id": campaign_id,
            "ruleset_id": "coc7",
            "title": "Export Fixture",
        })
    world_path = campaign / "save" / "world-state.json"
    world = json.loads(world_path.read_text(encoding="utf-8")) if world_path.exists() else {}
    if not isinstance(world, dict):
        world = {}
    world.setdefault("schema_version", 2)
    world.setdefault("campaign_id", campaign_id)
    _write_json(world_path, world)
    pacing_path = campaign / "save" / "pacing-state.json"
    if not pacing_path.exists():
        _write_json(pacing_path, {"schema_version": 1, "campaign_id": campaign_id})
    receipts_path = campaign / "logs" / "turn-finalizations.jsonl"
    receipts = []
    if receipts_path.exists():
        receipts = [
            json.loads(line)
            for line in receipts_path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
    hist.ensure_repo(root, campaign_id)
    schema = hist.format_schema_generation(state.CURRENT_SCHEMA_VERSIONS)
    hist.commit_baseline(
        root, campaign_id, schema_generation=schema, note="export fixture",
    )
    for index, receipt in enumerate(receipts, start=1):
        if not isinstance(receipt, dict) or not receipt.get("finalization_id"):
            continue
        hist.commit_finalized_turn(
            root,
            campaign_id,
            turn_number=index,
            finalization_id=str(receipt["finalization_id"]),
            journal_decision_id=str(
                receipt.get("journal_decision_id") or f"journal-{index}"
            ),
            settlement_snapshot_id=str(
                receipt.get("settlement_snapshot_id") or f"settle-{index}"
            ),
            rendered_text_sha256=str(
                receipt.get("rendered_text_sha256") or ("a" * 64)
            ),
            schema_generation=schema,
        )


def _scene_promotion(drift_id="drift-1", scene_id="transit"):
    return {
        "schema_version": 1,
        "event_id": "tool-operation-v1:promotion-1",
        "event_type": "scene_promotion",
        "promotion_id": "scene-promotion-v1:promotion-1",
        "scene_id": scene_id,
        "from_role": "transit",
        "to_role": "side_investigation",
        "from_contract_id": "scene-contract-v1:transit",
        "to_contract_id": "scene-contract-v1:side",
        "reason": "player-created causal branch",
        "source_event_ids": [drift_id],
        "resolved_drift_event_ids": [drift_id],
        "source_decision_id": "promotion-decision-1",
        "module_divergence": True,
        "request_digest": "sha256:promotion",
        "ts": "2026-08-22T00:00:00Z",
    }


def _bind_rolls(run: Path, finalization_id, roll_ids):
    campaign = run / "sandbox" / ".coc" / "campaigns" / "case-1"
    transcript_path = _canonical_transcript_path(run)
    transcript = [
        json.loads(raw) for raw in transcript_path.read_text(encoding="utf-8").splitlines()
        if raw.strip()
    ]
    keeper = next(row for row in transcript if row.get("role") == "keeper")
    keeper["finalization_id"] = finalization_id
    player = next(row for row in transcript if row.get("role") == "player")
    player["journal_decision_id"] = f"{finalization_id}-journal"
    _write_jsonl(transcript_path, transcript)
    review = _review(f"review-{finalization_id}", draft_text=keeper["text"])
    _write_jsonl(campaign / "logs" / "narration-reviews.jsonl", [review])
    _write_jsonl(
        campaign / "logs" / "turn-finalizations.jsonl",
        [_finalization_receipt(finalization_id, roll_ids, rendered_text=keeper["text"], review=review)],
    )
    calls_path = campaign / "logs" / "toolbox-calls.jsonl"
    calls = [json.loads(raw) for raw in calls_path.read_text(encoding="utf-8").splitlines() if raw.strip()]
    next(call for call in calls if call.get("tool") == "state.journal")["args"]["decision_id"] = f"{finalization_id}-journal"
    _write_jsonl(calls_path, calls)


def _write_json(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False) + "\n", encoding="utf-8")


def _write_jsonl(path: Path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8")


def _audit_completeness(run: Path):
    return json.loads(
        (run / "artifacts" / "audit" / "report-validation.json").read_text(encoding="utf-8")
    )["completeness"]


def _fixture(run: Path, *, metadata_name="run.json"):
    campaign = run / "sandbox" / ".coc" / "campaigns" / "case-1"
    investigator = run / "sandbox" / ".coc" / "investigators" / "ada"
    metadata = {
        "run_segment_id": "run-1",
        "run_id": "run-1",
        "campaign_id": "case-1",
        "session_id": "session-1",
        "plugin_version": "0.4.0-alpha.0",
        "ruleset_id": "coc7",
        "ruleset_version": "1.0.0",
        "seed": 17,
    }
    keeper_text = "门上写着 **勿入**。\n第二行有 `code`。"
    transcript = [
        {"turn": 1, "turn_id": "turn-1", "role": "keeper_under_test", "speaker_display": "KP[门卫]", "text": keeper_text, "run_segment_id": "run-1", "session_id": "session-1", "finalization_id": "fin-1", "accepted_revision": 1, "rendered_text_sha256": _canonical_digest(keeper_text)},
        {"turn": 2, "role": "system", "text": "RUNNER_PROMPT_SECRET"},
        {"turn": 3, "role": "player_simulator", "speaker": "Ada King", "text": "我说：\"进去\" | yes 🚪"},
    ]
    canonical_transcript = [
        {
            "turn": 1, "role": "player", "speaker": "Ada King",
            "text": "我说：\"进去\" | yes 🚪", "turn_id": "turn-1",
            "run_segment_id": "run-1", "session_id": "session-1",
            "journal_decision_id": "fin-1-journal",
        },
        {
            "turn": 1, "role": "keeper", "speaker_display": "KP[门卫]",
            "text": keeper_text, "turn_id": "turn-1", "run_segment_id": "run-1",
            "session_id": "session-1", "finalization_id": "fin-1",
            "accepted_revision": 1,
            "rendered_text_sha256": _canonical_digest(keeper_text),
        },
    ]
    rolls = [
        {"roll_id": "public-1", "actor": "ada", "visibility": "public", "source_ref": "logs/rolls.jsonl#public-1", "payload": {"roll_id": "public-1", "skill": "Spot Hidden", "roll": 42, "effective_target": 60, "outcome": "success"}},
        {"roll_id": "keeper-1", "visibility": "keeper_only", "payload": {"roll": 99, "secret_text": "KEEPER_ROLL_SECRET"}},
    ]
    _write_json(run / metadata_name, metadata)
    _write_json(campaign / "party.json", {"investigator_ids": ["ada"]})
    _write_json(investigator / "character.json", {"id": "ada", "name": "艾达 | Ada", "occupation": "记者", "age": 27, "sex": "F", "characteristics": {"STR": 40, "LUCK": 50}, "derived": {"HP": 10, "SAN": 60, "MP": 12}, "skills": {"Library Use": 73}, "weapons": [{"name": "Camera tripod", "damage": "1D4"}], "equipment": ["camera"], "backstory": {"scenario_bound": {"description": "A public assignment", "significant_people": "Her editor"}, "traits": ["curious"], "ideology": "publish the truth"}, "player_facing_sheet_zh": {"nationality": "英国", "skills": [{"key": "Library Use", "label": "图书馆使用", "value": 70, "half": 35, "fifth": 14}]}, "keeper_secret": "CHARACTER_SECRET"})
    _write_json(investigator / "creation.json", {"age": 27})
    _write_json(campaign / "save" / "investigator-state" / "ada.json", {"investigator_id": "ada", "current_hp": 9, "current_san": 54, "current_mp": 12, "current_luck": 50, "conditions": ["wounded"], "personal_horror_hooks": [{"hook_id": "truth", "summary": "A censored story", "woven": True, "keeper_secret": "HOOK_SECRET"}]})
    _write_json(campaign / "save" / "world-state.json", {"visited_scene_ids": ["office", "archive"], "scene_history": [{"scene_id": "archive", "decision_id": "d1"}], "discovered_clue_ids": ["clue-public"], "major_decisions": [{"decision_id": "d1", "summary": "Entered the archive"}]})
    _write_json(campaign / "save" / "flags.json", {"clues_found": {"clue-public": {"method": "read the public ledger"}}, "keeper_secret": "FLAG_SECRET"})
    _write_json(campaign / "save" / "npc-engagement-receipts.json", {"receipts": {"r1": {"event": {"event_id": "e1", "npc_id": "npc-clerk", "scene_id": "archive", "interaction_kind": "dialogue", "identity_contract": {"keeper_only": True, "name": "Secret Clerk Name", "agenda": "NPC_AGENDA_SECRET", "voice": "NPC_VOICE_SECRET"}}}}})
    _write_json(campaign / "save" / "exceptional-effects.json", {
        "schema_version": 1,
        "effects": {
            "effect-1": {
                "effect_id": "effect-1",
                "direction": "cost",
                "effect_kind": "restriction",
                "player_visible_impact": "今晚不能再调阅档案原件",
                "causal_link": "孤注一掷耗尽了闭馆前的调卷时间",
                "boundary": {"kind": "until_condition", "description": "档案厅次日重新开放"},
                "mechanics": {"subject_id": "ada", "restriction_id": "archive-closed", "scope": "original files", "scene_id": "archive"},
                "visibility": "player_visible",
                "status": "active",
                "created_at": "2026-07-18T00:00:00+00:00",
                "source_roll": {"roll_id": "KEEPER_SOURCE_ROLL"},
            }
        },
        "operations": {},
    })
    ending_id = "ending-1"
    _write_jsonl(campaign / "logs" / "events.jsonl", [{"event_type": "session_ending", "ending_id": ending_id, "scene_id": "archive", "kind": "conclusion", "summary": "Ada published the evidence.", "settlement_capsule_ref": f"save/development-settlements/endings/{ending_id}/capsule.json"}])
    _write_json(campaign / "save" / "development-settlements" / "endings" / ending_id / "ada.json", {"ending_id": ending_id, "investigator_id": "ada", "receipt": {"status": "PASS", "result": {"improvement_checks": [{"skill": "Library Use", "check_roll": 90, "gain": 3, "value_before": 70, "value_after": 73, "applied_delta": 3, "improved": True}], "luck_recovery": {"luck_before": 50, "luck_after": 55, "gained": 5}}}})
    _write_jsonl(run / "transcript.jsonl", transcript)
    _write_jsonl(campaign / "logs" / "table-transcript.jsonl", canonical_transcript)
    _write_jsonl(campaign / "logs" / "rolls.jsonl", rolls)
    review = _review("review-fin-1")
    _write_jsonl(campaign / "logs" / "narration-reviews.jsonl", [review])
    _write_jsonl(
        campaign / "logs" / "turn-finalizations.jsonl",
        [_finalization_receipt("fin-1", ["public-1"], rendered_text=keeper_text, review=review)],
    )
    _write_jsonl(campaign / "logs" / "toolbox-calls.jsonl", [
        {
            "schema_version": 2, "turn_number": 1, "tool": "state.journal",
            "ok": True, "args": {"decision_id": "fin-1-journal"},
            "data": {"changed": True}, "visibility": "keeper_internal",
        },
        {
            "schema_version": 2,
            "turn_number": 1,
            "tool": "director.advise",
            "ok": True,
            "args": {"decision_id": "d1"},
            "data": {"advice_id": "director:1:test", "keeper_secret": "INTERNAL_ONLY"},
            "visibility": "keeper_internal",
        },
    ])
    _write_jsonl(campaign / "logs" / "advisory-adoptions.jsonl", [{
        "schema_version": 1,
        "decision_id": "d1",
        "advice_id": "director:1:test",
        "disposition": "modified",
        "reason": "Kept the pressure but changed the NPC beat.",
        "visibility": "keeper_internal",
    }])
    _write_run_identity(campaign)
    return {
        "metadata": metadata, "rolls": rolls,
        "transcript": canonical_transcript, "legacy_transcript": transcript,
    }


def test_writes_the_single_final_report_pair_deterministically(tmp_path):
    module = _load()
    run = tmp_path / "run"
    expected = _fixture(run)
    _prove_git_state(run)
    first = module.export_battle_report(run)
    artifacts = run / "artifacts"
    json_before = (artifacts / JSON_OUTPUT).read_bytes()
    markdown_before = (artifacts / MARKDOWN_OUTPUT).read_bytes()
    second = module.export_battle_report(run)
    first_manifest = json.loads((artifacts / "audit" / "manifest.json").read_text())
    second_manifest = json.loads((artifacts / "audit" / "manifest.json").read_text())
    assert first_manifest["report_id"] == second_manifest["report_id"]
    assert first_manifest["report_id"].startswith("coc-battle-report-")
    assert (artifacts / JSON_OUTPUT).read_bytes() == json_before
    assert (artifacts / MARKDOWN_OUTPUT).read_bytes() == markdown_before
    payload = json.loads(json_before)
    assert payload["report_type"] == "coc_actual_play_battle_report_evidence"
    assert payload["run_metadata"]["campaign_id"] == expected["metadata"]["campaign_id"]
    assert "session_id" not in payload["run_metadata"]
    assert payload["completeness"]["classification"] == "COMPLETE"
    assert payload["schema_version"] == 8
    assert payload["state_integrity"]["status"] == "PASS"
    assert payload["public_rolls"]["finalization_binding"]["git_history_status"] == "PASS"
    assert "keeper_internal" not in payload
    assert "effect_id" not in payload["exceptional_effects"][0]
    assert "source_roll" not in payload["exceptional_effects"][0]
    assert "source_manifest" not in payload
    assert "INTERNAL_ONLY" not in markdown_before.decode()
    assert "Kept the pressure" not in markdown_before.decode()
    assert "今晚不能再调阅档案原件" in markdown_before.decode()
    assert "KEEPER_SOURCE_ROLL" not in markdown_before.decode()
    assert markdown_before.decode().startswith("# COC Actual-Play Battle Report\n")


@pytest.mark.parametrize("metadata_name", ["run.json", "playtest.json"])
def test_accepts_simplified_run_or_legacy_playtest_metadata(tmp_path, metadata_name):
    module = _load()
    run = tmp_path / metadata_name
    _fixture(run, metadata_name=metadata_name)
    report = module.export_battle_report(run)
    validation = json.loads(
        (run / "artifacts" / "audit" / "report-validation.json").read_text(encoding="utf-8")
    )
    assert validation["source_identity"]["metadata_source"] == metadata_name
    assert "run_id" not in report["run_metadata"]
    assert report["source_identity"]["run_segment_id"] == "run-1"


@pytest.mark.parametrize(
    "missing",
    [
        "run_segment_id",
        "session_id",
        "plugin_version",
        "ruleset_id",
        "ruleset_version",
    ],
)
def test_missing_required_run_identity_is_incomplete(tmp_path, missing):
    module = _load()
    run = tmp_path / missing
    _fixture(run)
    campaign = run / "sandbox" / ".coc" / "campaigns" / "case-1"
    payload = _canonical_run_identity()
    payload.pop(missing)
    _write_json(campaign / "save" / "run-identity.json", payload)

    report = module.export_battle_report(run)

    assert report["completeness"]["classification"] == "INCOMPLETE"
    dimension = _audit_completeness(run)["dimensions"]["run_identity"]
    assert dimension["status"] == "FAIL"
    assert any(missing in finding for finding in dimension["findings"])


@pytest.mark.parametrize("sentinel", ["MISSING", "unknown", "placeholder"])
def test_placeholder_run_identity_is_incomplete(tmp_path, sentinel):
    module = _load()
    run = tmp_path / sentinel
    _fixture(run)
    campaign = run / "sandbox" / ".coc" / "campaigns" / "case-1"
    _write_run_identity(campaign, run_segment_id=sentinel)
    report = module.export_battle_report(run)
    assert report["completeness"]["classification"] == "INCOMPLETE"
    assert report["completeness"]["dimensions"]["run_identity"]["status"] == "FAIL"


def test_exports_allowlisted_model_evidence_without_rendering_it(tmp_path):
    module = _load()
    run = tmp_path / "run"
    fixture = _fixture(run)
    metadata = dict(fixture["metadata"])
    metadata["host_model"] = {
        "provider": "openai",
        "model_id": "gpt-5.6-luna",
        "reasoning_effort": "low",
        "lane": "fast_iteration",
        "selected_before_activation": True,
        "switched_during_run": False,
        "background_model_policy": "inherit_parent",
        "unexpected_secret": "DO_NOT_EXPORT",
    }
    _write_json(run / "run.json", metadata)

    report = module.export_battle_report(run)
    assert report["run_metadata"]["host_model"] == {
        "provider": "openai",
        "model_id": "gpt-5.6-luna",
        "reasoning_effort": "low",
        "lane": "fast_iteration",
        "background_model_policy": "inherit_parent",
        "selected_before_activation": True,
        "switched_during_run": False,
    }
    evidence = (run / "artifacts" / JSON_OUTPUT).read_text(encoding="utf-8")
    markdown = (run / "artifacts" / MARKDOWN_OUTPUT).read_text(encoding="utf-8")
    assert "DO_NOT_EXPORT" not in evidence
    assert "gpt-5.6-luna" not in markdown
    assert "fast_iteration" not in markdown


def test_final_report_is_readable_actual_play_not_raw_payload_dump(tmp_path):
    module = _load()
    run = tmp_path / "run"
    _fixture(run)
    report = module.export_battle_report(run)
    markdown = (run / "artifacts" / MARKDOWN_OUTPUT).read_text(encoding="utf-8")
    for phrase in ("## Investigators", "### 艾达 | Ada", "- Sex: F", "- Nationality: 英国", "- Final HP: 9", "- Conditions: wounded", "#### Characteristics", "#### Initial Skills", "| 图书馆使用 (`Library Use`) | 70 | 35 | 14 |", "#### Weapons", "#### Equipment", "#### Backstory and Traits", "  - Description: A public assignment", "#### Personal Horror", "## Development and Ending", "Ada published the evidence.", "### 艾达 | Ada Development", "Library Use: 70 → 73", "- Luck: 50 → 55", "## Investigation Chronicle", "Recorded visited scenes: 2.", "Confirmed clue — read the public ledger", "Recorded NPC", "## Actual Play", "### Turn 1 · KP[门卫]", "门上写着 **勿入**。", "### Turn 1 · Ada King", "## Public Rules and Dice", "- Roll: 42", "- Target: 60", "- Outcome: success"):
        assert phrase in markdown
    assert "{'condition':" not in markdown
    assert '"luck_after"' not in markdown
    assert '"description"' not in markdown


def test_zh_play_language_localizes_exporter_chrome_only(tmp_path):
    module = _load()
    run = tmp_path / "run"
    fixture = _fixture(run)
    metadata = dict(fixture["metadata"])
    metadata["play_language"] = "zh-Hans"
    _write_json(run / "run.json", metadata)

    module.export_battle_report(run)
    markdown = (run / "artifacts" / MARKDOWN_OUTPUT).read_text(encoding="utf-8")

    assert markdown.startswith("# COC 实际游玩战报\n")
    assert "## 调查员" in markdown
    assert "## 实际游玩记录" in markdown
    assert "### 第 1 轮 · KP[门卫]" in markdown
    assert "## 公开规则与骰点" in markdown
    assert "- 骰点: 42" in markdown
    assert "- 检定: 侦查" in markdown
    assert "- 结果: 成功" in markdown
    localized_probe = module._localize_fixed_markdown_zh(
        "- Difficulty: regular\n- Outcome: regular"
    )
    assert "- 难度: 普通" in localized_probe
    assert "- 结果: 普通成功" in localized_probe
    assert "- 描述: A public assignment" in markdown
    assert "Recorded NPC" in markdown
    assert " · scene `" not in markdown
    assert "# COC Actual-Play Battle Report" not in markdown
    # Source-authored prose is evidence, not exporter chrome: preserve it.
    assert "A public assignment" in markdown


def test_final_report_preserves_zero_character_and_roll_values(tmp_path):
    module = _load()
    run = tmp_path / "run"
    _fixture(run)
    campaign = run / "sandbox" / ".coc" / "campaigns" / "case-1"
    investigator = run / "sandbox" / ".coc" / "investigators" / "ada"
    _write_json(
        investigator / "character.json",
        {
            "id": "ada",
            "name": "艾达 | Ada",
            "hp": 11,
            "san": 54,
            "mp": 9,
        },
    )
    _write_json(
        campaign / "save" / "investigator-state" / "ada.json",
        {"investigator_id": "ada", "current_hp": 0, "current_san": 0, "current_mp": 0, "current_luck": 0},
    )
    _write_jsonl(
        campaign / "logs" / "rolls.jsonl",
        [
            {
                "roll_id": "zero-roll",
                "roll": 87,
                "effective_target": 60,
                "visibility": "public",
                "payload": {
                    "roll_id": "zero-roll",
                    "roll": 0,
                    "effective_target": 0,
                    "outcome": "failure",
                },
            }
        ],
    )
    _bind_rolls(run, "fin-zero", ["zero-roll"])

    module.export_battle_report(run)
    markdown = (run / "artifacts" / MARKDOWN_OUTPUT).read_text(encoding="utf-8")
    for field in ("Final HP", "Final SAN", "Final MP", "Final Luck", "Roll", "Target"):
        assert f"- {field}: 0" in markdown
    assert "- Final HP: 11" not in markdown
    assert "- Roll: 87" not in markdown
    assert "- Target: 60" not in markdown


@pytest.mark.parametrize(
    ("expression", "raw", "total", "expected_roll"),
    [
        ("2D6", [6, 3], 9, "2D6 = 9"),
        ("1D1-1", [1], 0, "1D1-1 = 0"),
    ],
)
def test_nested_dice_total_is_complete_and_rendered(
    tmp_path, expression, raw, total, expected_roll
):
    module = _load()
    run = tmp_path / f"nested-{total}"
    _fixture(run)
    rolls = (
        run
        / "sandbox"
        / ".coc"
        / "campaigns"
        / "case-1"
        / "logs"
        / "rolls.jsonl"
    )
    _write_jsonl(
        rolls,
        [
            {
                "roll_id": f"nested-{total}",
                "visibility": "public",
                "payload": {
                    "roll_id": f"nested-{total}",
                    "dice": {
                        "expression": expression,
                        "raw": raw,
                        "total": total,
                    },
                },
            }
        ],
    )
    _bind_rolls(run, "fin-nested", [f"nested-{total}"])
    _prove_git_state(run)

    report = module.export_battle_report(run)

    assert report["completeness"]["classification"] == "COMPLETE"
    assert report["public_rolls"]["status"] == "PASS"
    assert report["public_rolls"]["malformed_source_lines"] == []
    markdown = (run / "artifacts" / MARKDOWN_OUTPUT).read_text(encoding="utf-8")
    assert f"- Roll: {expected_roll}" in markdown
    assert f"- Raw Dice: {', '.join(map(str, raw))}" in markdown


def test_evidence_hashes_sources_and_renders_public_roll_exactly_once(tmp_path):
    module = _load()
    run = tmp_path / "run"
    _fixture(run)
    report = module.export_battle_report(run)
    validation = json.loads(
        (run / "artifacts" / "audit" / "report-validation.json").read_text(encoding="utf-8")
    )
    manifest = {entry["path"]: entry for entry in validation["source_manifest"]}
    transcript = _canonical_transcript_path(run)
    transcript_key = "sandbox/.coc/campaigns/case-1/logs/table-transcript.jsonl"
    assert manifest[transcript_key]["sha256"] == hashlib.sha256(transcript.read_bytes()).hexdigest()
    rolls_path = "sandbox/.coc/campaigns/case-1/logs/rolls.jsonl"
    assert manifest[rolls_path]["record_count"] == 2
    assert manifest[rolls_path]["included_record_count"] == 1
    assert report["public_rolls"]["status"] == "PASS"
    assert report["public_rolls"]["required_count"] == report["public_rolls"]["rendered_count"] == 1
    markdown = (run / "artifacts" / MARKDOWN_OUTPUT).read_text(encoding="utf-8")
    assert markdown.count("### Check 1") == 1
    assert "public-1" not in markdown


def test_valid_empty_roll_log_explicitly_reports_zero(tmp_path):
    module = _load()
    run = tmp_path / "run"
    _fixture(run)
    rolls = run / "sandbox" / ".coc" / "campaigns" / "case-1" / "logs" / "rolls.jsonl"
    _write_jsonl(rolls, [])
    # A finalized turn whose hash-bound receipt carries source_roll_ids == []
    # IS the zero-roll attestation; zero is covered by the receipt, not
    # inferred from an empty log.
    _bind_rolls(run, "fin-zero-turn", [])
    report = module.export_battle_report(run)
    assert report["public_rolls"]["status"] == "PASS"
    binding = report["public_rolls"]["finalization_binding"]
    assert binding["zero_roll_turn_count"] == 1
    assert binding["undispositioned_orphan_count"] == 0
    markdown = (run / "artifacts" / MARKDOWN_OUTPUT).read_text(encoding="utf-8")
    assert "Public roll count: **0**" in markdown
    assert "No public or consequence-public rolls occurred." in markdown


@pytest.mark.parametrize("mutation,reason", [
    ("missing-log", "public roll count cannot be proven"),
    ("duplicate", "duplicate public roll IDs"),
    ("malformed", "lack roll_id or numerical evidence"),
])
def test_public_roll_completeness_fails_closed(tmp_path, mutation, reason):
    module = _load()
    run = tmp_path / mutation
    data = _fixture(run)
    rolls = run / "sandbox" / ".coc" / "campaigns" / "case-1" / "logs" / "rolls.jsonl"
    if mutation == "missing-log":
        rolls.unlink()
    elif mutation == "duplicate":
        _write_jsonl(rolls, [data["rolls"][0], data["rolls"][0]])
    else:
        _write_jsonl(rolls, [{"visibility": "public", "outcome": "success"}])
    report = module.export_battle_report(run)
    assert report["completeness"]["classification"] == "INCOMPLETE"
    assert report["public_rolls"]["status"] == "FAIL"
    assert any(reason in item for item in _audit_completeness(run)["reasons"])


def test_partial_requires_opt_in_and_stays_incomplete(tmp_path):
    module = _load()
    run = tmp_path / "run"
    _fixture(run)
    _canonical_transcript_path(run).unlink()
    (run / "transcript.jsonl").rename(run / "partial-transcript.jsonl")
    with pytest.raises(module.ExportError, match="--allow-partial"):
        module.export_battle_report(run)
    report = module.export_battle_report(run, allow_partial=True)
    assert report["completeness"]["classification"] == "INCOMPLETE"
    validation = json.loads(
        (run / "artifacts" / "audit" / "report-validation.json").read_text(encoding="utf-8")
    )
    assert validation["source_identity"]["transcript_source"] == "partial-transcript.jsonl"


def test_partial_cli_exits_zero_with_player_safe_summary(tmp_path, capsys):
    module = _load()
    run = tmp_path / "run"
    _fixture(run)
    _canonical_transcript_path(run).unlink()
    (run / "transcript.jsonl").rename(run / "partial-transcript.jsonl")

    assert module.main([str(run), "--allow-partial"]) == 0
    summary = json.loads(capsys.readouterr().out)
    assert summary == {
        "classification": "INCOMPLETE",
        "outputs": [
            f"artifacts/{JSON_OUTPUT}",
            f"artifacts/{MARKDOWN_OUTPUT}",
        ],
    }
    assert (run / "artifacts" / JSON_OUTPUT).is_file()
    assert (run / "artifacts" / MARKDOWN_OUTPUT).is_file()


def test_secrets_and_non_dialogue_rows_are_excluded_from_both_outputs(tmp_path):
    module = _load()
    run = tmp_path / "run"
    _fixture(run)
    campaign = run / "sandbox" / ".coc" / "campaigns" / "case-1"
    _write_jsonl(run / "keeper-view.jsonl", [{"text": "KEEPER_VIEW_SECRET"}])
    _write_json(campaign / "scenario" / "scenario.json", {"truth": "SCENARIO_SECRET"})
    module.export_battle_report(run)
    combined = (run / "artifacts" / JSON_OUTPUT).read_text(encoding="utf-8") + (run / "artifacts" / MARKDOWN_OUTPUT).read_text(encoding="utf-8")
    for secret in ("RUNNER_PROMPT_SECRET", "KEEPER_ROLL_SECRET", "CHARACTER_SECRET", "HOOK_SECRET", "FLAG_SECRET", "NPC_AGENDA_SECRET", "NPC_VOICE_SECRET", "Secret Clerk Name", "KEEPER_VIEW_SECRET", "SCENARIO_SECRET"):
        assert secret not in combined


def test_completeness_dimensions_are_scoped_and_missing_ending_is_visible(tmp_path):
    module = _load()
    run = tmp_path / "run"
    _fixture(run)
    campaign = run / "sandbox" / ".coc" / "campaigns" / "case-1"
    (campaign / "logs" / "events.jsonl").unlink()
    report = module.export_battle_report(run)
    assert report["completeness"]["classification"] == "INCOMPLETE"
    assert report["completeness"]["claim_scope"] == "report_source_evidence_only"
    assert report["completeness"]["dimensions"]["ending_and_development"]["status"] == "FAIL"
    assert "whole_product_kp_quality" in report["completeness"]["not_claimed"]


@pytest.mark.parametrize(
    ("kept_role", "expected_reason"),
    [
        ("keeper", "no non-empty player dialogue rows were found"),
        ("player", "no non-empty Keeper/KP dialogue rows were found"),
    ],
)
def test_exact_transcript_dimension_reports_the_actual_missing_role(
    tmp_path, kept_role, expected_reason
):
    module = _load()
    run = tmp_path / kept_role
    data = _fixture(run)
    _write_jsonl(
            _canonical_transcript_path(run),
        [row for row in data["transcript"] if row.get("role") == kept_role],
    )
    report = module.export_battle_report(run)
    dimension = _audit_completeness(run)["dimensions"]["accepted_transcript"]
    assert dimension["status"] == "FAIL"
    assert expected_reason in dimension["findings"]
    assert "final ordered transcript contains both table roles" not in dimension["findings"]


def test_accepted_transcript_requires_revision_hash_and_session_binding(tmp_path):
    module = _load()
    run = tmp_path / "unbound-accepted"
    data = _fixture(run)
    transcript = list(data["transcript"])
    keeper = dict(transcript[1])
    keeper.pop("accepted_revision")
    transcript[1] = keeper
    _write_jsonl(_canonical_transcript_path(run), transcript)
    report = module.export_battle_report(run)
    dimension = _audit_completeness(run)["dimensions"]["accepted_transcript"]
    assert report["completeness"]["classification"] == "INCOMPLETE"
    assert dimension["status"] == "FAIL"
    assert any("NOT_PROVEN" in finding and "accepted_revision" in finding for finding in dimension["findings"])


def test_accepted_transcript_requires_exact_finalization_bijection(tmp_path):
    module = _load()
    run = tmp_path / "duplicate-one-missing-one"
    data = _fixture(run)
    keeper = dict(data["transcript"][1])
    duplicate = dict(keeper)
    duplicate["turn"] = 3
    duplicate["turn_id"] = "turn-3"
    _write_jsonl(_canonical_transcript_path(run), [data["transcript"][0], keeper, duplicate])
    campaign = run / "sandbox" / ".coc" / "campaigns" / "case-1"
    _write_jsonl(
        campaign / "logs" / "turn-finalizations.jsonl",
        [
            _finalization_receipt("fin-1", ["public-1"], rendered_text=keeper["text"]),
            _finalization_receipt("fin-2", [], rendered_text="另一条未呈现的正式文本", turn_id="turn-2"),
        ],
    )

    report = module.export_battle_report(run)
    dimension = _audit_completeness(run)["dimensions"]["accepted_transcript"]
    assert report["completeness"]["classification"] == "INCOMPLETE"
    assert dimension["status"] == "FAIL"
    assert any("duplicate finalization bindings" in finding for finding in dimension["findings"])
    assert any("fin-2" in finding and "missing accepted" in finding for finding in dimension["findings"])


def test_unrelated_artifact_is_preserved_and_output_symlink_is_rejected(tmp_path):
    module = _load()
    run = tmp_path / "run"
    _fixture(run)
    unrelated = run / "artifacts" / "operator-notes.txt"
    unrelated.parent.mkdir(parents=True)
    unrelated.write_text("keep me", encoding="utf-8")
    module.export_battle_report(run)
    assert unrelated.read_text(encoding="utf-8") == "keep me"
    output = run / "artifacts" / JSON_OUTPUT
    output.unlink()
    outside = tmp_path / "outside.json"
    outside.write_text("outside", encoding="utf-8")
    output.symlink_to(outside)
    with pytest.raises(module.ExportError, match="output symlink"):
        module.export_battle_report(run)
    assert outside.read_text(encoding="utf-8") == "outside"


def _write_clue_graph(run: Path, clues):
    campaign = run / "sandbox" / ".coc" / "campaigns" / "case-1"
    _write_json(
        campaign / "scenario" / "clue-graph.json",
        {"conclusions": [{"conclusion_id": "con-1", "clues": clues}]},
    )


def _discover_clues(run: Path, clue_ids):
    campaign = run / "sandbox" / ".coc" / "campaigns" / "case-1"
    _write_json(
        campaign / "save" / "world-state.json",
        {"visited_scene_ids": ["office", "archive"], "discovered_clue_ids": clue_ids},
    )
    _write_json(
        campaign / "save" / "flags.json",
        {"clues_found": {clue_id: {"method": "narrated"} for clue_id in clue_ids}},
    )


def _write_npc_receipts(run: Path, events):
    campaign = run / "sandbox" / ".coc" / "campaigns" / "case-1"
    _write_json(
        campaign / "save" / "npc-engagement-receipts.json",
        {"receipts": {f"r{index}": {"event": event} for index, event in enumerate(events, start=1)}},
    )


def test_play_conduct_signals_restate_structured_facts_without_changing_completeness(tmp_path):
    module = _load()
    run = tmp_path / "run"
    _fixture(run)
    campaign = run / "sandbox" / ".coc" / "campaigns" / "case-1"
    canonical_rows = []
    for turn in range(1, 7):
        canonical_rows.extend([
            {
                "turn": turn, "turn_id": f"turn-{turn}", "role": "player",
                "text": f"player {turn} dialogue", "run_segment_id": "run-1",
                "session_id": "session-1", "journal_decision_id": f"fin-{turn}-journal",
            },
            {
                "turn": turn, "turn_id": f"turn-{turn}", "role": "keeper",
                "text": f"keeper {turn} dialogue", "run_segment_id": "run-1",
                "session_id": "session-1", "finalization_id": f"fin-{turn}",
                "accepted_revision": 1,
                "rendered_text_sha256": _canonical_digest(f"keeper {turn} dialogue"),
            },
        ])
    _write_jsonl(_canonical_transcript_path(run), canonical_rows)
    reviews = [
        _review(
            f"review-fin-{turn}", turn_id=f"turn-{turn}",
            draft_text=f"keeper {turn} dialogue",
        )
        for turn in range(1, 7)
    ]
    _write_jsonl(campaign / "logs" / "narration-reviews.jsonl", reviews)
    _write_jsonl(
        campaign / "logs" / "turn-finalizations.jsonl",
        [
            _finalization_receipt(
                f"fin-{turn}", [], rendered_text=f"keeper {turn} dialogue",
                turn_id=f"turn-{turn}", review=review,
            )
            for turn, review in zip(range(1, 7), reviews)
        ],
    )
    _write_jsonl(campaign / "logs" / "toolbox-calls.jsonl", [
        {"turn_number": turn, "tool": "state.journal", "ok": True,
         "args": {"decision_id": f"fin-{turn}-journal"}, "data": {}}
        for turn in range(1, 7)
    ])
    _write_jsonl(campaign / "logs" / "rolls.jsonl", [])
    _write_clue_graph(run, [
        {"clue_id": "clue-ledger", "delivery_kind": "skill_check", "skill": "Library Use", "player_safe_summary": "LEDGER_CONTENT"},
        {"clue_id": "clue-runes", "delivery_kind": "skill_check", "skill": "Spot Hidden", "player_safe_summary": "RUNES_CONTENT"},
        {"clue_id": "clue-free", "delivery_kind": "automatic", "player_safe_summary": "FREE_CONTENT"},
    ])
    _discover_clues(run, ["clue-ledger", "clue-runes", "clue-free"])
    _write_npc_receipts(run, [
        {"event_id": "e1", "npc_id": "npc-clerk", "scene_id": "archive", "interaction_kind": "dialogue", "identity_contract": {"npc_id": "npc-clerk"}, "identity_binding": {"status": "authored_bound"}},
        {"event_id": "e2", "npc_id": "npc-stranger", "scene_id": "office", "interaction_kind": "dialogue", "identity_contract": None, "identity_binding": {"status": "improvised"}},
    ])
    _prove_git_state(run)

    report = module.export_battle_report(run)

    assert report["completeness"]["classification"] == "COMPLETE"
    assert all(dimension["status"] == "PASS" for dimension in report["completeness"]["dimensions"].values())
    assert report["public_rolls"]["status"] == "PASS"
    assert "play_conduct_quality_judgment" in report["completeness"]["not_claimed"]
    signals = report["play_conduct_signals"]
    assert signals["nature"] == "observational_structured_facts_only"
    assert signals["turn_count"] == 6
    assert signals["public_roll_count"] == 0
    assert signals["tool_call_counts_per_turn"]["available"] is True
    assert signals["tool_call_counts_per_turn"]["counts"] == {
        str(turn): 1 for turn in range(1, 7)
    }
    clue_signal = signals["skill_check_clue_delivery"]
    assert clue_signal["available"] is True
    assert clue_signal["discovered_clue_count"] == 3
    assert clue_signal["skill_check_delivery_count"] == 2
    assert clue_signal["without_roll_evidence_count"] == 2
    assert "without_roll_evidence_clue_ids" not in clue_signal
    assert signals["npc_engagements"] == {"available": True, "total_count": 2, "improvised_count": 1}
    markdown = (run / "artifacts" / MARKDOWN_OUTPUT).read_text(encoding="utf-8")
    assert "## Play Conduct Signals" in markdown
    assert "Dialogue turns: **6**" in markdown
    assert "Public rolls: **0**" in markdown
    assert "without a matching authored-skill roll in the roll log: **2**" in markdown
    assert "improvised (no authored NPC identity): **1**" in markdown
    combined = markdown + (run / "artifacts" / JSON_OUTPUT).read_text(encoding="utf-8")
    for clue_content in ("LEDGER_CONTENT", "RUNES_CONTENT", "FREE_CONTENT"):
        assert clue_content not in combined


def test_play_conduct_signals_count_matching_authored_skill_rolls_as_evidence(tmp_path):
    module = _load()
    run = tmp_path / "run"
    _fixture(run)
    _write_clue_graph(run, [
        {"clue_id": "clue-spot", "delivery_kind": "skill_check", "skill": "Spot Hidden"},
        {"clue_id": "clue-library", "delivery_kind": "skill_check", "skill": "Library Use"},
    ])
    _discover_clues(run, ["clue-spot", "clue-library"])
    _prove_git_state(run)

    report = module.export_battle_report(run)

    assert report["completeness"]["classification"] == "COMPLETE"
    clue_signal = report["play_conduct_signals"]["skill_check_clue_delivery"]
    assert clue_signal["available"] is True
    assert clue_signal["skill_check_delivery_count"] == 2
    assert clue_signal["without_roll_evidence_count"] == 1
    assert "without_roll_evidence_clue_ids" not in clue_signal


def test_play_conduct_signals_report_unavailable_sources_honestly(tmp_path):
    module = _load()
    run = tmp_path / "run"
    _fixture(run)
    campaign = run / "sandbox" / ".coc" / "campaigns" / "case-1"
    (campaign / "logs" / "toolbox-calls.jsonl").unlink()
    (campaign / "logs" / "advisory-adoptions.jsonl").unlink()
    (campaign / "save" / "npc-engagement-receipts.json").unlink()

    report = module.export_battle_report(run)

    assert report["completeness"]["classification"] == "INCOMPLETE"
    assert report["completeness"]["dimensions"]["accepted_transcript"]["status"] == "FAIL"
    signals = report["play_conduct_signals"]
    assert signals["turn_count"] == 1
    assert signals["public_roll_count"] == 1
    assert signals["tool_call_counts_per_turn"] == {"available": False, "counts": {}, "total_tool_calls": 0}
    clue_signal = signals["skill_check_clue_delivery"]
    assert clue_signal["available"] is False
    assert clue_signal["discovered_clue_count"] == 1
    assert clue_signal["skill_check_delivery_count"] is None
    assert clue_signal["without_roll_evidence_count"] is None
    assert "without_roll_evidence_clue_ids" not in clue_signal
    assert signals["npc_engagements"] == {"available": False, "total_count": 0, "improvised_count": 0}
    markdown = (run / "artifacts" / MARKDOWN_OUTPUT).read_text(encoding="utf-8")
    assert "keeper-internal toolbox log unavailable" in markdown
    assert "skill-check delivery evidence unavailable" in markdown
    assert "no structured receipts were recorded" in markdown


def test_social_skill_rolls_get_a_focused_player_safe_view(tmp_path):
    module = _load()
    run = tmp_path / "run"
    _fixture(run)
    campaign = run / "sandbox" / ".coc" / "campaigns" / "case-1"
    investigator = run / "sandbox" / ".coc" / "investigators" / "ada"
    metadata = json.loads((run / "run.json").read_text(encoding="utf-8"))
    metadata["play_language"] = "zh-Hans"
    _write_json(run / "run.json", metadata)
    character = json.loads(
        (investigator / "character.json").read_text(encoding="utf-8")
    )
    character["player_facing_sheet_zh"]["skills"].append({
        "key": "Persuade", "label": "说服", "value": 45, "half": 22, "fifth": 9,
    })
    _write_json(investigator / "character.json", character)
    _write_jsonl(campaign / "logs" / "rolls.jsonl", [
        {"roll_id": "social-1", "actor": "ada", "visibility": "public", "payload": {"roll_id": "social-1", "skill": "Persuade", "roll": 39, "effective_target": 45, "outcome": "regular"}},
        {"roll_id": "other-1", "actor": "ada", "visibility": "public", "payload": {"roll_id": "other-1", "skill": "Spot Hidden", "roll": 42, "effective_target": 60, "outcome": "success"}},
        {"roll_id": "keeper-1", "visibility": "keeper_only", "payload": {"roll": 99, "skill": "Charm", "secret_text": "KEEPER_ROLL_SECRET"}},
    ])
    _bind_rolls(run, "fin-social", ["social-1", "other-1"])

    report = module.export_battle_report(run)

    assert len(report["social_rolls"]) == 1
    assert "roll_id" not in report["social_rolls"][0]
    entry = report["social_rolls"][0]
    assert entry["skill"] == "Persuade"
    assert entry["roll"] == 39
    assert entry["target"] == 45
    assert entry["outcome"] == "regular"
    markdown = (run / "artifacts" / MARKDOWN_OUTPUT).read_text(encoding="utf-8")
    assert "### 社交技能检定" in markdown
    assert "Public social check · 说服 · 骰点 39 对 45 · 普通成功" in markdown
    assert "- 检定: 说服" in markdown
    assert "- 检定: Persuade" not in markdown
    assert "other-1 · Spot Hidden" not in markdown  # non-social rolls stay in the appendix only
    assert "KEEPER_ROLL_SECRET" not in markdown
    evidence = json.loads((run / "artifacts" / JSON_OUTPUT).read_text(encoding="utf-8"))
    assert len(evidence["social_rolls"]) == 1
    assert "roll_id" not in evidence["social_rolls"][0]
    assert evidence["social_rolls"][0]["skill"] == "Persuade"


def test_player_report_renders_only_rolls_bound_to_finalization_receipts(tmp_path):
    module = _load()
    run = tmp_path / "run"
    _fixture(run)
    campaign = run / "sandbox" / ".coc" / "campaigns" / "case-1"
    _write_jsonl(campaign / "logs" / "rolls.jsonl", [
        {"roll_id": "bound-1", "actor": "ada", "visibility": "public", "payload": {"roll_id": "bound-1", "skill": "Spot Hidden", "roll": 42, "effective_target": 60, "outcome": "success"}},
        {"roll_id": "disposed-1", "actor": "ada", "visibility": "superseded", "payload": {"roll_id": "disposed-1", "skill": "Listen", "roll": 71, "effective_target": 50, "outcome": "failure"}},
        {"roll_id": "keeper-1", "visibility": "keeper_only", "payload": {"roll": 99, "secret_text": "KEEPER_ROLL_SECRET"}},
    ])
    _bind_rolls(run, "fin-bound", ["bound-1"])
    _prove_git_state(run)

    report = module.export_battle_report(run)

    assert report["completeness"]["classification"] == "COMPLETE"
    assert report["completeness"]["dimensions"]["dice"]["status"] == "PASS"
    assert len(report["public_rolls"]["records"]) == 1
    assert "roll_id" not in report["public_rolls"]["records"][0]
    binding = report["public_rolls"]["finalization_binding"]
    assert binding["bound_roll_id_count"] == 1
    assert binding["undispositioned_orphan_count"] == 0
    assert binding["dispositioned_orphan_count"] == 1
    audit_rolls = (run / "artifacts" / "audit" / "rolls.jsonl").read_text(encoding="utf-8")
    assert "disposed-1" in audit_rolls
    markdown = (run / "artifacts" / MARKDOWN_OUTPUT).read_text(encoding="utf-8")
    assert markdown.count("### Check 1") == 1
    assert "disposed-1" not in markdown
    assert "KEEPER_ROLL_SECRET" not in markdown


def test_creation_luck_receipt_binds_public_roll_without_finalization(tmp_path):
    module = _load()
    run = tmp_path / "run"
    _fixture(run)
    campaign = run / "sandbox" / ".coc" / "campaigns" / "case-1"
    investigator = run / "sandbox" / ".coc" / "investigators" / "ada"
    _write_json(
        investigator / "creation.json",
        {
            "input_mode": "guided_quick_fire",
            "luck_roll_receipt": {
                "campaign_id": "case-1",
                "decision_id": "creation-luck-decision",
                "roll_id": "creation-luck-1",
            },
        },
    )
    _write_jsonl(campaign / "logs" / "rolls.jsonl", [
        {
            "roll_id": "public-1",
            "actor": "ada",
            "visibility": "public",
            "payload": {
                "roll_id": "public-1",
                "skill": "Spot Hidden",
                "roll": 42,
                "effective_target": 60,
                "outcome": "success",
            },
        },
        {
            "roll_id": "creation-luck-1",
            "actor": "keeper",
            "visibility": "public",
            "payload": {
                "roll_id": "creation-luck-1",
                "kind": "dice_expression",
                "roll": 11,
                "final_total": 11,
                "outcome": "success",
            },
        },
    ])
    _prove_git_state(run)

    report = module.export_battle_report(run)

    assert report["completeness"]["classification"] == "COMPLETE"
    assert report["completeness"]["dimensions"]["dice"]["status"] == "PASS"
    assert len(report["public_rolls"]["records"]) == 2
    assert all("roll_id" not in row for row in report["public_rolls"]["records"])
    binding = report["public_rolls"]["finalization_binding"]
    assert binding["bound_roll_id_count"] == 2
    assert binding["undispositioned_orphan_count"] == 0


def test_undispositioned_orphan_public_roll_fails_dice_loudly(tmp_path):
    module = _load()
    run = tmp_path / "run"
    _fixture(run)
    campaign = run / "sandbox" / ".coc" / "campaigns" / "case-1"
    rolls = [
        json.loads(line)
        for line in (campaign / "logs" / "rolls.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()
    ]
    _write_jsonl(campaign / "logs" / "rolls.jsonl", [
        *rolls,
        {"roll_id": "orphan-public", "actor": "ada", "visibility": "public", "payload": {"roll_id": "orphan-public", "skill": "Stealth", "roll": 88, "effective_target": 40, "outcome": "failure"}},
    ])

    report = module.export_battle_report(run)

    assert report["completeness"]["classification"] == "INCOMPLETE"
    assert report["public_rolls"]["status"] == "FAIL"
    dimension = _audit_completeness(run)["dimensions"]["dice"]
    assert dimension["status"] == "FAIL"
    assert any("orphan-public" in finding and "source line 3" in finding for finding in dimension["findings"])
    assert any(
        "1 public roll rows are bound to no canonical receipt and carry no abandonment disposition" in reason
        and "orphan-public" in reason
        for reason in _audit_completeness(run)["reasons"]
    )
    assert report["public_rolls"]["finalization_binding"]["undispositioned_orphan_count"] == 1
    markdown = (run / "artifacts" / MARKDOWN_OUTPUT).read_text(encoding="utf-8")
    assert "### `orphan-public`" not in markdown
    assert markdown.count("### Check 1") == 1


def test_campaign_without_finalization_receipts_becomes_loudly_incomplete(tmp_path):
    module = _load()
    run = tmp_path / "run"
    _fixture(run)
    campaign = run / "sandbox" / ".coc" / "campaigns" / "case-1"
    (campaign / "logs" / "turn-finalizations.jsonl").unlink()

    report = module.export_battle_report(run)

    assert report["completeness"]["classification"] == "INCOMPLETE"
    assert report["completeness"]["dimensions"]["dice"]["status"] == "FAIL"
    assert any("public-1" in reason for reason in _audit_completeness(run)["reasons"])
    markdown = (run / "artifacts" / MARKDOWN_OUTPUT).read_text(encoding="utf-8")
    assert "### `public-1`" not in markdown
    assert "INCOMPLETE" in markdown


def test_social_skill_rolls_zero_is_explicit(tmp_path):
    module = _load()
    run = tmp_path / "run"
    _fixture(run)  # fixture rolls contain no social-skill rows

    report = module.export_battle_report(run)

    assert report["social_rolls"] == []
    markdown = (run / "artifacts" / MARKDOWN_OUTPUT).read_text(encoding="utf-8")
    assert "### Social Skill Rolls" in markdown
    assert "No public social-skill rolls (Charm, Fast Talk, Intimidate, Persuade) were recorded." in markdown


def test_initial_skills_prefer_creation_frozen_snapshot(tmp_path):
    module = _load()
    run = tmp_path / "run"
    _fixture(run)
    investigator = run / "sandbox" / ".coc" / "investigators" / "ada"
    character = json.loads(
        (investigator / "character.json").read_text(encoding="utf-8")
    )
    # Live sheet was mutated by settlement; the snapshot froze creation values.
    character["initial_skills_snapshot"] = {"Library Use": 65}
    _write_json(investigator / "character.json", character)

    report = module.export_battle_report(run)

    projected = report["investigators"][0]["character"]
    assert projected["initial_skills"] == {"Library Use": 65}
    assert projected["skills"] == {"Library Use": 65}
    assert "initial_skills_validation" not in projected


def test_exports_kp_guided_era_adaptive_creation_provenance(tmp_path):
    module = _load()
    run = tmp_path / "run"
    _fixture(run)
    investigator = run / "sandbox" / ".coc" / "investigators" / "ada"
    character = json.loads(
        (investigator / "character.json").read_text(encoding="utf-8")
    )
    occupation = {
        "name": "领主家臣",
        "reason": "为领主处理文书、巡视封地并随行出行。",
        "era_adaptive": True,
        "skill_point_formula": "EDU*4",
        "formula_reason": "该职位的训练重心是读写、礼法与行政教育。",
    }
    character.update({
        "era": "medieval",
        "era_adaptive": True,
        "kp_guided": True,
        "occupation": occupation,
        "skill_provenance": {
            "Drive Auto": {
                "original_name": "Drive Auto",
                "reskinned_name": "骑术",
                "era_adaptive": True,
            },
            "Heraldry": {
                "original_name": "History",
                "reskinned_name": "纹章学",
                "era_adaptive": True,
                "custom": True,
            },
        },
    })
    _write_json(investigator / "character.json", character)
    _write_json(investigator / "creation.json", {
        "input_mode": "kp_guided_era_adaptive",
        "era": "medieval",
        "era_adaptive": True,
        "kp_guided": True,
        "method": "point_buy_460",
        "occupation": occupation,
        "skill_budget": {
            "occupation_points": {
                "budget": 260,
                "spent": 260,
                "allocations": {"Heraldry": 45, "Drive Auto": 20},
            },
            "personal_interest_points": {
                "budget": 130,
                "spent": 130,
                "allocations": {"Stealth": 50, "Ride": 50},
            },
        },
        "keeper_secret": "DO_NOT_EXPORT",
    })

    report = module.export_battle_report(run)

    investigator_report = report["investigators"][0]
    projected_character = investigator_report["character"]
    assert projected_character["era_adaptive"] is True
    assert projected_character["kp_guided"] is True
    assert projected_character["skill_provenance"] == {
        "Drive Auto": {
            "original_name": "Drive Auto",
            "reskinned_name": "骑术",
            "era_adaptive": True,
        },
        "Heraldry": {
            "original_name": "History",
            "reskinned_name": "纹章学",
            "era_adaptive": True,
            "custom": True,
        },
    }
    expected_creation = {
        "input_mode": "kp_guided_era_adaptive",
        "era": "medieval",
        "era_adaptive": True,
        "kp_guided": True,
        "method": "point_buy_460",
        "occupation": occupation,
        "skill_budget": {
            "occupation_points": {
                "budget": 260,
                "spent": 260,
                "allocations": {"Heraldry": 45, "Drive Auto": 20},
            },
            "personal_interest_points": {
                "budget": 130,
                "spent": 130,
                "allocations": {"Stealth": 50, "Ride": 50},
            },
        },
    }
    assert investigator_report["creation"] == expected_creation
    assert projected_character["creation"] == expected_creation
    evidence = (run / "artifacts" / JSON_OUTPUT).read_text(encoding="utf-8")
    assert "DO_NOT_EXPORT" not in evidence
    markdown = (run / "artifacts" / MARKDOWN_OUTPUT).read_text(encoding="utf-8")
    for phrase in (
        "#### Era-Adaptive Creation",
        "- Input Mode: kp_guided_era_adaptive",
        "- Skill Point Formula: EDU*4",
        "- Skill Budget Provenance:",
        "  - Occupation Points: 260 / 260",
        "#### Skill Adaptation Provenance",
        "- `Drive Auto`: `Drive Auto` → 骑术",
        "- `Heraldry`: `History` → 纹章学 (custom)",
    ):
        assert phrase in markdown

    metadata = json.loads((run / "run.json").read_text(encoding="utf-8"))
    metadata["play_language"] = "zh-Hans"
    _write_json(run / "run.json", metadata)
    module.export_battle_report(run)
    zh_markdown = (run / "artifacts" / MARKDOWN_OUTPUT).read_text(encoding="utf-8")
    for phrase in (
        "#### 年代适配建卡",
        "- 输入模式: kp_guided_era_adaptive",
        "- 职业技能点公式: EDU*4",
        "- 技能点预算来源:",
        "#### 技能年代适配来源",
        "- `Heraldry`: `History` → 纹章学（自创）",
    ):
        assert phrase in zh_markdown


def test_initial_skills_omitted_without_snapshot_or_player_facing_sheet(tmp_path):
    module = _load()
    run = tmp_path / "run"
    _fixture(run)
    investigator = run / "sandbox" / ".coc" / "investigators" / "ada"
    character = json.loads(
        (investigator / "character.json").read_text(encoding="utf-8")
    )
    del character["player_facing_sheet_zh"]
    _write_json(investigator / "character.json", character)

    report = module.export_battle_report(run)

    projected = report["investigators"][0]["character"]
    assert "initial_skills" not in projected
    assert "initial_skill_rows" not in projected
    # The live mutated map stays labeled as live skills, never as initial.
    assert projected["skills"] == {"Library Use": 73}
    assert "initial_skills_validation" in projected
    markdown = (run / "artifacts" / MARKDOWN_OUTPUT).read_text(encoding="utf-8")
    assert "Initial Skills" not in markdown
    assert "Library Use: 73" not in markdown


def test_audit_channel_written_with_hashes_and_no_leak_into_evidence(tmp_path):
    module = _load()
    run = tmp_path / "run"
    _fixture(run)
    report = module.export_battle_report(run)

    audit_dir = run / "artifacts" / "audit"
    expected = {
        "rules-audit.md", "rolls.jsonl", "sanity-events.jsonl",
        "settlements.json", "dispositions.json", "report-validation.json",
        "transcript.jsonl", "rule-decisions.jsonl", "social-resolutions.jsonl",
        "psychology-hidden.jsonl", "scene-budget.jsonl",
        "narration-revisions.jsonl", "state-diffs.jsonl",
        "manifest.json", "hashes.sha256",
    }
    assert expected == {path.name for path in audit_dir.iterdir()}

    # Concealed rolls appear in the audit channel only.
    audit_rolls = (audit_dir / "rolls.jsonl").read_text(encoding="utf-8")
    assert "keeper-1" in audit_rolls
    rules_audit = (audit_dir / "rules-audit.md").read_text(encoding="utf-8")
    assert "keeper-1" in rules_audit

    # Neither primary output carries the audit section or concealed content.
    evidence_text = (run / "artifacts" / JSON_OUTPUT).read_text(encoding="utf-8")
    assert "KEEPER_ROLL_SECRET" not in evidence_text
    evidence = json.loads(evidence_text)
    assert "audit" not in evidence
    markdown_text = (run / "artifacts" / MARKDOWN_OUTPUT).read_text(encoding="utf-8")
    assert "KEEPER_ROLL_SECRET" not in markdown_text

    # Hash ledger is self-consistent.
    import hashlib as _hashlib
    hashes_text = (audit_dir / "hashes.sha256").read_text(encoding="utf-8")
    for line in hashes_text.strip().splitlines():
        digest, name = line.split("  ", 1)
        content = (audit_dir / name).read_bytes()
        assert _hashlib.sha256(content).hexdigest() == digest
    manifest = json.loads((audit_dir / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["report_id"].startswith("coc-battle-report-")
    assert "report_id" not in report
    assert set(manifest["files"]) == (
        expected - {"manifest.json", "hashes.sha256"}
    ) | {"../battle-report-evidence.json", "../battle-report.md"}

    validation = json.loads(
        (audit_dir / "report-validation.json").read_text(encoding="utf-8")
    )
    assert validation["completeness"]["classification"] == report["completeness"]["classification"]


def test_initial_final_snapshot_separation_dimension(tmp_path):
    module = _load()
    run = tmp_path / "run"
    _fixture(run)
    report = module.export_battle_report(run)
    dimension = report["completeness"]["dimensions"]["initial_final_snapshot_separation"]
    assert dimension["status"] == "PASS"

    run2 = tmp_path / "run2"
    _fixture(run2)
    investigator = run2 / "sandbox" / ".coc" / "investigators" / "ada"
    character = json.loads(
        (investigator / "character.json").read_text(encoding="utf-8")
    )
    # Live-leak shape: the "initial" snapshot carries the post-improvement value.
    character["initial_skills_snapshot"] = {"Library Use": 73}
    _write_json(investigator / "character.json", character)
    report2 = module.export_battle_report(run2)
    dimension2 = report2["completeness"]["dimensions"]["initial_final_snapshot_separation"]
    assert dimension2["status"] == "FAIL"
    assert report2["completeness"]["classification"] == "INCOMPLETE"


def test_settlement_session_uniqueness_dimension(tmp_path):
    module = _load()
    run = tmp_path / "run"
    _fixture(run)
    report = module.export_battle_report(run)
    dimension = report["completeness"]["dimensions"]["settlement_session_uniqueness"]
    assert dimension["status"] == "PASS"

    run2 = tmp_path / "run2"
    _fixture(run2)
    campaign = run2 / "sandbox" / ".coc" / "campaigns" / "case-1"
    _write_json(
        campaign / "save" / "development-settlements" / "boundaries" / "ada.json",
        {
            "schema_version": 1,
            "investigator_id": "ada",
            "boundaries": [
                {"boundary_id": "case-1:session:1", "session_ids": ["case-1:session:1"], "first_ending_id": "ending-1", "settled_at": "t", "operation_id": "op-1", "receipt_ref": "r1"},
                {"boundary_id": "case-1:session:1", "session_ids": ["case-1:session:1"], "first_ending_id": "ending-2", "settled_at": "t2", "operation_id": "op-2", "receipt_ref": "r2"},
            ],
        },
    )
    report2 = module.export_battle_report(run2)
    dimension2 = report2["completeness"]["dimensions"]["settlement_session_uniqueness"]
    assert dimension2["status"] == "FAIL"


def test_audit_counts_narration_review_findings(tmp_path):
    module = _load()
    run = tmp_path / "run"
    _fixture(run)
    campaign = run / "sandbox" / ".coc" / "campaigns" / "case-1"
    _write_jsonl(campaign / "logs" / "narration-reviews.jsonl", [
        {"schema_version": 1, "decision_id": "t1", "draft_sha256": "x",
         "findings": [{"rule_id": "over_length", "reason": "too long"}]},
        {"schema_version": 1, "decision_id": "t2", "draft_sha256": "y",
         "findings": [
             {"rule_id": "over_length", "reason": "still long"},
             {"rule_id": "agency_violation", "reason": "decided for the player"},
         ]},
    ])
    report = module.export_battle_report(run)
    rules_audit = (run / "artifacts" / "audit" / "rules-audit.md").read_text(encoding="utf-8")
    assert "over_length: 2" in rules_audit
    assert "agency_violation: 1" in rules_audit
    assert "review count: 2" in rules_audit
    # Review findings stay out of the primary evidence output.
    evidence_text = (run / "artifacts" / JSON_OUTPUT).read_text(encoding="utf-8")
    assert "narration_reviews" not in evidence_text


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("turn_id", "turn-wrong"),
        ("session_id", "session-wrong"),
        ("rendered_text_sha256", "sha256:wrong"),
        ("accepted_revision", None),
    ],
)
def test_accepted_transcript_requires_the_exact_v2_tuple(tmp_path, field, value):
    module = _load()
    run = tmp_path / field
    data = _fixture(run)
    transcript = list(data["transcript"])
    keeper = dict(transcript[1])
    if value is None:
        keeper.pop(field)
    else:
        keeper[field] = value
    transcript[1] = keeper
    _write_jsonl(_canonical_transcript_path(run), transcript)

    report = module.export_battle_report(run)

    assert report["completeness"]["dimensions"]["accepted_transcript"]["status"] == "FAIL"


def test_canonical_player_row_requires_exact_journal_tuple_and_bijection(tmp_path):
    module = _load()
    run = tmp_path / "canonical-player"
    data = _fixture(run)
    campaign = run / "sandbox" / ".coc" / "campaigns" / "case-1"
    keeper = dict(data["transcript"][1])
    player = {
        "role": "player", "text": "我查看门锁。", "turn_id": "turn-1",
        "run_segment_id": "run-1", "session_id": "session-1",
        "journal_decision_id": "fin-1-journal",
    }
    _write_jsonl(campaign / "logs" / "table-transcript.jsonl", [player, keeper])
    calls = [
        {"tool": "state.journal", "ok": True, "args": {"decision_id": "fin-1-journal"}, "data": {}},
        {"tool": "director.advise", "ok": True, "args": {"decision_id": "d1"}, "data": {}},
    ]
    _write_jsonl(campaign / "logs" / "toolbox-calls.jsonl", calls)
    report = module.export_battle_report(run)
    assert report["completeness"]["dimensions"]["accepted_transcript"]["status"] == "PASS"

    player.pop("turn_id")
    _write_jsonl(campaign / "logs" / "table-transcript.jsonl", [player, keeper])
    report = module.export_battle_report(run)
    assert report["completeness"]["dimensions"]["accepted_transcript"]["status"] == "FAIL"
    assert any(
        "accepted player row" in finding and "turn_id" in finding
        for finding in _audit_completeness(run)["dimensions"]["accepted_transcript"]["findings"]
    )


def _journal_call(decision_id, *, ok=True, replay=False, player_text="我说：进去", extra=None):
    call = {
        "tool": "state.journal",
        "ok": ok,
        "args": {"decision_id": decision_id, "player_text": player_text},
        "data": {},
    }
    if replay:
        call["idempotent_replay"] = True
    if extra:
        call.update(extra)
    return call


def _accepted_transcript_findings(run):
    return _audit_completeness(run)["dimensions"]["accepted_transcript"]


def test_identical_journal_replay_counts_as_one_write(tmp_path):
    module = _load()
    run = tmp_path / "journal-replay-pass"
    _fixture(run)
    campaign = run / "sandbox" / ".coc" / "campaigns" / "case-1"
    _write_jsonl(campaign / "logs" / "toolbox-calls.jsonl", [
        _journal_call("fin-1-journal"),
        _journal_call("fin-1-journal", replay=True),
        {"tool": "director.advise", "ok": True, "args": {"decision_id": "d1"}, "data": {}},
    ])

    report = module.export_battle_report(run)
    dimension = _accepted_transcript_findings(run)
    assert report["completeness"]["dimensions"]["accepted_transcript"]["status"] == "PASS"
    assert dimension["status"] == "PASS"
    assert not any("duplicated" in finding for finding in dimension["findings"])


def test_two_non_replay_journal_successes_same_id_fail(tmp_path):
    module = _load()
    run = tmp_path / "journal-two-writes"
    _fixture(run)
    campaign = run / "sandbox" / ".coc" / "campaigns" / "case-1"
    _write_jsonl(campaign / "logs" / "toolbox-calls.jsonl", [
        _journal_call("fin-1-journal"),
        _journal_call("fin-1-journal", player_text="另一句玩家原文"),
    ])

    report = module.export_battle_report(run)
    dimension = _accepted_transcript_findings(run)
    assert report["completeness"]["dimensions"]["accepted_transcript"]["status"] == "FAIL"
    assert any(
        "state.journal decision ids are duplicated" in finding
        and "fin-1-journal" in finding
        for finding in dimension["findings"]
    )


def test_replay_marker_cannot_hide_conflicting_payload_or_failure(tmp_path):
    module = _load()
    run = tmp_path / "journal-replay-conflict"
    _fixture(run)
    campaign = run / "sandbox" / ".coc" / "campaigns" / "case-1"

    _write_jsonl(campaign / "logs" / "toolbox-calls.jsonl", [
        _journal_call("fin-1-journal"),
        _journal_call("fin-1-journal", replay=True, player_text="recovery"),
    ])
    report = module.export_battle_report(run)
    dimension = _accepted_transcript_findings(run)
    assert report["completeness"]["dimensions"]["accepted_transcript"]["status"] == "FAIL"
    assert any(
        "replay marker hides a conflicting payload" in finding
        and "fin-1-journal" in finding
        for finding in dimension["findings"]
    )

    _write_jsonl(campaign / "logs" / "toolbox-calls.jsonl", [
        _journal_call("fin-1-journal"),
        _journal_call(
            "fin-1-journal", replay=True, ok=False, player_text="recovery",
            extra={"error": {"code": "idempotency_conflict"}},
        ),
    ])
    report = module.export_battle_report(run)
    dimension = _accepted_transcript_findings(run)
    assert report["completeness"]["dimensions"]["accepted_transcript"]["status"] == "FAIL"
    assert any(
        "replay marker hides a failed receipt" in finding
        and "fin-1-journal" in finding
        for finding in dimension["findings"]
    )

    _write_jsonl(campaign / "logs" / "toolbox-calls.jsonl", [
        _journal_call("fin-1-journal"),
        _journal_call("fin-1-journal", replay=True),
        _journal_call(
            "fin-1-journal", ok=False, player_text="recovery",
            extra={"error": {"code": "idempotency_conflict"}},
        ),
    ])
    report = module.export_battle_report(run)
    dimension = _accepted_transcript_findings(run)
    assert report["completeness"]["dimensions"]["accepted_transcript"]["status"] == "PASS"
    assert not any("duplicated" in finding for finding in dimension["findings"])
    assert not any("replay marker hides" in finding for finding in dimension["findings"])


def test_duplicate_canonical_player_journal_rows_still_fail(tmp_path):
    module = _load()
    run = tmp_path / "journal-transcript-dup"
    data = _fixture(run)
    campaign = run / "sandbox" / ".coc" / "campaigns" / "case-1"
    player = dict(data["transcript"][0])
    duplicate = dict(player)
    duplicate["turn"] = 2
    keeper = dict(data["transcript"][1])
    _write_jsonl(campaign / "logs" / "table-transcript.jsonl", [player, duplicate, keeper])
    _write_jsonl(campaign / "logs" / "toolbox-calls.jsonl", [
        _journal_call("fin-1-journal"),
        _journal_call("fin-1-journal", replay=True),
    ])

    report = module.export_battle_report(run)
    dimension = _accepted_transcript_findings(run)
    assert report["completeness"]["dimensions"]["accepted_transcript"]["status"] == "FAIL"
    assert any(
        "accepted player rows duplicate journal bindings" in finding
        and "fin-1-journal" in finding
        for finding in dimension["findings"]
    )
    assert not any("state.journal decision ids are duplicated" in finding for finding in dimension["findings"])


def _table_opening_row(*, record_kind="table_opening"):
    """Real RPC opening shape: turn 0, table.opening provenance, no finalization."""
    row = {
        "schema_version": 1,
        "role": "keeper",
        "text": "你站在阿卡姆火车站的雨里。",
        "turn": 0,
        "turn_id": "opening:run-1",
        "run_segment_id": "run-1",
        "session_id": "session-1",
        "journal_decision_id": "",
        "finalization_id": None,
        "accepted_revision": None,
        "rendered_text_sha256": None,
        "source_id": "table-opening-case-1",
        "source_ref": "table.opening#table-opening-case-1",
        "run_segment_source": "table_opening",
        "run_segment_trust": "authoritative",
        "speaker": "守秘人",
    }
    if record_kind is not None:
        row["record_kind"] = record_kind
    return row


@pytest.mark.parametrize("record_kind", ["table_opening", None])
def test_accepted_transcript_counts_canonical_opening_with_finalized_pair(
    tmp_path, record_kind
):
    module = _load()
    run = tmp_path / f"opening-plus-turn-{record_kind or 'provenance'}"
    data = _fixture(run)
    opening = _table_opening_row(record_kind=record_kind)
    player = {**data["transcript"][0], "record_kind": "player_turn"}
    keeper = {**data["transcript"][1], "record_kind": "finalized_keeper"}
    _write_jsonl(_canonical_transcript_path(run), [opening, player, keeper])

    report = module.export_battle_report(run)
    dimension = _audit_completeness(run)["dimensions"]["accepted_transcript"]

    assert dimension["status"] == "PASS"
    assert report["completeness"]["dimensions"]["accepted_transcript"]["status"] == "PASS"
    assert report["transcript"]["source_record_count"] == 3
    assert report["transcript"]["dialogue_record_count"] == 3
    assert report["completeness"]["dialogue_role_counts"] == {"keeper": 2, "player": 1}
    assert not any("missing" in finding and "finalization" in finding for finding in dimension["findings"])


def test_accepted_transcript_fails_opening_masquerading_as_finalized_turn(tmp_path):
    module = _load()
    run = tmp_path / "opening-masquerade"
    data = _fixture(run)
    opening = _table_opening_row()
    opening["finalization_id"] = "fin-fake"
    opening["accepted_revision"] = 1
    opening["rendered_text_sha256"] = _canonical_digest(opening["text"])
    player = {**data["transcript"][0], "record_kind": "player_turn"}
    keeper = {**data["transcript"][1], "record_kind": "finalized_keeper"}
    _write_jsonl(_canonical_transcript_path(run), [opening, player, keeper])

    report = module.export_battle_report(run)
    dimension = _audit_completeness(run)["dimensions"]["accepted_transcript"]
    assert report["completeness"]["dimensions"]["accepted_transcript"]["status"] == "FAIL"
    assert dimension["status"] == "FAIL"
    assert any("must not carry finalization fields" in finding for finding in dimension["findings"])


def test_accepted_transcript_fails_untyped_unfinalized_keeper_row(tmp_path):
    module = _load()
    run = tmp_path / "untyped-unfinalized"
    data = _fixture(run)
    opening = _table_opening_row()
    player = {
        "turn": 1, "role": "player", "speaker": "Ada King",
        "text": "我说：\"进去\" | yes 🚪", "turn_id": "turn-1",
        "run_segment_id": "run-1", "session_id": "session-1",
        "journal_decision_id": "fin-1-journal",
        "record_kind": "player_turn",
    }
    keeper = dict(data["transcript"][1])
    keeper["record_kind"] = "finalized_keeper"
    untyped = {
        "turn": 2, "role": "keeper", "speaker": "KP",
        "text": "一段未定稿的旁白。", "turn_id": "turn-2",
        "run_segment_id": "run-1", "session_id": "session-1",
    }
    _write_jsonl(_canonical_transcript_path(run), [opening, player, keeper, untyped])

    report = module.export_battle_report(run)
    dimension = _audit_completeness(run)["dimensions"]["accepted_transcript"]
    assert report["completeness"]["dimensions"]["accepted_transcript"]["status"] == "FAIL"
    assert dimension["status"] == "FAIL"
    assert any("NOT_PROVEN" in finding and "finalization_id" in finding for finding in dimension["findings"])
    assert report["transcript"]["source_record_count"] == 4


def test_dispositioned_revision_is_audit_only(tmp_path):
    module = _load()
    run = tmp_path / "revision"
    data = _fixture(run)
    campaign = run / "sandbox" / ".coc" / "campaigns" / "case-1"
    old_text = "旧稿：你已经决定相信他。"
    accepted_text = "新稿：他把手从抽屉上移开。"
    accepted_review = _review(
        "review-fin-2", revision=2, draft_text=accepted_text,
    )
    receipt = _finalization_receipt(
        "fin-2", ["public-1"], rendered_text=accepted_text,
        revision=2, review=accepted_review,
    )
    transcript = list(data["transcript"])
    transcript[0] = {**transcript[0], "journal_decision_id": "fin-2-journal"}
    transcript[1] = {
        **transcript[1],
        "text": accepted_text,
        "finalization_id": "fin-2",
        "accepted_revision": 2,
        "rendered_text_sha256": _canonical_digest(accepted_text),
    }
    _write_jsonl(_canonical_transcript_path(run), transcript)
    _write_jsonl(campaign / "logs" / "turn-finalizations.jsonl", [receipt])
    _write_jsonl(campaign / "logs" / "narration-reviews.jsonl", [accepted_review])
    _write_jsonl(campaign / "logs" / "undelivered-output-repairs.jsonl", [{
        "source_finalization_id": "fin-1",
        "source_revision": 1,
        "source_rendered_text": old_text,
        "replacement_finalization_id": "fin-2",
        "replacement_revision": 2,
    }])
    calls = [
        {"tool": "state.journal", "ok": True, "args": {"decision_id": "fin-2-journal"}, "data": {}},
    ]
    _write_jsonl(campaign / "logs" / "toolbox-calls.jsonl", calls)

    module.export_battle_report(run)
    primary = (
        (run / "artifacts" / MARKDOWN_OUTPUT).read_text(encoding="utf-8")
        + (run / "artifacts" / JSON_OUTPUT).read_text(encoding="utf-8")
    )
    revisions = (run / "artifacts" / "audit" / "narration-revisions.jsonl").read_text(encoding="utf-8")
    assert accepted_text in primary
    assert old_text not in primary
    assert old_text in revisions


def test_scene_scope_requires_named_promotion_and_rejects_improvised_unlock(tmp_path):
    module = _load()
    run = tmp_path / "scene"
    _fixture(run)
    campaign = run / "sandbox" / ".coc" / "campaigns" / "case-1"
    events = [
        {"event_id": "drift-1", "event_type": "scene_scope_drift", "scene_id": "transit", "acceptance_severity": "hard", "truth_tier": 4},
        {"event_id": "promotion-1", "event_type": "scene_promotion", "scene_id": "transit", "source_event_ids": ["other-event"]},
        {"event_id": "improv-1", "event_type": "clue_discovered", "clue_id": "improv", "provenance": "improvised", "local_only": True, "can_unlock_authored_milestone": True},
        {"event_type": "session_ending", "ending_id": "ending-1", "scene_id": "archive", "kind": "conclusion", "summary": "done"},
    ]
    _write_jsonl(campaign / "logs" / "events.jsonl", events)

    report = module.export_battle_report(run)
    dimension = _audit_completeness(run)["dimensions"]["scene_scope"]
    assert dimension["status"] == "FAIL"
    assert any("drift-1" in finding for finding in dimension["findings"])
    assert any("improv-1" in finding for finding in dimension["findings"])

    events[1] = _scene_promotion()
    events[2]["can_unlock_authored_milestone"] = False
    _write_jsonl(campaign / "logs" / "events.jsonl", events)
    report = module.export_battle_report(run)
    assert report["completeness"]["dimensions"]["scene_scope"]["status"] == "PASS"


def test_agency_is_not_proven_without_bound_review_and_accepted_violation_fails(tmp_path):
    module = _load()
    run = tmp_path / "agency"
    _fixture(run)
    campaign = run / "sandbox" / ".coc" / "campaigns" / "case-1"
    receipt_path = campaign / "logs" / "turn-finalizations.jsonl"
    receipt = json.loads(receipt_path.read_text(encoding="utf-8").splitlines()[0])
    receipt["narration_review"] = None
    _refresh_receipt(receipt)
    _write_jsonl(receipt_path, [receipt])
    _write_jsonl(campaign / "logs" / "narration-reviews.jsonl", [])
    report = module.export_battle_report(run)
    assert report["completeness"]["dimensions"]["agency"]["status"] == "NOT_PROVEN"
    assert report["completeness"]["classification"] == "INCOMPLETE"

    violation = _review("review-violation", findings=[{
        "rule_id": "agency_violation", "subject_ref": "pc:ada",
        "source_ref": None, "reason": "替玩家决定相信 NPC",
    }])
    receipt["narration_review"] = {
        "review_id": violation["review_id"],
        "review_digest": violation["review_digest"],
        "draft_sha256": violation["draft_sha256"],
    }
    _refresh_receipt(receipt)
    _write_jsonl(receipt_path, [receipt])
    _write_jsonl(campaign / "logs" / "narration-reviews.jsonl", [violation])
    report = module.export_battle_report(run)
    assert report["completeness"]["dimensions"]["agency"]["status"] == "FAIL"


def test_dispositioned_agency_finding_does_not_condemn_accepted_revision(tmp_path):
    module = _load()
    run = tmp_path / "dispositioned-agency"
    _fixture(run)
    campaign = run / "sandbox" / ".coc" / "campaigns" / "case-1"
    old = _review("review-old", findings=[{
        "rule_id": "agency_violation", "subject_ref": "pc:ada",
        "source_ref": None, "reason": "old draft violation",
    }])
    accepted_text = "门上写着 **勿入**。\n第二行有 `code`。"
    accepted = _review("review-accepted", draft_text=accepted_text)
    receipt = _finalization_receipt(
        "fin-1", ["public-1"], rendered_text=accepted_text,
        review=accepted,
    )
    _write_jsonl(campaign / "logs" / "narration-reviews.jsonl", [old, accepted])
    _write_jsonl(campaign / "logs" / "turn-finalizations.jsonl", [receipt])
    report = module.export_battle_report(run)
    assert report["completeness"]["dimensions"]["agency"]["status"] == "PASS"
    audit = (run / "artifacts" / "audit" / "narration-revisions.jsonl").read_text(encoding="utf-8")
    assert "old draft violation" in audit


def test_agency_cannot_pass_when_review_draft_hash_does_not_bind_accepted_draft(
    tmp_path,
):
    module = _load()
    run = tmp_path / "wrong-review-draft"
    _fixture(run)
    campaign = run / "sandbox" / ".coc" / "campaigns" / "case-1"
    wrong_review = _review(
        "review-wrong-draft", draft_text="另一份没有被接受的草稿。",
    )
    receipt = _finalization_receipt(
        "fin-1", ["public-1"],
        rendered_text="门上写着 **勿入**。\n第二行有 `code`。",
        review=wrong_review,
    )
    _write_jsonl(
        campaign / "logs" / "narration-reviews.jsonl", [wrong_review],
    )
    _write_jsonl(campaign / "logs" / "turn-finalizations.jsonl", [receipt])

    report = module.export_battle_report(run)

    assert report["completeness"]["dimensions"]["agency"]["status"] != "PASS"


def test_legacy_review_reference_without_raw_draft_hash_is_not_proven(tmp_path):
    module = _load()
    run = tmp_path / "legacy-review-reference"
    _fixture(run)
    campaign = run / "sandbox" / ".coc" / "campaigns" / "case-1"
    receipt_path = campaign / "logs" / "turn-finalizations.jsonl"
    receipt = json.loads(receipt_path.read_text().splitlines()[0])
    receipt["narration_review"].pop("draft_sha256")
    _refresh_receipt(receipt)
    _write_jsonl(receipt_path, [receipt])

    report = module.export_battle_report(run)

    assert report["completeness"]["dimensions"]["agency"]["status"] == "NOT_PROVEN"


@pytest.mark.parametrize("conflict_first", [True, False])
def test_duplicate_review_id_is_conflicting_agency_evidence_in_both_orders(
    tmp_path, conflict_first,
):
    module = _load()
    run = tmp_path / f"duplicate-review-{conflict_first}"
    _fixture(run)
    campaign = run / "sandbox" / ".coc" / "campaigns" / "case-1"
    legal = _review("review-fin-1")
    conflict = _review(
        "review-fin-1", draft_text="冲突草稿。", findings=[{
            "rule_id": "agency_violation", "subject_ref": "pc:ada",
            "source_ref": None, "reason": "同一 review_id 的冲突证据",
        }],
    )
    rows = [conflict, legal] if conflict_first else [legal, conflict]
    _write_jsonl(campaign / "logs" / "narration-reviews.jsonl", rows)

    report = module.export_battle_report(run)

    agency = report["completeness"]["dimensions"]["agency"]
    assert agency["status"] == "FAIL"
    audit_agency = _audit_completeness(run)["dimensions"]["agency"]
    assert any(
        "duplicate narration review id" in row
        for row in audit_agency["findings"]
    )


@pytest.mark.parametrize(
    ("claim_type", "source_ref"),
    [
        ("voluntary_belief", "player_input:wrong"),
        ("involuntary_physiology", "narration_contract:wrong"),
    ],
)
def test_agency_rejects_non_forced_claim_with_wrong_frozen_source(
    tmp_path, claim_type, source_ref,
):
    module = _load()
    run = tmp_path / f"wrong-{claim_type}"
    _fixture(run)
    campaign = run / "sandbox" / ".coc" / "campaigns" / "case-1"
    receipt_path = campaign / "logs" / "turn-finalizations.jsonl"
    receipt = json.loads(receipt_path.read_text().splitlines()[0])
    receipt["agency_claims"] = [{
        "claim_id": f"claim-{claim_type}", "claim_type": claim_type,
        "subject_ref": "pc:ada", "source_ref": source_ref,
        "override_id": None, "exact_excerpt": "门上写着",
    }]
    receipt["contract_projection"].update({
        "player_input": {"source_ref": "player_input:fin-1-journal"},
        "agency_authority": {
            "pc_subject_refs": ["pc:ada"],
            "involuntary_physiology_sources": [{
                "source_type": "ownership_contract",
                "source_ref": "narration_contract:involuntary_physiology",
            }],
        },
    })
    _refresh_receipt(receipt)
    _write_jsonl(receipt_path, [receipt])

    report = module.export_battle_report(run)

    assert report["completeness"]["dimensions"]["agency"]["status"] == "FAIL"


def test_forced_claim_requires_frozen_active_override(tmp_path):
    module = _load()
    run = tmp_path / "forced"
    _fixture(run)
    campaign = run / "sandbox" / ".coc" / "campaigns" / "case-1"
    receipt_path = campaign / "logs" / "turn-finalizations.jsonl"
    receipt = json.loads(receipt_path.read_text(encoding="utf-8").splitlines()[0])
    receipt["agency_claims"] = [{
        "claim_id": "forced-1", "claim_type": "forced_behavior",
        "subject_ref": "pc:ada", "source_ref": "rule:bout-1",
        "override_id": "override-1", "exact_excerpt": "尖叫",
    }]
    receipt["contract_projection"]["control_overrides"] = [{
        "override_id": "override-1", "subject_ref": "pc:ada",
        "source_ref": "rule:bout-1", "active": False,
    }]
    _refresh_receipt(receipt)
    _write_jsonl(receipt_path, [receipt])
    report = module.export_battle_report(run)
    assert report["completeness"]["dimensions"]["agency"]["status"] == "FAIL"


def test_hidden_psychology_isolated_and_impressions_are_not_confirmed_clues(tmp_path):
    module = _load()
    run = tmp_path / "psych"
    _fixture(run)
    campaign = run / "sandbox" / ".coc" / "campaigns" / "case-1"
    _write_json(campaign / "save" / "psychology-observations.json", {
        "schema_version": 2,
        "observations": {"window-secret": {
            "insight_id": "insight-secret", "window_key": "window-secret",
            "roll_id": "psych-roll-secret", "outcome": "fumble",
        }},
        "realizations": {"insight-secret": {
            "insight_id": "insight-secret", "question": "他害怕谁？",
            "visible_observation": "他提到检查时先看了门口。",
        }},
    })
    module.export_battle_report(run)
    primary = (
        (run / "artifacts" / MARKDOWN_OUTPUT).read_text(encoding="utf-8")
        + (run / "artifacts" / JSON_OUTPUT).read_text(encoding="utf-8")
    )
    hidden = (run / "artifacts" / "audit" / "psychology-hidden.jsonl").read_text(encoding="utf-8")
    assert "他提到检查时先看了门口。" in primary
    for identifier in ("psych-roll-secret", "insight-secret", "window-secret", "fumble"):
        assert identifier not in primary
        assert identifier in hidden
    assert "Investigator Impressions (Not Confirmed Facts)" in primary


def test_projection_manifest_detects_tamper_and_audit_order_is_deterministic(tmp_path):
    module = _load()
    run = tmp_path / "hashes"
    _fixture(run)
    module.export_battle_report(run)
    audit = run / "artifacts" / "audit"
    before = {path.name: path.read_bytes() for path in audit.iterdir()}
    module.export_battle_report(run)
    assert before == {path.name: path.read_bytes() for path in audit.iterdir()}
    manifest = json.loads((audit / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["files"]["../battle-report.md"]["distribution"] == "player"
    assert manifest["files"]["psychology-hidden.jsonl"]["distribution"] == "keeper_development_audit"
    assert "hashes.sha256" not in manifest["files"]
    (run / "artifacts" / MARKDOWN_OUTPUT).write_text("tampered", encoding="utf-8")
    assert any("hash mismatch" in finding for finding in module._verify_projection_artifacts(run / "artifacts"))


def test_state_dimension_never_fabricates_a_fold_or_diff(tmp_path):
    module = _load()
    run = tmp_path / "state"
    _fixture(run)
    campaign = run / "sandbox" / ".coc" / "campaigns" / "case-1"
    leftover = campaign / "save" / "commit-snapshots" / "fin-1"
    leftover.mkdir(parents=True)
    (leftover / "world-state.json").write_text("{}\n", encoding="utf-8")
    _write_jsonl(campaign / "logs" / "toolbox-calls.jsonl", [{
        "tool": "state.set_flag", "ok": True,
        "args": {"decision_id": "flag-1"}, "data": {"flag": "x", "value": True},
    }])
    report = module.export_battle_report(run)
    assert report["completeness"]["dimensions"]["state"]["status"] == "NOT_PROVEN"
    assert report["state_integrity"]["status"] == "NOT_PROVEN"
    assert "missing_sidecar_repo" in report["state_integrity"]["reason_codes"]
    assert (run / "artifacts" / "audit" / "state-diffs.jsonl").read_text(encoding="utf-8") == ""
    _prove_git_state(run)
    report = module.export_battle_report(run)
    assert report["completeness"]["dimensions"]["state"]["status"] == "PASS"
    assert report["state_integrity"]["status"] == "PASS"
    assert leftover.is_dir()
    assert (run / "artifacts" / "audit" / "state-diffs.jsonl").read_text(encoding="utf-8") == ""


def test_soft_over_length_on_accepted_revision_does_not_fail_completeness(tmp_path):
    module = _load()
    run = tmp_path / "soft"
    _fixture(run)
    campaign = run / "sandbox" / ".coc" / "campaigns" / "case-1"
    review = _review("review-soft", findings=[{
        "rule_id": "over_length", "subject_ref": None,
        "source_ref": None, "reason": "too long",
    }])
    receipt_path = campaign / "logs" / "turn-finalizations.jsonl"
    receipt = json.loads(receipt_path.read_text(encoding="utf-8").splitlines()[0])
    receipt["narration_review"] = {
        "review_id": review["review_id"], "review_digest": review["review_digest"],
        "draft_sha256": review["draft_sha256"],
    }
    _refresh_receipt(receipt)
    _write_jsonl(receipt_path, [receipt])
    _write_jsonl(campaign / "logs" / "narration-reviews.jsonl", [review])
    _prove_git_state(run)
    report = module.export_battle_report(run)
    assert report["completeness"]["classification"] == "COMPLETE"


def test_canonically_invalid_schema_v2_finalization_cannot_authorize_projection(tmp_path):
    module = _load()
    run = tmp_path / "invalid-finalization"
    _fixture(run)
    campaign = run / "sandbox" / ".coc" / "campaigns" / "case-1"
    receipt_path = campaign / "logs" / "turn-finalizations.jsonl"
    receipt = json.loads(receipt_path.read_text(encoding="utf-8").splitlines()[0])
    receipt["unexpected_shape_only_field"] = True
    _write_jsonl(receipt_path, [receipt])

    report = module.export_battle_report(run)

    dimensions = report["completeness"]["dimensions"]
    assert dimensions["accepted_transcript"]["status"] == "FAIL"
    assert dimensions["dice"]["status"] == "FAIL"
    assert dimensions["state"]["status"] == "FAIL"
    assert dimensions["agency"]["status"] == "FAIL"
    assert report["public_rolls"]["records"] == []
    assert (run / "artifacts" / "audit" / "state-diffs.jsonl").read_text() == ""


def test_legacy_transcript_is_partial_evidence_not_formal_acceptance(tmp_path):
    module = _load()
    run = tmp_path / "legacy-transcript"
    _fixture(run)
    _canonical_transcript_path(run).unlink()

    report = module.export_battle_report(run)

    assert report["completeness"]["dimensions"]["accepted_transcript"]["status"] == "FAIL"
    assert report["completeness"]["classification"] == "INCOMPLETE"


def test_state_requires_current_save_to_equal_accepted_snapshot_and_rejects_fake_call(tmp_path):
    module = _load()
    run = tmp_path / "state-equality"
    _fixture(run)
    campaign = run / "sandbox" / ".coc" / "campaigns" / "case-1"
    calls_path = campaign / "logs" / "toolbox-calls.jsonl"
    calls = [json.loads(line) for line in calls_path.read_text().splitlines() if line]
    calls.append({
        "tool": "state.fake", "ok": True, "args": {"decision_id": "fake-1"},
        "data": {"before": 1, "after": 2, "delta": 1},
    })
    _write_jsonl(calls_path, calls)
    _prove_git_state(run)
    world_path = campaign / "save" / "world-state.json"
    world = json.loads(world_path.read_text())
    world["post_finalization_mutation"] = True
    _write_json(world_path, world)

    report = module.export_battle_report(run)

    assert report["completeness"]["dimensions"]["state"]["status"] == "FAIL"
    assert report["state_integrity"]["status"] == "FAIL"
    assert "hash_drift" in report["state_integrity"]["reason_codes"]
    assert (run / "artifacts" / "audit" / "state-diffs.jsonl").read_text() == ""


def test_forced_claim_passes_only_with_full_frozen_override_contract(tmp_path):
    module = _load()
    run = tmp_path / "forced-valid"
    _fixture(run)
    campaign = run / "sandbox" / ".coc" / "campaigns" / "case-1"
    receipt_path = campaign / "logs" / "turn-finalizations.jsonl"
    receipt = json.loads(receipt_path.read_text().splitlines()[0])
    receipt["agency_claims"] = [{
        "claim_id": "forced-1", "claim_type": "forced_behavior",
        "subject_ref": "pc:ada", "source_ref": "sanity_bout:bout-1",
        "override_id": "override-1", "exact_excerpt": "尖叫",
    }]
    receipt["contract_projection"]["control_overrides"] = [{
        "override_id": "override-1", "subject_ref": "pc:ada",
        "override_type": "bout_of_madness", "source_rule_id": "core.sanity_bout",
        "source_ref": "sanity_bout:bout-1", "active": True,
        "expiry": {"kind": "rounds_remaining", "value": 7},
        "allowed_scope": ["尖叫", "无法正常调查"],
    }]
    _refresh_receipt(receipt)
    _write_jsonl(receipt_path, [receipt])

    report = module.export_battle_report(run)

    assert report["completeness"]["dimensions"]["agency"]["status"] == "PASS"


def test_player_artifacts_use_labels_and_keep_raw_ids_audit_only(tmp_path):
    module = _load()
    run = tmp_path / "player-labels"
    _fixture(run)
    report = module.export_battle_report(run)
    primary = (
        (run / "artifacts" / MARKDOWN_OUTPUT).read_text()
        + (run / "artifacts" / JSON_OUTPUT).read_text()
    )
    audit = "".join(
        path.read_text(errors="ignore")
        for path in sorted((run / "artifacts" / "audit").iterdir())
        if path.suffix in {".json", ".jsonl", ".md"}
    )
    for identifier in (
        "session-1", "public-1", "clue-public", "npc-clerk", "effect-1", "d1",
    ):
        assert identifier not in primary
    for identifier in (
        "session-1", "public-1", "clue-public", "npc-clerk", "effect-1", "d1",
    ):
        assert identifier in audit
    evidence = json.loads((run / "artifacts" / JSON_OUTPUT).read_text())
    forbidden_keys = []
    def visit(value):
        if isinstance(value, dict):
            for key, child in value.items():
                if key not in {"campaign_id", "run_segment_id", "ruleset_id", "model_id"} and (
                    key == "id" or key.endswith("_id") or key.endswith("_ids")
                ):
                    forbidden_keys.append(key)
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)
    visit(evidence)
    assert forbidden_keys == []
    assert report["completeness"]["dimensions"]["agency"]["status"] == "PASS"


def test_canonical_identity_overrides_incomplete_harness_and_keeps_transcript(tmp_path):
    module = _load()
    run = tmp_path / "canonical-wins"
    _fixture(run)
    metadata = json.loads((run / "run.json").read_text(encoding="utf-8"))
    metadata.pop("run_segment_id")
    metadata.pop("session_id")
    metadata.pop("plugin_version")
    metadata.pop("ruleset_id")
    metadata.pop("ruleset_version")
    _write_json(run / "run.json", metadata)
    foreign = {
        "turn": 9, "role": "player", "text": "foreign session",
        "turn_id": "turn-9", "run_segment_id": "other-run",
        "session_id": "other-session", "journal_decision_id": "foreign-journal",
    }
    transcript_path = _canonical_transcript_path(run)
    rows = [
        json.loads(line)
        for line in transcript_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    _write_jsonl(transcript_path, [*rows, foreign])

    report = module.export_battle_report(run)

    assert report["completeness"]["dimensions"]["run_identity"]["status"] == "PASS"
    assert report["source_identity"]["run_segment_id"] == "run-1"
    assert report["transcript"]["dialogue_record_count"] == 2
    assert all("foreign session" not in row["text"] for row in report["transcript"]["records"])
    validation = json.loads(
        (run / "artifacts" / "audit" / "report-validation.json").read_text(encoding="utf-8")
    )
    assert validation["source_identity"]["identity_source"] == "canonical_campaign"
    assert validation["source_identity"]["canonical_present"] is True


def test_missing_canonical_identity_keeps_rows_and_fails_closed(tmp_path):
    module = _load()
    run = tmp_path / "missing-canonical"
    _fixture(run)
    identity_path = (
        run / "sandbox" / ".coc" / "campaigns" / "case-1" / "save" / "run-identity.json"
    )
    identity_path.unlink()

    report = module.export_battle_report(run)
    dimension = _audit_completeness(run)["dimensions"]["run_identity"]

    assert report["completeness"]["classification"] == "INCOMPLETE"
    assert dimension["status"] == "FAIL"
    assert any("missing" in finding for finding in dimension["findings"])
    assert report["transcript"]["dialogue_record_count"] == 2
    assert report["source_identity"].get("run_segment_id") is None
    validation = json.loads(
        (run / "artifacts" / "audit" / "report-validation.json").read_text(encoding="utf-8")
    )
    assert validation["source_identity"]["identity_source"] == "missing"
    assert validation["source_identity"]["canonical_present"] is False


def test_identity_conflict_between_canonical_and_harness_fails_closed(tmp_path):
    module = _load()
    run = tmp_path / "identity-conflict"
    _fixture(run)
    metadata = json.loads((run / "run.json").read_text(encoding="utf-8"))
    metadata["run_segment_id"] = "harness-run"
    metadata["session_id"] = "harness-session"
    _write_json(run / "run.json", metadata)

    report = module.export_battle_report(run)
    dimension = _audit_completeness(run)["dimensions"]["run_identity"]

    assert report["completeness"]["classification"] == "INCOMPLETE"
    assert dimension["status"] == "FAIL"
    assert any("conflicts" in finding for finding in dimension["findings"])
    assert report["source_identity"]["run_segment_id"] == "run-1"
    assert report["transcript"]["dialogue_record_count"] == 2
    validation = json.loads(
        (run / "artifacts" / "audit" / "report-validation.json").read_text(encoding="utf-8")
    )
    assert set(validation["source_identity"]["harness_conflict_fields"]) == {
        "run_segment_id", "session_id",
    }


def test_corrupt_canonical_identity_fails_closed(tmp_path):
    module = _load()
    run = tmp_path / "identity-corrupt"
    _fixture(run)
    campaign = run / "sandbox" / ".coc" / "campaigns" / "case-1"
    _write_json(campaign / "save" / "run-identity.json", {
        "schema_version": 2,
        "campaign_id": "case-1",
        "run_segment_id": "run-1",
        "session_id": "session-1",
        "plugin_version": "0.4.0-alpha.0",
        "ruleset_id": "coc7",
        "ruleset_version": "1.0.0",
    })

    report = module.export_battle_report(run)
    dimension = _audit_completeness(run)["dimensions"]["run_identity"]

    assert report["completeness"]["classification"] == "INCOMPLETE"
    assert dimension["status"] == "FAIL"
    assert any("corrupt" in finding or "mismatched" in finding for finding in dimension["findings"])
    assert report["transcript"]["dialogue_record_count"] == 2
    validation = json.loads(
        (run / "artifacts" / "audit" / "report-validation.json").read_text(encoding="utf-8")
    )
    assert validation["source_identity"]["identity_source"] == "corrupt"
    assert validation["source_identity"]["identity_error"]["reason"].startswith(
        "schema_version_mismatch"
    )


def test_git_state_proof_matrix_and_player_evidence_stay_bounded(tmp_path):
    module = _load()
    missing = tmp_path / "git-missing"
    _fixture(missing)
    leftover = missing / "sandbox" / ".coc" / "campaigns" / "case-1" / "save" / "commit-snapshots" / "fin-1"
    leftover.mkdir(parents=True)
    (leftover / "world-state.json").write_text("{}", encoding="utf-8")
    missing_report = module.export_battle_report(missing)
    assert missing_report["completeness"]["dimensions"]["state"]["status"] == "NOT_PROVEN"
    assert missing_report["state_integrity"]["status"] == "NOT_PROVEN"
    assert "missing_sidecar_repo" in missing_report["state_integrity"]["reason_codes"]
    assert missing_report["public_rolls"]["finalization_binding"]["git_history_status"] == "NOT_PROVEN"
    assert "commit_snapshot_id" not in json.dumps(missing_report)
    assert "latest_commit_snapshot_present" not in json.dumps(missing_report)
    player_missing = (missing / "artifacts" / JSON_OUTPUT).read_text(encoding="utf-8")
    assert ".git" not in player_missing
    assert "commit-snapshots" not in player_missing

    healthy = tmp_path / "git-pass"
    _fixture(healthy)
    _prove_git_state(healthy)
    leftover_ok = healthy / "sandbox" / ".coc" / "campaigns" / "case-1" / "save" / "commit-snapshots" / "fin-1"
    leftover_ok.mkdir(parents=True)
    (leftover_ok / "world-state.json").write_text("{}", encoding="utf-8")
    pass_report = module.export_battle_report(healthy)
    assert pass_report["completeness"]["dimensions"]["state"]["status"] == "PASS"
    assert pass_report["state_integrity"]["status"] == "PASS"
    assert pass_report["state_integrity"]["reason_codes"] == []
    audit = json.loads(
        (healthy / "artifacts" / "audit" / "report-validation.json").read_text(encoding="utf-8")
    )
    git_history = audit["finalization_binding"]["git_history"]
    assert git_history["status"] == "PASS"
    assert git_history["head"]["finalization_id"] == "fin-1"
    assert "commit_snapshot_id" not in audit["finalization_binding"]
    player_pass = (healthy / "artifacts" / JSON_OUTPUT).read_text(encoding="utf-8")
    assert "fin-1" not in player_pass
    assert ".git" not in player_pass

    drifted = tmp_path / "git-fail"
    _fixture(drifted)
    _prove_git_state(drifted)
    world_path = drifted / "sandbox" / ".coc" / "campaigns" / "case-1" / "save" / "world-state.json"
    world = json.loads(world_path.read_text(encoding="utf-8"))
    world["post_finalization_mutation"] = True
    _write_json(world_path, world)
    fail_report = module.export_battle_report(drifted)
    assert fail_report["completeness"]["dimensions"]["state"]["status"] == "FAIL"
    assert fail_report["state_integrity"]["status"] == "FAIL"
    assert "hash_drift" in fail_report["state_integrity"]["reason_codes"]
    assert fail_report["public_rolls"]["status"] == "PASS"


def _hp_effect():
    return {
        "schema_version": 1,
        "category": "state_delta",
        "effect_id": "effect:hp-1:HP",
        "effect_kind": "scalar",
        "resource": "HP",
        "investigator_id": "hero",
        "before": 10,
        "delta": -2,
        "after": 8,
        "source_decision_id": "hp-1",
    }


def _hp_call(tool, *, replay=False, ok=True):
    row = {
        "ok": ok,
        "tool": tool,
        "args": {"decision_id": "hp-1", "investigator": "hero"},
        "data": {
            "investigator_id": "hero",
            "player_state_receipt": {
                "schema_version": 1,
                "investigator_id": "hero",
                "hp": {"before": 10, "after": 8},
            },
        },
    }
    if replay:
        row["idempotent_replay"] = True
    return row


def test_exporter_and_finalizer_share_valid_and_invalid_state_proof():
    module = _load()
    scripts = Path("plugins/coc-keeper/scripts")
    if str(scripts.resolve()) not in sys.path:
        sys.path.insert(0, str(scripts.resolve()))
    import coc_turn_finalization

    effect = _hp_effect()
    valid = [_hp_call("combat.resolve")]
    invalid = [_hp_call("rules.roll")]
    replay_only = [_hp_call("combat.resolve", replay=True)]
    original_and_replay = [
        _hp_call("combat.resolve"),
        _hp_call("combat.resolve", replay=True),
    ]
    assert coc_turn_finalization._state_delta_proof_violations(valid, [effect]) == []
    assert module._state_effect_authority().state_delta_proof_reason(
        effect, valid, registry=module._toolbox_registry(),
    ) is None
    assert module._state_diff_rows(valid, [{
        "finalization_id": "fin-hp",
        "bundle": {"state_delta": [effect], "asset_delta": []},
    }])[0]["source_tool"] == "combat.resolve"

    assert coc_turn_finalization._state_delta_proof_violations(invalid, [effect])
    assert module._state_effect_authority().state_delta_proof_reason(
        effect, invalid, registry=module._toolbox_registry(),
    ) == "mismatch"
    assert module._state_diff_rows(invalid, [{
        "finalization_id": "fin-hp",
        "bundle": {"state_delta": [effect], "asset_delta": []},
    }]) == []

    assert "(replay)" in coc_turn_finalization._state_delta_proof_violations(
        replay_only, [effect],
    )[0]["message"]
    assert module._state_effect_authority().state_delta_proof_reason(
        effect, replay_only, registry=module._toolbox_registry(),
    ) == "replay"
    assert coc_turn_finalization._state_delta_proof_violations(
        original_and_replay, [effect],
    ) == []
    assert module._state_effect_authority().state_delta_proof_reason(
        effect, original_and_replay, registry=module._toolbox_registry(),
    ) is None
