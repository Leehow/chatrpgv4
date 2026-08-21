"""KP/player integration for runtime finance: context, discovery, labels."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

from runtime.sdk import web_views

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"
PLAY = REPO / "plugins" / "coc-keeper" / "skills" / "coc-keeper-play"
RULESET_SKILLS = REPO / "plugins" / "coc-keeper" / "rulesets" / "coc7" / "skills"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_finance = _load("coc_finance_integration", SCRIPTS / "coc_finance.py")
coc_toolbox = _load("coc_toolbox_integration", SCRIPTS / "coc_toolbox.py")
coc_starter = _load("coc_starter_integration", SCRIPTS / "coc_starter.py")
coc_language = _load("coc_language_integration", SCRIPTS / "coc_language.py")
coc_character_card = _load("coc_character_card_integration", SCRIPTS / "coc_character_card.py")
coc_turn_finalization = _load(
    "coc_turn_finalization_integration", SCRIPTS / "coc_turn_finalization.py"
)

_FINANCE_LABELS = {
    "zh-Hans": {
        "current_cash": "当前现金",
        "current_assets": "当前资产",
        "creation_cash": "建卡现金",
        "creation_assets": "建卡资产",
        "spending_level": "每日免记账额度",
        "living": "普通",
        "forbidden": ("現在の", "作成時", "日次無記帳"),
    },
    "ja-JP": {
        "current_cash": "現在の現金",
        "current_assets": "現在の資産",
        "creation_cash": "作成時の現金",
        "creation_assets": "作成時の資産",
        "spending_level": "日次無記帳限度",
        "living": "平均",
        "forbidden": ("当前", "建卡", "每日免记账", "Current cash", "Creation cash"),
    },
    "en-US": {
        "current_cash": "Current cash",
        "current_assets": "Current Assets",
        "creation_cash": "Creation cash",
        "creation_assets": "Creation Assets",
        "spending_level": "Daily unbooked allowance",
        "living": "Average",
        "forbidden": ("当前", "建卡", "每日免记账", "現在の", "作成時", "日次"),
    },
}


def _write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


@pytest.fixture
def campaign_ws(tmp_path: Path):
    workspace = tmp_path / "workspace"
    coc_root = workspace / ".coc"
    campaign_id = "finance-integration-test"
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
        title="Finance Integration Test",
    )
    ws = {
        "workspace": workspace,
        "campaign_id": campaign_id,
        "campaign_dir": Path(quick["campaign_dir"]),
        "investigator_id": quick["investigator_id"],
    }
    _seed_runtime_finance(ws)
    return ws


def _run(ws, tool: str, args: dict | None = None) -> dict:
    payload = dict(args or {})
    if tool in {"state.cash_grant", "state.cash_spend"} and "localized_reason" not in payload:
        payload["localized_reason"] = str(payload.get("reason") or "table")
    return coc_toolbox.run_tool(tool, ws["workspace"], ws["campaign_id"], payload)


def _inv_path(ws) -> Path:
    return (
        ws["campaign_dir"]
        / "save"
        / "investigator-state"
        / f"{ws['investigator_id']}.json"
    )


def _sheet_path(ws) -> Path:
    return (
        ws["workspace"]
        / ".coc"
        / "investigators"
        / ws["investigator_id"]
        / "character.json"
    )


def _game_time():
    return {
        "elapsed_minutes": 0,
        "display": "",
        "location_id": None,
        "day_phase": "unknown",
        "player_time": {
            "phase": "unknown",
            "appearance_mode": "normal",
            "display_label": None,
            "source_ref": None,
        },
    }


def _seed_runtime_finance(ws, *, spending="10.00", assets="500.00", cash="70.00"):
    finance = coc_finance.seed_finance_from_chargen(
        sheet={
            "era": "1920s",
            "living_standard": "Average",
            "spending_level": {"amount": spending, "currency": "USD"},
            "assets": {"amount": assets, "currency": "USD"},
        },
        decision_id="chargen-commit-runtime",
        recorded_at="2020-01-01T00:00:00+00:00",
        game_time=_game_time(),
        period="1920s",
    )
    path = _inv_path(ws)
    state = json.loads(path.read_text(encoding="utf-8"))
    state["finance"] = finance
    path.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    granted = _run(ws, "state.cash_grant", {
        "investigator": ws["investigator_id"],
        "amount": cash,
        "currency": "USD",
        "source": "seed",
        "reason": "integration seed",
        "localized_reason": "建卡现金",
        "decision_id": "cash-seed-integration",
    })
    assert granted["ok"] is True, granted


def _party_finance(payload: dict) -> dict:
    briefs = payload["party_investigators"]
    assert len(briefs) == 1
    finance = briefs[0].get("finance")
    assert isinstance(finance, dict)
    return finance


def test_scene_context_projects_runtime_finance_not_receipts(campaign_ws):
    context = _run(campaign_ws, "scene.context")
    assert context["ok"] is True, context
    finance = _party_finance(context["data"])
    assert finance["living_standard"] == "Average"
    assert finance["period"] == "1920s"
    assert finance["currency"] == "USD"
    assert finance["spending_period"] == "day"
    assert finance["spending_level"]["amount"] == "10.00"
    assert finance["spending_level"]["currency"] == "USD"
    assert finance["cash_balances"]["USD"]["amount"] == "70.00"
    assert finance["assets_balances"]["USD"]["amount"] == "500.00"
    assert "state.purchase" in finance["advisory"]
    assert "payment_mode=spending_level" in finance["advisory"]
    dumped = json.dumps(finance)
    for leaked in ("receipts", "recorded_at", "integrity_digest", "fingerprint"):
        assert leaked not in dumped
    assert "reason" not in finance
    assert "seed" not in finance
    assert "ledger" not in finance


def test_scene_context_omits_finance_when_unseeded(tmp_path: Path):
    workspace = tmp_path / "workspace"
    coc_root = workspace / ".coc"
    campaign_id = "finance-unseeded"
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
        title="Unseeded Finance",
    )
    ws = {
        "workspace": workspace,
        "campaign_id": campaign_id,
        "investigator_id": quick["investigator_id"],
    }
    sheet = json.loads(_sheet_path(ws).read_text(encoding="utf-8"))
    sheet["living_standard"] = "Super Rich"
    sheet["spending_level"] = {"amount": 5000, "currency": "USD"}
    sheet["assets"] = {"amount": 999999, "currency": "USD"}
    _write_json(_sheet_path(ws), sheet)
    context = _run(ws, "scene.context")
    assert context["ok"] is True, context
    brief = context["data"]["party_investigators"][0]
    assert "finance" not in brief


def test_sheet_mutation_does_not_change_runtime_projection(campaign_ws):
    first = _run(campaign_ws, "scene.context")
    assert first["ok"] is True, first
    before = _party_finance(first["data"])
    sheet = json.loads(_sheet_path(campaign_ws).read_text(encoding="utf-8"))
    sheet["living_standard"] = "Super Rich"
    sheet["spending_level"] = {"amount": 5000, "currency": "USD"}
    sheet["assets"] = {"amount": 999999, "currency": "USD"}
    sheet["cash"] = {"amount": 1, "currency": "USD"}
    _write_json(_sheet_path(campaign_ws), sheet)
    second = _run(campaign_ws, "scene.context")
    assert second["ok"] is True, second
    after = _party_finance(second["data"])
    assert after["living_standard"] == before["living_standard"] == "Average"
    assert after["spending_level"] == before["spending_level"]
    assert after["cash_balances"] == before["cash_balances"]
    assert after["assets_balances"] == before["assets_balances"]


def test_session_resume_carries_scene_finance_projection(campaign_ws):
    context = _run(campaign_ws, "scene.context")
    resumed = _run(campaign_ws, "session.resume")
    assert context["ok"] is True, context
    assert resumed["ok"] is True, resumed
    scene = resumed["data"].get("scene_context")
    assert isinstance(scene, dict)
    live = _party_finance(context["data"])
    recovered = _party_finance(scene)
    assert recovered == live
    assert recovered["spending_level"]["amount"] == "10.00"


def test_runtime_player_surface_uses_current_finance_not_sheet(campaign_ws):
    sheet = json.loads(_sheet_path(campaign_ws).read_text(encoding="utf-8"))
    sheet["living_standard"] = "Super Rich"
    sheet["spending_level"] = {"amount": 5000, "currency": "USD"}
    sheet["assets"] = {"amount": 999999, "currency": "USD"}
    _write_json(_sheet_path(campaign_ws), sheet)
    view = web_views.display_character(
        campaign_ws["workspace"],
        campaign_ws["investigator_id"],
        "zh-Hans",
        campaign_id=campaign_ws["campaign_id"],
    )
    assert view is not None
    assets = view["assets"]
    assert assets["current"] is True
    assert assets["baseline"] is False
    assert assets["display"] == "$500"
    assert assets["spending_level"] == "$10"
    assert assets["living_standard"] == "普通"
    assert assets["labels"]["spending_level"] == "每日免记账额度"
    assert assets["labels"]["assets"] == "当前资产"
    assert view["cash"]["balances"]["USD"]["amount"] == "70.00"
    assert view["cash"]["labels"]["current_cash"] == "当前现金"
    dumped = json.dumps(assets)
    assert "999999" not in dumped
    assert "receipts" not in dumped
    assert "recorded_at" not in dumped


def test_baseline_card_labels_are_creation_finance(tmp_path: Path):
    card_script = _load("coc_character_card_integration", SCRIPTS / "coc_character_card.py")
    character_path = tmp_path / "character.json"
    campaign_path = tmp_path / "campaign.json"
    campaign_path.write_text(json.dumps({"title": "The Haunting"}), encoding="utf-8")
    character_path.write_text(
        json.dumps(
            {
                "id": "ada",
                "name": "Ada",
                "skills": {"Credit Rating": 33},
                "characteristics": {
                    "STR": 40, "CON": 50, "SIZ": 50, "DEX": 50,
                    "APP": 60, "INT": 80, "POW": 60, "EDU": 71,
                },
                "derived": {"Luck": 80},
                "cash": {"amount": 70, "currency": "USD"},
                "assets": {"amount": 1750, "currency": "USD"},
                "spending_level": {"amount": 10, "currency": "USD"},
                "living_standard": "Average",
                "player_facing_sheet_zh": {
                    "display_name": "艾达",
                    "occupation": "记者",
                    "skills": [],
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    result = card_script.render_cards(
        character_path,
        campaign_path,
        tmp_path / "cards",
        repo_root=tmp_path,
        language="zh-Hans",
        html_mode="never",
    )
    markdown = (tmp_path / result["markdown_path"]).read_text(encoding="utf-8")
    assert "## 建卡财力" in markdown
    assert "建卡现金 $70" in markdown
    assert "建卡资产 $1,750" in markdown
    assert "每日免记账额度 $10" in markdown
    assert "消费水平" not in markdown


def test_finance_operations_are_play_discoverable_not_setup():
    live = set(coc_toolbox.query_operations(audience="keeper", phase="live_turn"))
    for name in ("state.finance_query", "state.purchase", "state.assets_liquidate"):
        assert name in live
        policy = coc_toolbox.operation_policy(name)
        assert policy["audience"] == "keeper"
        assert policy["contract"] == "state"
        assert "live_turn" in policy["phases"]
        assert "cold_start" not in policy["phases"]
        assert "opening" not in policy["phases"]
    cold = set(coc_toolbox.query_operations(audience="keeper", phase="cold_start"))
    opening = set(coc_toolbox.query_operations(audience="keeper", phase="opening"))
    for name in ("state.purchase", "state.assets_liquidate", "state.finance_query"):
        assert name not in cold
        assert name not in opening
    described = coc_toolbox._describe("state.finance_query")
    assert "chargen sheet snapshot" in described["summary"]
    purchase = coc_toolbox._describe("state.purchase")
    assert "payment_mode" in purchase["params"]
    liquidate = coc_toolbox._describe("state.assets_liquidate")
    assert "linked_time_decision_id" in liquidate["params"]


def test_play_guidance_contract_anchors():
    tooling = (
        PLAY / "references" / "turn-tooling-and-typed-ops.md"
    ).read_text(encoding="utf-8")
    skill = (PLAY / "SKILL.md").read_text(encoding="utf-8")
    horror = (
        PLAY / "references" / "investigators-horror-npc.md"
    ).read_text(encoding="utf-8")
    rules = (RULESET_SKILLS / "coc-rules-engine" / "SKILL.md").read_text(encoding="utf-8")
    development = (RULESET_SKILLS / "coc-development" / "SKILL.md").read_text(
        encoding="utf-8"
    )
    assert "state.purchase" in skill
    assert "state.finance_query" in skill
    assert "state.assets_liquidate" in skill
    assert "payment_mode=spending_level" in tooling
    assert "payment_mode=cash" in tooling
    assert "payment_mode=aggregate_cash" in tooling
    assert "full combined amount" in tooling
    assert "state.assets_liquidate" in tooling
    assert "Credit Rating" in tooling
    assert "not a tool order or narrative gate" in tooling
    assert "never develops" not in tooling
    assert "never earns ordinary" in tooling
    assert "improvement ticks" in tooling
    assert "Investigator Development Phase" in tooling
    assert "financial-development" in tooling
    assert "party_investigators[].finance" in horror
    assert "Credit Rating as social and financial leverage" in rules
    assert "Investigator Development Phase" in rules
    assert "never_tick_skills" in development
    assert "ordinary skill improvement ticks" in development
    assert "Investigator Development Phase" in development
    assert "never develops" not in development


@pytest.mark.parametrize("language", ("zh-Hans", "ja-JP", "en-US"))
def test_player_finance_labels_follow_play_language(campaign_ws, language):
    expected = _FINANCE_LABELS[language]
    view = web_views.display_character(
        campaign_ws["workspace"],
        campaign_ws["investigator_id"],
        language,
        campaign_id=campaign_ws["campaign_id"],
    )
    assert view is not None
    assets = view["assets"]
    cash = view["cash"]
    assert assets["current"] is True
    assert assets["labels"]["assets"] == expected["current_assets"]
    assert assets["labels"]["spending_level"] == expected["spending_level"]
    assert assets["living_standard"] == expected["living"]
    assert cash["labels"]["current_cash"] == expected["current_cash"]
    chrome_blob = json.dumps(
        {"asset_labels": assets["labels"], "cash_labels": cash["labels"],
         "living": assets["living_standard"], "spend": assets["spending_level"]},
        ensure_ascii=False,
    )
    for fragment in expected["forbidden"]:
        assert fragment not in chrome_blob
    baseline = web_views.display_character(
        campaign_ws["workspace"],
        campaign_ws["investigator_id"],
        language,
    )
    assert baseline is not None
    if baseline.get("assets"):
        labels = baseline["assets"]["labels"]
        assert labels["assets"] == expected["creation_assets"]
        assert labels["spending_level"] == expected["spending_level"]
        for fragment in expected["forbidden"]:
            assert fragment not in json.dumps(baseline["assets"], ensure_ascii=False)

    sample = {
        "skills": {"Credit Rating": 33},
        "cash": {"amount": 70, "currency": "USD"},
        "assets": {"amount": 1750, "currency": "USD"},
        "spending_level": {"amount": 10, "currency": "USD"},
        "living_standard": "Average",
    }
    rows = {label: value for label, value in coc_character_card._finance_rows(sample, language)}
    assert expected["creation_cash"] in rows
    assert expected["creation_assets"] in rows
    assert expected["spending_level"] in rows
    assert rows[expected["creation_cash"]] == "$70"
    assert rows[coc_language.table_mechanics_labels(language)["creation_living_standard"]] == expected["living"]
    row_text = json.dumps(rows, ensure_ascii=False)
    for fragment in expected["forbidden"]:
        assert fragment not in row_text

    cash_line = coc_turn_finalization._render_state_delta(
        {
            "effect_kind": "cash",
            "action": "grant",
            "amount": "20.00",
            "currency": "USD",
            "balance_before": "0.00",
            "balance_after": "20.00",
            "localized_reason": "retainer",
        },
        play_language=language,
    )
    purchase_line = coc_turn_finalization._render_state_delta(
        {
            "effect_kind": "purchase",
            "payment_mode": "spending_level",
            "label": "paper",
            "amount": "10.00",
            "charged_amount": "0.00",
            "currency": "USD",
            "cash_balance_before": "70.00",
            "cash_balance_after": "70.00",
            "localized_reason": "paper",
        },
        play_language=language,
    )
    assert expected["spending_level"] in purchase_line
    assert coc_language.table_mechanics_labels(language)["cash_kind"] in cash_line
    for fragment in expected["forbidden"]:
        assert fragment not in cash_line
        assert fragment not in purchase_line


def test_purchase_and_liquidation_do_not_change_credit_rating(campaign_ws):
    inv = campaign_ws["investigator_id"]
    sheet_path = _sheet_path(campaign_ws)
    before = json.loads(sheet_path.read_text(encoding="utf-8"))
    credit = before["skills"]["Credit Rating"]
    bought = _run(campaign_ws, "state.purchase", {
        "investigator": inv,
        "kind": "gear",
        "label": "报纸",
        "item_id": "newspaper",
        "amount": 4,
        "currency": "USD",
        "source": "shop",
        "reason": "buy paper",
        "localized_reason": "买一份报纸",
        "decision_id": "buy-paper-cr",
        "payment_mode": "spending_level",
    })
    assert bought["ok"] is True, bought
    after_buy = json.loads(sheet_path.read_text(encoding="utf-8"))
    assert after_buy["skills"]["Credit Rating"] == credit
    time_ok = _run(campaign_ws, "state.advance_time", {
        "minutes": 60,
        "reason": "wait for funds",
        "decision_id": "time-for-liq",
    })
    assert time_ok["ok"] is True, time_ok
    sold = _run(campaign_ws, "state.assets_liquidate", {
        "investigator": inv,
        "amount": 10,
        "currency": "USD",
        "linked_time_decision_id": "time-for-liq",
        "source": "sale",
        "reason": "raise cash",
        "localized_reason": "变现",
        "decision_id": "liq-cr",
    })
    assert sold["ok"] is True, sold
    after_liq = json.loads(sheet_path.read_text(encoding="utf-8"))
    assert after_liq["skills"]["Credit Rating"] == credit
