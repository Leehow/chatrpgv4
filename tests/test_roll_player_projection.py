#!/usr/bin/env python3
"""Adversarial player-projection contracts for public rolls."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

from test_coc_export_battle_report import (
    MARKDOWN_OUTPUT,
    _bind_rolls,
    _fixture,
    _load as _load_export,
    _write_json,
    _write_jsonl,
)

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"


def _load(name: str, rel: str):
    spec = importlib.util.spec_from_file_location(name, REPO / rel)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_roll = _load("coc_roll_projection", "plugins/coc-keeper/scripts/coc_roll.py")
coc_turn = _load(
    "coc_turn_projection", "plugins/coc-keeper/scripts/coc_turn_finalization.py"
)
coc_narration = _load(
    "coc_narration_projection", "plugins/coc-keeper/scripts/coc_narration_contract.py"
)


def _pc_check(*, roll=20, target=50, outcome="hard", passed=True):
    return {
        "roll": roll,
        "base_target": target,
        "target": target,
        "required_level": "regular",
        "required_target": target,
        "effective_target": target,
        "achieved_level": outcome,
        "passed": passed,
        "surplus_levels": 1 if passed else 0,
        "outcome": outcome,
        "difficulty": "regular",
    }


def test_opposed_npc_projection_hides_secret_targets_but_keeps_die_level_winner():
    npc = {
        **_pc_check(roll=37, target=90, outcome="hard"),
        "opposed_side": "opponent",
        "subject": {"kind": "opponent"},
        "contest_winner": "investigator",
        "skill": "a will that is not his own",
        "kind": "opposed_check",
    }
    npc["player_projection"] = coc_roll.build_player_projection(npc, include_target=False)
    assert npc["base_target"] == 90
    assert "base_target" not in npc["player_projection"]
    assert npc["player_projection"]["roll"] == 37
    assert npc["player_projection"]["achieved_level"] == "hard"
    assert npc["player_projection"]["contest_winner"] == "investigator"

    line = coc_turn._render_public_roll(npc, play_language="zh-Hans")
    assert "37" in line
    assert "困难" in line or "hard" in line.lower()
    assert "调查员胜" in line
    assert "90" not in line
    assert "基础值" not in line

    block = coc_narration.build_rules_owned_public_roll_block(
        [{**npc, "roll_id": "opp-1", "visibility": "public"}],
        decision_id="opp-render",
    )
    assert "90" not in block["text"]
    assert block["entries"][0]["roll"] == 37
    assert "target" not in block["entries"][0]


def test_no_projection_does_not_fall_back_to_hidden_npc_raw_target():
    raw = {
        **_pc_check(roll=12, target=99, outcome="extreme"),
        "opposed_side": "opponent",
        "subject": {"kind": "npc", "id": "corbitt"},
        "contest_winner": "opponent",
        "skill": "an unseen resistance",
        "kind": "opposed_check",
        "visibility": "public",
        "roll_id": "opp-raw",
    }
    line = coc_turn._render_public_roll(raw, play_language="en-US")
    assert "12" in line
    assert "99" not in line
    assert "base:" not in line
    assert "opponent wins" in line

    block = coc_narration.build_rules_owned_public_roll_block(
        [raw], decision_id="raw-opp"
    )
    assert "99" not in block["text"]
    assert "target" not in block["entries"][0]


def test_pc_projection_still_shows_own_target():
    pc = {
        **_pc_check(roll=20, target=50, outcome="hard"),
        "opposed_side": "investigator",
        "subject": {"kind": "investigator", "id": "hero"},
        "contest_winner": "investigator",
        "skill": "POW",
        "kind": "opposed_check",
    }
    pc["player_projection"] = coc_roll.build_player_projection(pc, include_target=True)
    line = coc_turn._render_public_roll(pc, play_language="zh-Hans")
    assert "20" in line
    assert "50" in line
    assert "基础值：50" in line
    assert "调查员胜" in line


def test_first_contact_still_publishes_app_and_credit_rating():
    line = coc_turn._render_public_roll(
        {
            "kind": "npc_first_impression",
            "skill": "First Impression",
            "npc_display_name": "Steven Knott",
            "app": 60,
            "credit_rating": 40,
            "governing_attribute": "app",
            "governing_value": 60,
            **_pc_check(roll=20, target=60, outcome="hard"),
        },
        play_language="zh-Hans",
    )
    assert "60" in line
    assert "40" in line
    assert "外貌" in line
    assert "信用评级" in line


def test_bout_and_luck_labels_localize_in_finalizer():
    bout = {
        "skill": "Bout Duration",
        "kind": "bout_duration_hours",
        "die_expression": "1D10",
        "individual_faces": [6],
        "final_total": 6,
        "roll": 6,
        "outcome": "rolled",
        "visibility": "consequence_public",
    }
    zh = coc_turn._render_public_roll(bout, play_language="zh-Hans")
    assert "疯狂发作时长" in zh
    assert "Bout Duration" not in zh
    en = coc_turn._render_public_roll(bout, play_language="en-US")
    assert "Bout Duration" in en
    ja = coc_turn._render_public_roll(bout, play_language="ja-JP")
    assert "狂気発作の持続" in ja

    luck = {
        **_pc_check(roll=20, target=50, outcome="hard"),
        "skill": "Luck",
        "kind": "skill_check",
    }
    luck_zh = coc_turn._render_public_roll(luck, play_language="zh-Hans")
    assert "幸运" in luck_zh
    assert "Luck" not in luck_zh


def test_export_hides_npc_target_and_localizes_bout_but_audit_keeps_numbers(tmp_path):
    module = _load_export()
    run = tmp_path / "proj-run"
    _fixture(run)
    campaign = run / "sandbox" / ".coc" / "campaigns" / "case-1"
    _write_json(
        campaign / "campaign.json",
        {
            "campaign_id": "case-1",
            "play_language": "zh-Hans",
            "localized_terms": {"zh-Hans": {"Bout of Madness": "自定义发作"}},
        },
    )
    npc_projection = coc_roll.build_player_projection(
        {
            **_pc_check(roll=18, target=90, outcome="regular"),
            "opposed_side": "opponent",
            "subject": {"kind": "opponent"},
            "contest_winner": "investigator",
        },
        include_target=False,
    )
    rolls = [
        {
            "roll_id": "public-1",
            "actor": "ada",
            "visibility": "public",
            "kind": "opposed_check",
            "opposed_side": "investigator",
            "subject": {"kind": "investigator", "id": "ada"},
            "payload": {
                "roll_id": "public-1",
                "skill": "POW",
                "roll": 22,
                "base_target": 50,
                "effective_target": 50,
                "target": 50,
                "outcome": "regular",
                "achieved_level": "regular",
                "opposed_side": "investigator",
                "subject": {"kind": "investigator", "id": "ada"},
                "player_projection": {
                    "visibility": "public",
                    "roll": 22,
                    "base_target": 50,
                    "effective_target": 50,
                    "target": 50,
                    "outcome": "regular",
                    "achieved_level": "regular",
                    "contest_winner": "investigator",
                    "opposed_side": "investigator",
                },
            },
        },
        {
            "roll_id": "npc-pow",
            "actor": "a will that is not his own",
            "visibility": "public",
            "kind": "opposed_check",
            "opposed_side": "opponent",
            "subject": {"kind": "opponent"},
            "payload": {
                "roll_id": "npc-pow",
                "skill": "a will that is not his own",
                "roll": 18,
                "base_target": 90,
                "effective_target": 90,
                "target": 90,
                "outcome": "regular",
                "achieved_level": "regular",
                "opposed_side": "opponent",
                "subject": {"kind": "opponent"},
                "contest_winner": "investigator",
                "player_projection": npc_projection,
            },
        },
        {
            "roll_id": "npc-con-raw",
            "actor": "unseen mass",
            "visibility": "public",
            "kind": "opposed_check",
            "opposed_side": "opponent",
            "subject": {"kind": "npc"},
            "payload": {
                "roll_id": "npc-con-raw",
                "skill": "unseen mass",
                "roll": 71,
                "base_target": 99,
                "effective_target": 99,
                "target": 99,
                "outcome": "failure",
                "achieved_level": "failure",
                "opposed_side": "opponent",
                "subject": {"kind": "npc"},
                "contest_winner": "investigator",
            },
        },
        {
            "roll_id": "bout-1",
            "actor": "ada",
            "visibility": "consequence_public",
            "kind": "bout_of_madness_table",
            "payload": {
                "roll_id": "bout-1",
                "skill": "Bout of Madness",
                "die_expression": "1D10",
                "roll": 4,
                "outcome": "rolled",
            },
        },
    ]
    _write_jsonl(campaign / "logs" / "rolls.jsonl", rolls)
    _bind_rolls(run, "fin-proj", ["public-1", "npc-pow", "npc-con-raw", "bout-1"])
    report = module.export_battle_report(run)
    assert report["public_rolls"]["status"] == "PASS"
    assert report["public_rolls"]["required_count"] == 4
    markdown = (run / "artifacts" / MARKDOWN_OUTPUT).read_text(encoding="utf-8")
    public = markdown.split("## 公开规则与骰点", 1)[1].split("## 完整性与来源", 1)[0]
    assert public.count("### Check ") == 4
    assert "90" not in public
    assert "99" not in public
    assert "- 骰点: 18" in public
    assert "- 骰点: 22" in public
    assert "- 目标值: 50" in public
    assert "- 对抗: 调查员胜" in public
    assert public.count("- 对抗:") == 3
    assert "自定义发作" in public
    assert "Bout of Madness" not in public
    audit_rolls = (run / "artifacts" / "audit" / "rolls.jsonl").read_text(encoding="utf-8")
    assert '"base_target": 90' in audit_rolls
    assert '"base_target": 99' in audit_rolls
    player_records = report["public_rolls"]["records"]

    def _payload_roll(row: dict) -> object:
        payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
        return payload.get("roll", row.get("roll"))

    npc = next(row for row in player_records if _payload_roll(row) == 18)
    raw_npc = next(row for row in player_records if _payload_roll(row) == 71)
    assert "90" not in json.dumps(npc, ensure_ascii=False)
    assert "99" not in json.dumps(raw_npc, ensure_ascii=False)


def test_narration_renders_contest_winner_once_and_hides_npc_target():
    npc = {
        **_pc_check(roll=37, target=90, outcome="hard"),
        "roll_id": "opp-win",
        "visibility": "public",
        "opposed_side": "opponent",
        "subject": {"kind": "opponent"},
        "contest_winner": "investigator",
        "skill": "a will that is not his own",
        "kind": "opposed_check",
    }
    npc["player_projection"] = coc_roll.build_player_projection(npc, include_target=False)
    block = coc_narration.build_rules_owned_public_roll_block(
        [npc], decision_id="contest-render", play_language="zh-Hans",
    )
    assert block["text"].count("对抗：调查员胜") == 1
    assert block["entries"][0]["contest_winner"] == "investigator"
    assert "90" not in block["text"]
    assert "target" not in block["entries"][0]


def test_combat_npc_kind_hides_target_pc_shows_target():
    npc = {
        **_pc_check(roll=44, target=70, outcome="regular"),
        "actor_id": "ghoul",
        "subject": {"kind": "monster", "id": "ghoul"},
        "skill": "Fighting",
        "kind": "combat_check",
        "visibility": "public",
        "marker": "[roll]ghoul Fighting70:(d100->44)->regular[/roll]",
    }
    npc["player_projection"] = coc_roll.build_player_projection(npc)
    assert npc["player_projection"]["roll"] == 44
    assert "target" not in npc["player_projection"]
    assert "marker" not in npc["player_projection"]
    line = coc_turn._render_public_roll(npc, play_language="zh-Hans")
    assert "44" in line
    assert "70" not in line
    assert "[roll]" not in line

    pc = {
        **_pc_check(roll=12, target=55, outcome="hard"),
        "actor_id": "hero",
        "subject": {"kind": "investigator", "id": "hero"},
        "skill": "Dodge",
        "kind": "combat_check",
        "visibility": "public",
    }
    pc["player_projection"] = coc_roll.build_player_projection(pc)
    pc_line = coc_turn._render_public_roll(pc, play_language="zh-Hans")
    assert "12" in pc_line
    assert "55" in pc_line


def test_player_view_strips_marker_but_audit_raw_keeps_it():
    raw = {
        "skill": "Bout Duration",
        "kind": "bout_duration_hours",
        "die_expression": "1D10",
        "individual_faces": [6],
        "final_total": 6,
        "roll": 6,
        "outcome": "rolled",
        "subject": {"kind": "investigator", "id": "ada"},
        "marker": "[die]Bout Duration 1D10:(roll->6)->hours[/die]",
        "visibility": "consequence_public",
    }
    raw["player_projection"] = coc_roll.build_player_projection(raw)
    view = coc_roll.player_facing_roll_view(raw)
    assert "marker" not in view
    assert "marker" not in raw["player_projection"]
    assert raw["marker"].startswith("[die]Bout Duration")
    rendered = coc_turn._render_public_roll(raw, play_language="zh-Hans")
    assert "Bout Duration" not in rendered
    assert "[die]" not in rendered
    view["skill"] = "mutated"
    assert raw["skill"] == "Bout Duration"


def test_campaign_override_matches_validation_and_final_render(tmp_path):
    campaign_dir = tmp_path / "camp"
    campaign_dir.mkdir()
    (campaign_dir / "campaign.json").write_text(
        json.dumps({
            "campaign_id": "case-1",
            "play_language": "zh-Hans",
            "localized_terms": {"zh-Hans": {"Bout Duration": "自定义时长"}},
        }, ensure_ascii=False),
        encoding="utf-8",
    )
    raw = {
        "roll_id": "bout-override",
        "skill": "Bout Duration",
        "kind": "bout_duration_hours",
        "die_expression": "1D10",
        "individual_faces": [3],
        "final_total": 3,
        "roll": 3,
        "outcome": "rolled",
        "visibility": "consequence_public",
    }
    bundle = {"public_check": [raw], "state_delta": [], "exceptional_effect": []}
    validate = coc_turn._campaign_mechanic_source_lines(
        campaign_dir, bundle, play_language="zh-Hans",
    )
    compose = coc_turn._campaign_mechanic_source_lines(
        campaign_dir, bundle, play_language="zh-Hans",
    )
    assert validate == compose
    line = validate["public_check"]["bout-override"]
    assert "自定义时长" in line
    assert "Bout Duration" not in line
    block = coc_narration.build_rules_owned_public_roll_block(
        [{
            **raw,
            "roll_role": "amount",
            "rolled_total": 3,
            "dice": {"expression": "1D10", "raw": [3], "total": 3},
        }],
        decision_id="override-narration",
        play_language="zh-Hans",
        campaign_dir=campaign_dir,
    )
    assert "自定义时长" in block["text"]
    assert "Bout Duration" not in block["text"]


def test_replay_matches_uses_campaign_override_like_first_compose(tmp_path):
    campaign_dir = tmp_path / "override-camp"
    campaign_dir.mkdir()
    (campaign_dir / "campaign.json").write_text(
        json.dumps({
            "campaign_id": "override-camp",
            "play_language": "zh-Hans",
            "localized_terms": {"zh-Hans": {"Bout Duration": "自定义时长"}},
        }, ensure_ascii=False),
        encoding="utf-8",
    )
    draft = "调查员撑住桌子，等这阵发作过去。"
    bundle = {
        "public_check": [{
            "roll_id": "bout-replay",
            "skill": "Bout Duration",
            "kind": "bout_duration_hours",
            "die_expression": "1D10",
            "individual_faces": [3],
            "final_total": 3,
            "roll": 3,
            "outcome": "rolled",
            "visibility": "consequence_public",
        }],
        "state_delta": [],
        "exceptional_effect": [],
    }
    placements = [{
        "after_paragraph": 0,
        "segment_type": "public_check",
        "source_ids": ["bout-replay"],
    }]
    segments, rendered, _ = coc_turn.compose_segments(
        draft, bundle, placements, coverage=[],
        play_language="zh-Hans", campaign_dir=campaign_dir,
    )
    assert "自定义时长" in rendered
    assert "Bout Duration" not in rendered
    receipt = {
        "accepted_revision": 1,
        "accepted_draft_sha256": coc_turn.canonical_digest(
            "\n\n".join(
                segment["text"]
                for segment in segments
                if segment["segment_type"] == "fiction"
            )
        ),
        "coverage_sha256": coc_turn.canonical_digest([]),
        "rendered_text_sha256": coc_turn.canonical_digest(rendered),
        "narration_review": None,
        "agency_claims": [],
        "bundle": bundle,
        "rendered_text": rendered,
        "segments": segments,
    }
    assert coc_turn.replay_matches(
        receipt,
        draft=draft,
        coverage=[],
        mechanics_placements=placements,
        revision=1,
        narration_review=None,
        agency_claims=[],
        campaign_dir=campaign_dir,
    )
    assert not coc_turn.replay_matches(
        receipt,
        draft=draft,
        coverage=[],
        mechanics_placements=placements,
        revision=1,
        narration_review=None,
        agency_claims=[],
    )

    default_dir = tmp_path / "default-camp"
    default_dir.mkdir()
    (default_dir / "campaign.json").write_text(
        json.dumps({
            "campaign_id": "default-camp",
            "play_language": "zh-Hans",
        }, ensure_ascii=False),
        encoding="utf-8",
    )
    default_segments, default_rendered, _ = coc_turn.compose_segments(
        draft, bundle, placements, coverage=[],
        play_language="zh-Hans", campaign_dir=default_dir,
    )
    assert "自定义时长" not in default_rendered
    default_receipt = {
        "accepted_revision": 1,
        "accepted_draft_sha256": coc_turn.canonical_digest(
            "\n\n".join(
                segment["text"]
                for segment in default_segments
                if segment["segment_type"] == "fiction"
            )
        ),
        "coverage_sha256": coc_turn.canonical_digest([]),
        "rendered_text_sha256": coc_turn.canonical_digest(default_rendered),
        "narration_review": None,
        "agency_claims": [],
        "bundle": bundle,
        "rendered_text": default_rendered,
        "segments": default_segments,
    }
    assert coc_turn.replay_matches(
        default_receipt,
        draft=draft,
        coverage=[],
        mechanics_placements=placements,
        revision=1,
        narration_review=None,
        agency_claims=[],
        campaign_dir=default_dir,
    )
    assert coc_turn.replay_matches(
        default_receipt,
        draft=draft,
        coverage=[],
        mechanics_placements=placements,
        revision=1,
        narration_review=None,
        agency_claims=[],
    )


def test_exporter_empty_run_metadata_uses_campaign_safe_fields(tmp_path):
    module = _load_export()
    run = tmp_path / "meta-run"
    _fixture(run)
    campaign = run / "sandbox" / ".coc" / "campaigns" / "case-1"
    _write_json(run / "run.json", {"note": "not-an-allowed-field"})
    _write_json(
        campaign / "campaign.json",
        {
            "campaign_id": "case-1",
            "play_language": "zh-Hans",
            "keeper_secret": "do-not-project",
            "status": "active",
        },
    )
    report = module.export_battle_report(run)
    metadata = report["run_metadata"]
    assert metadata["campaign_id"] == "case-1"
    assert metadata["play_language"] == "zh-Hans"
    assert metadata["status"] == "active"
    assert "keeper_secret" not in metadata
    assert "note" not in metadata
    identity = report.get("source_identity") or {}
    source = str(identity.get("metadata_source") or "")
    assert source.endswith("campaign.json") or metadata["campaign_id"] == "case-1"


def test_export_player_records_drop_english_marker_audit_keeps_it(tmp_path):
    module = _load_export()
    run = tmp_path / "marker-run"
    _fixture(run)
    campaign = run / "sandbox" / ".coc" / "campaigns" / "case-1"
    rolls = [
        {
            "roll_id": "bout-mark",
            "actor": "ada",
            "visibility": "consequence_public",
            "kind": "bout_duration_hours",
            "marker": "[die]Bout Duration 1D10:(roll->6)->hours[/die]",
            "payload": {
                "roll_id": "bout-mark",
                "skill": "Bout Duration",
                "die_expression": "1D10",
                "roll": 6,
                "outcome": "rolled",
                "marker": "[die]Bout Duration 1D10:(roll->6)->hours[/die]",
                "player_projection": {
                    "visibility": "consequence_public",
                    "roll": 6,
                    "outcome": "rolled",
                    "skill": "Bout Duration",
                    "kind": "bout_duration_hours",
                },
            },
        }
    ]
    _write_jsonl(campaign / "logs" / "rolls.jsonl", rolls)
    _bind_rolls(run, "fin-mark", ["bout-mark"])
    report = module.export_battle_report(run)
    player = report["public_rolls"]["records"][0]
    assert "marker" not in player
    assert "marker" not in (player.get("payload") or {})
    markdown = (run / "artifacts" / MARKDOWN_OUTPUT).read_text(encoding="utf-8")
    assert "[die]Bout Duration" not in markdown
    assert "疯狂发作时长" in markdown or "Bout Duration" in markdown
    if "## 公开规则与骰点" in markdown:
        public = markdown.split("## 公开规则与骰点", 1)[1]
        assert "[die]" not in public.split("## ", 1)[0]
    audit = (run / "artifacts" / "audit" / "rolls.jsonl").read_text(encoding="utf-8")
    assert "[die]Bout Duration" in audit


def test_first_contact_kind_not_skill_name_controls_public_app():
    named_only = {
        **_pc_check(roll=20, target=60, outcome="hard"),
        "skill": "First Impression",
        "app": 60,
        "credit_rating": 40,
        "governing_attribute": "app",
        "governing_value": 60,
    }
    assert coc_roll.is_first_contact_roll(named_only) is False
    projection = coc_roll.build_player_projection(named_only)
    assert "app" not in projection
    typed = {**named_only, "kind": "npc_first_impression"}
    assert coc_roll.is_first_contact_roll(typed) is True
    line = coc_turn._render_public_roll(typed, play_language="zh-Hans")
    assert "60" in line
    assert "40" in line
