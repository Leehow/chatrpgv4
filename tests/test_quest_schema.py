"""Quest v1 schema contract: put_entity packs + optional scenario quests.json IR.

Deterministic checks only: enums, id patterns, structured condition shapes,
secret/player-safe physical isolation, source-bound provenance evidence, and
the optional-eighth-file rule for `--validate` (absent = legal module without
quests; present = hard-validated).
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path

import pytest

# Deep quest packs ride the shared deepen lane and kick the background
# worker on put; keep schema tests free of real background writers.
os.environ["COC_DISABLE_QUEUE_WORKER"] = "1"

SCRIPTS = Path("plugins/coc-keeper/scripts")


def _load(name: str, rel: str):
    spec = importlib.util.spec_from_file_location(name, rel)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


assets = _load(
    "coc_module_assets_quest_schema", str(SCRIPTS / "coc_module_assets.py"),
)
compile_mod = _load(
    "coc_scenario_compile_quest_schema", str(SCRIPTS / "coc_scenario_compile.py"),
)

FAKE_SHA = "a" * 64


def _valid_quest(**overrides) -> dict:
    base = {
        "title": "押送麦克里奥家的遗物",
        "localized_title": {"zh-Hans": "押送麦克里奥家的遗物"},
        "quest_kinds": ["escort-deliver"],
        "importance": "core",
        "giver": {"kind": "npc", "ref_id": "npc-mr-knott"},
        "brief": "keeper 侧：周日正午前把箱子送到亚卡汉姆并当面交付。",
        "target_refs": [{"kind": "scene", "ref_id": "scene-delivery"}],
        "destination_scene_id": "scene-delivery",
        "deadline": {
            "kind": "game_time",
            "at": "1920-10-05T12:00",
            "display": "周日正午前",
        },
        "completion": {
            "all": [{"kind": "flag_set", "flag_id": "crate_delivered"}],
            "narrative": "KP 确认遗物当面完好交付。",
        },
        "failure": {
            "any": [{"kind": "clock_reaches", "clock_id": "cult-alert", "threshold": 6}],
        },
        "mainline_links": ["corbitt-linked-to-chapel"],
        "secret": False,
        "provenance": "source",
    }
    base.update(overrides)
    return base


def _init_root(tmp_path: Path, asset_root_id: str = "demo-mod") -> None:
    assets.init_module_root(
        tmp_path,
        asset_root_id=asset_root_id,
        identity={"canonical_module_id": asset_root_id},
        file_sha256=FAKE_SHA,
    )


def _write_host_bundle(tmp_path: Path) -> tuple[Path, str, str]:
    """One real host source bundle with a single accepted page (pdf_index 0)."""
    pdf = tmp_path / "bound-module.pdf"
    pdf.write_bytes(b"%PDF validated host fixture")
    bundle = tmp_path / "bound-source"
    bundle.mkdir()
    page_bytes = b"# Hospital\n\nDr Percival guards a source-bound secret.\n"
    (bundle / "page-0000.md").write_bytes(page_bytes)
    file_sha = hashlib.sha256(pdf.read_bytes()).hexdigest()
    (bundle / "manifest.json").write_text(json.dumps({
        "schema_version": 1,
        "producer": "codex-pdf-skill",
        "source": {
            "source_id": "pdf:bound-module",
            "title": "Bound Module",
            "path": str(pdf),
            "file_sha256": file_sha,
            "page_count": 1,
        },
        "pages": [{
            "pdf_index": 0,
            "markdown_path": "page-0000.md",
            "text_sha256": hashlib.sha256(page_bytes).hexdigest(),
            "review_state": "manual_accepted",
            "parse_confidence": 0.94,
            "grep_anchors": ["Dr Percival guards a source-bound secret."],
        }],
    }), encoding="utf-8")
    return bundle, file_sha, hashlib.sha256(page_bytes).hexdigest()


# --- put_entity: happy paths -------------------------------------------------


def test_put_entity_quest_roundtrip(tmp_path: Path):
    _init_root(tmp_path)
    stored = assets.put_entity(tmp_path, "demo-mod", "quest", "escort-macario", _valid_quest(
        parse_state="deep",
        evidence_gap=False,
    ))
    assert stored["kind"] == "quest"
    assert Path(stored["path"]).name == "quest-escort-macario.json"

    got = assets.get_entity(tmp_path, "demo-mod", "quest", "escort-macario")
    assert got is not None
    # Semantic id derivation: store key is the slug, quest_id is quest-<slug>.
    assert got["quest_id"] == "quest-escort-macario"
    assert got["schema_version"] == 1
    assert got["parse_state"] == "deep"
    assert got["updated_at"]
    # Deep quest packs ride the shared deepen lane: the merge kick enqueues
    # one deepen_quest job (fulfilled as entity_ready by the queue worker).
    assert stored["worker"]["enqueue"]["job"]["kind"] == "deepen_quest"
    # Revalidation replays the same contract on the durable pack.
    revalidated = assets.revalidate_entity_pack(
        tmp_path, "demo-mod", "quest", "escort-macario",
    )
    assert revalidated is not None and revalidated["quest_id"] == "quest-escort-macario"


def test_put_entity_quest_stub_tier_is_page_scope_only(tmp_path: Path):
    _init_root(tmp_path)
    stub = assets.ensure_stub(
        tmp_path, "demo-mod", "quest", "rumored-deal", title="Rumored Deal",
    )
    assert stub["created"] is True
    assert stub["entity"]["quest_id"] == "quest-rumored-deal"
    assert stub["entity"]["parse_state"] == "named_only"


# --- put_entity: hard rejections ---------------------------------------------


@pytest.mark.parametrize(
    "label, mutate",
    [
        ("bad quest_kinds enum", lambda q: q.update({"quest_kinds": ["fetch-quest"]})),
        ("empty quest_kinds", lambda q: q.update({"quest_kinds": []})),
        ("duplicate quest_kinds", lambda q: q.update({"quest_kinds": ["commission", "commission"]})),
        ("bad importance", lambda q: q.update({"importance": "side"})),
        ("bad provenance", lambda q: q.update({"provenance": "keeper"})),
        ("missing title", lambda q: q.pop("title")),
        ("missing brief", lambda q: q.pop("brief")),
        ("missing secret", lambda q: q.pop("secret")),
        ("secret with player summary", lambda q: q.update({
            "secret": True,
            "player_safe_summary": "玩家可见摘要",
        })),
        ("half clue cond", lambda q: q.update({
            "completion": {"all": [{"kind": "clue_discovered"}]},
        })),
        ("half clock cond", lambda q: q.update({
            "completion": {"any": [{"kind": "clock_reaches"}]},
        })),
        ("free-text cond kind", lambda q: q.update({
            "completion": {"all": [{"kind": "delivered_safely"}]},
        })),
        ("legacy string cond", lambda q: q.update({
            "completion": {"all": ["crate delivered"]},
        })),
        ("empty condition group", lambda q: q.update({"completion": {}})),
        ("missing completion", lambda q: q.pop("completion")),
        ("non-object completion", lambda q: q.update({"completion": "delivered"})),
        ("bad giver kind", lambda q: q.update({"giver": {"kind": "patron"}})),
        ("giver npc without ref", lambda q: q.update({
            "giver": {"kind": "npc", "ref_id": ""},
        })),
        ("bad target ref kind", lambda q: q.update({
            "target_refs": [{"kind": "faction", "ref_id": "f1"}],
        })),
        ("bad deadline kind", lambda q: q.update({
            "deadline": {"kind": "real_time", "hours": 6},
        })),
    ],
)
def test_put_entity_rejects_malformed_quests(tmp_path: Path, label: str, mutate):
    _init_root(tmp_path)
    payload = _valid_quest(parse_state="deep", evidence_gap=False)
    mutate(payload)
    with pytest.raises(assets.ModuleAssetsError) as excinfo:
        assets.put_entity(tmp_path, "demo-mod", "quest", "bad-quest", payload)
    # Every rejection names the quest and the offending field vocabulary.
    assert "quest bad-quest:" in str(excinfo.value)


def test_put_entity_rejects_non_semantic_quest_id(tmp_path: Path):
    _init_root(tmp_path)
    payload = _valid_quest(parse_state="deep", evidence_gap=False)
    # Uppercase slug derives quest-Escort… which violates the frozen pattern.
    with pytest.raises(assets.ModuleAssetsError, match=r"quest-\[a-z0-9-\]\+"):
        assets.put_entity(tmp_path, "demo-mod", "quest", "Escort_Macario", payload)


# --- put_entity: source-bound provenance evidence -----------------------------


def test_source_bound_quest_requires_and_canonicalizes_evidence(tmp_path: Path):
    bundle, _file_sha, page_sha = _write_host_bundle(tmp_path)
    root_id = assets.register_source_bundle(
        tmp_path, bundle, asset_root_id="bound-mod",
    )["asset_root_id"]
    quest = _valid_quest(
        parse_state="deep",
        evidence_gap=False,
        provenance="source",
    )

    # provenance=source deep pack without evidence fails closed.
    with pytest.raises(assets.ModuleAssetsError, match="requires source_refs"):
        assets.put_entity(tmp_path, root_id, "quest", "records-run", dict(quest))

    # Citing the accepted page canonicalizes the full trace, like other packs.
    cited = dict(quest)
    cited["source_refs"] = [{"pdf_index": 0}]
    assets.put_entity(tmp_path, root_id, "quest", "records-run", cited)
    got = assets.get_entity(tmp_path, root_id, "quest", "records-run")
    assert got["page_text_sha256"] == [page_sha]
    assert got["source_span"] == {"pdf_index_start": 0, "pdf_index_end": 0}
    assert got["source_evidence"]["pdf_indices"] == [0]


def test_campaign_improvised_quest_is_exempt_from_source_evidence(
    tmp_path: Path,
):
    bundle, _file_sha, _page_sha = _write_host_bundle(tmp_path)
    root_id = assets.register_source_bundle(
        tmp_path, bundle, asset_root_id="bound-mod",
    )["asset_root_id"]
    quest = _valid_quest(
        parse_state="deep",
        evidence_gap=False,
        provenance="campaign-improvised",
    )
    stored = assets.put_entity(tmp_path, root_id, "quest", "improv-run", quest)
    assert Path(stored["path"]).is_file()


# --- scenario IR: optional eighth file ----------------------------------------


def _make_valid_scenario(tmp_path: Path) -> Path:
    sc = tmp_path / "scenario"
    sc.mkdir()
    (sc / "module-meta.json").write_text(json.dumps({
        "schema_version": 1, "scenario_id": "m",
        "structure_type": "branching_investigation",
        "era": "1920s", "content_flags": [], "win_condition": "x",
    }))
    (sc / "story-graph.json").write_text(json.dumps({"scenes": [
        {"scene_id": "s1", "dramatic_question": "q", "entry_conditions": [],
         "exit_conditions": [], "available_clues": [], "npc_ids": [],
         "pressure_moves": [], "tone": [], "allowed_improvisation": []},
    ]}))
    (sc / "clue-graph.json").write_text(json.dumps({"conclusions": [
        {"conclusion_id": "c1", "importance": "critical", "minimum_routes": 3,
         "clues": [{"clue_id": "a", "delivery": "", "visibility": "player-safe"},
                   {"clue_id": "b", "delivery": "", "visibility": "player-safe"},
                   {"clue_id": "c", "delivery": "", "visibility": "player-safe"}],
         "fallback_policy": "RECOVER can surface a public alternate route"},
    ]}))
    (sc / "npc-agendas.json").write_text(json.dumps({"npcs": [
        {"npc_id": "n1", "agenda": "spy on investigators"},
    ]}))
    (sc / "threat-fronts.json").write_text(json.dumps({"fronts": [
        {"front_id": "f1", "scope": "scenario", "dangers": [],
         "clocks": [{"clock_id": "clock-storm", "segments": 4,
                     "on_tick_visible": [], "on_full": "storm hits"}]},
    ]}))
    (sc / "pacing-map.json").write_text(json.dumps({"pacing_curve": []}))
    (sc / "improvisation-boundaries.json").write_text(json.dumps(
        {"invent_allowed": [], "never_invent": [], "keeper_secrets": ["secret-1"]}))
    return sc


def _quest_ir_row(**overrides) -> dict:
    row = {
        "quest_id": "quest-deliver-ledger",
        "title": "送还账本",
        "quest_kinds": ["escort-deliver"],
        "importance": "core",
        "giver": {"kind": "npc", "ref_id": "n1"},
        "brief": "把账本送回县档案馆。",
        "target_refs": [
            {"kind": "scene", "ref_id": "s1"},
            {"kind": "clue", "ref_id": "a"},
        ],
        "destination_scene_id": "s1",
        "deadline": {"kind": "clock", "clock_id": "clock-storm"},
        "completion": {
            "all": [{"kind": "flag_set", "flag_id": "ledger_returned"}],
        },
        "mainline_links": ["c1"],
        "secret": False,
        "provenance": "source",
    }
    row.update(overrides)
    return row


def test_missing_quests_file_is_legal(tmp_path: Path):
    sc = _make_valid_scenario(tmp_path)
    assert not (sc / "quests.json").exists()
    assert compile_mod.validate_scenario(sc)["errors"] == []


def test_valid_quests_file_passes(tmp_path: Path):
    sc = _make_valid_scenario(tmp_path)
    (sc / "quests.json").write_text(json.dumps({
        "schema_version": 1,
        "quests": [
            _quest_ir_row(),
            _quest_ir_row(
                quest_id="quest-hidden-counterplan",
                quest_kinds=["prevent-disrupt"],
                importance="supporting",
                giver={"kind": "organization", "label": "Chapel remnant"},
                target_refs=[],
                destination_scene_id=None,
                deadline=None,
                mainline_links=[],
                secret=True,
                provenance="campaign-improvised",
                completion={"narrative": "教团行动被挫败。"},
            ),
        ],
    }))
    assert compile_mod.validate_scenario(sc)["errors"] == []


@pytest.mark.parametrize(
    "label, doc",
    [
        ("wrong schema_version", {"schema_version": 2, "quests": []}),
        ("quests not a list", {"schema_version": 1, "quests": {}}),
        (
            "duplicate quest_id",
            {"schema_version": 1, "quests": [_quest_ir_row(), _quest_ir_row()]},
        ),
        (
            "bad quest_kinds enum",
            {"schema_version": 1, "quests": [_quest_ir_row(quest_kinds=["fetch"])]},
        ),
        (
            "bad importance",
            {"schema_version": 1, "quests": [_quest_ir_row(importance="main")]},
        ),
        (
            "free-text cond kind",
            {"schema_version": 1, "quests": [_quest_ir_row(completion={
                "all": [{"kind": "arrive_safely"}],
            })]},
        ),
        (
            "half cond",
            {"schema_version": 1, "quests": [_quest_ir_row(completion={
                "all": [{"kind": "clue_discovered"}],
            })]},
        ),
        (
            "unresolved giver npc",
            {"schema_version": 1, "quests": [_quest_ir_row(
                giver={"kind": "npc", "ref_id": "npc-ghost"},
            )]},
        ),
        (
            "unresolved target scene",
            {"schema_version": 1, "quests": [_quest_ir_row(
                target_refs=[{"kind": "scene", "ref_id": "nope"}],
            )]},
        ),
        (
            "unresolved destination scene",
            {"schema_version": 1, "quests": [_quest_ir_row(
                destination_scene_id="nope",
            )]},
        ),
        (
            "unresolved deadline clock",
            {"schema_version": 1, "quests": [_quest_ir_row(
                deadline={"kind": "clock", "clock_id": "clock-missing"},
            )]},
        ),
        (
            "unresolved mainline link",
            {"schema_version": 1, "quests": [_quest_ir_row(
                mainline_links=["nonexistent-conclusion"],
            )]},
        ),
        (
            "secret quest with player summary",
            {"schema_version": 1, "quests": [_quest_ir_row(
                secret=True, player_safe_summary="玩家可见",
            )]},
        ),
        (
            "bad id pattern",
            {"schema_version": 1, "quests": [_quest_ir_row(quest_id="deliver-ledger")]},
        ),
    ],
)
def test_quests_file_hard_assertions(tmp_path: Path, label: str, doc: dict):
    sc = _make_valid_scenario(tmp_path)
    (sc / "quests.json").write_text(json.dumps(doc))
    errors = compile_mod.validate_scenario(sc)["errors"]
    assert errors, f"{label} was accepted"
    assert any("quest" in error.lower() for error in errors), errors
