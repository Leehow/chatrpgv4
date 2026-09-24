#!/usr/bin/env python3
"""tests/play/test_persona_bench.py -- the persona benchmark's own tests.

Spec: docs/specs/player-persona-benchmark.md section 11. Nothing here calls a model or
spends quota: the Keeper side is `fixtures/fake_pi_rpc.py` and the player side is
`fixtures/fake_persona_pi.py`, both of which speak the RPC protocol and nothing else.

What is actually guarded here is the part a benchmark can silently get wrong: the
isolation of the player, the projection it is shown, and the refusal to report a metric
nobody registered.

    PYTHONDONTWRITEBYTECODE=1 uv run --frozen python -m pytest tests/play -q -p no:cacheprovider
"""
from __future__ import annotations

import json
import shutil
import sys
import uuid
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "tests" / "play"))

import bench  # noqa: E402
import driver  # noqa: E402
import persona_metrics  # noqa: E402
import persona_report  # noqa: E402
import player as player_mod  # noqa: E402

FAKE_KEEPER = REPO_ROOT / "tests" / "play" / "fixtures" / "fake_pi_rpc.py"
FAKE_PERSONA = REPO_ROOT / "tests" / "play" / "fixtures" / "fake_persona_pi.py"


# -- personas and the registry ---------------------------------------------

def test_all_personas_load_and_only_name_registered_metrics():
    personas = player_mod.load_personas()
    assert len(personas) == 18, "the suite is twelve normal personas and six stress personas"
    assert {p["kind"] for p in personas.values()} == {"normal", "stress"}
    for persona in personas.values():
        for metric_id in persona["assertions"]:
            assert metric_id in persona_metrics.METRICS


def test_a_persona_naming_an_unregistered_metric_fails_to_load(tmp_path: Path):
    persona = json.loads(next((REPO_ROOT / "tests/play/personas").glob("P01*.json")).read_text())
    persona["assertions"] = ["vibes"]
    path = tmp_path / "P99_vibes.json"
    path.write_text(json.dumps(persona), encoding="utf-8")
    with pytest.raises(ValueError, match="unregistered metric"):
        player_mod.load_persona(path)


def test_personas_carry_no_cjk_because_every_field_is_model_visible():
    for path in (REPO_ROOT / "tests/play/personas").glob("*.json"):
        text = path.read_text(encoding="utf-8")
        assert not any("一" <= ch <= "鿿" or "぀" <= ch <= "ヿ" for ch in text), \
            f"{path.name} carries CJK; persona text is system language (contract section 16.1)"


def test_rate_means_one_thing_per_metric():
    assert persona_metrics.rate("hard_denial_rate", ok=9, violation=1) == 0.1
    assert persona_metrics.rate("world_consequence_rate", ok=9, violation=1) == 0.9
    assert persona_metrics.rate("hard_denial_rate", ok=0, violation=0) is None


# -- the projection the player is shown ------------------------------------

def test_player_view_hides_keeper_visibility_rolls():
    delivery = {"kind": "narrate", "rendered_text": "The door gives.", "mechanics": [
        {"kind": "roll", "skill": "Spot Hidden", "visibility": "keeper", "passed": False},
        {"kind": "roll", "skill": "Locksmith", "visibility": "public", "passed": True},
        {"kind": "time", "minutes": 5},
    ]}
    view = player_mod.player_view(delivery, "", "settled")
    assert "Locksmith" in view and "Spot Hidden" not in view
    assert "The door gives." in view


def test_player_view_names_a_concealed_check_and_shows_no_figure():
    # Contract section 16.5's middle tier. The persona player must learn that its own declared
    # Psychology read was rolled -- otherwise the turn reads as the Keeper simply talking -- and
    # must not learn the die, which is the one thing the concealed roll withholds from the table.
    delivery = {"kind": "narrate", "rendered_text": "He looks at the window.", "mechanics": [
        {"kind": "roll", "skill": "Psychology", "visibility": "concealed", "receipt": "roll:psychology-t5-c1",
         "roll": 2, "target": 70, "threshold": 70, "difficulty": "regular", "level": "extreme", "passed": True,
         "pushed": False, "actor_is_investigator": True},
    ]}
    view = player_mod.player_view(delivery, "", "settled")
    assert "He looks at the window." in view
    shown = json.loads(view.rsplit("\n", 1)[-1])
    assert shown == {"kind": "roll", "skill": "Psychology", "visibility": "concealed",
                     "receipt": "roll:psychology-t5-c1", "actor_is_investigator": True}
    for figure in player_mod.CONCEALED_FIGURES:
        assert figure not in shown, figure


def test_player_view_falls_back_to_prose_and_names_a_dead_turn():
    assert player_mod.player_view(None, "words", "settled") == "words"
    assert "nothing this turn" in player_mod.player_view(None, "", "timeout")


def test_parse_reply_takes_the_object_and_refuses_the_rest():
    parsed, error = player_mod.parse_reply('```json\n{"player_message": "I knock.", '
                                           '"private_eval": {"confusion": 1}}\n```')
    assert error is None and parsed["player_message"] == "I knock."
    assert parsed["private_eval"] == {"confusion": 1}
    assert player_mod.parse_reply("no json here")[0] is None
    assert player_mod.parse_reply('{"private_eval": {}}')[0] is None
    assert player_mod.parse_reply('{"player_message": "   "}')[0] is None


# -- the isolation invariants ----------------------------------------------

def test_persona_player_runs_outside_the_repo_with_no_tools(tmp_path: Path):
    persona = player_mod.load_personas()["P01"]
    record = tmp_path / "argv.json"
    player = player_mod.PersonaPlayer(persona, tmp_path / "run", launcher=FAKE_PERSONA,
                                      credentials_from=tmp_path / "no-credentials")
    import os
    os.environ["FAKE_PERSONA_RECORD"] = str(record)
    try:
        player.start()
        act = player.act("The office is quiet.", timeout=20.0)
    finally:
        os.environ.pop("FAKE_PERSONA_RECORD", None)
        player.stop()

    seen = json.loads(record.read_text(encoding="utf-8"))
    for flag in player_mod.ISOLATION_FLAGS:
        assert flag in seen["argv"], f"the persona player ran without {flag}"
    assert not Path(seen["cwd"]).is_relative_to(REPO_ROOT), "the player could read the repo"
    assert seen["pi_home"] and not Path(seen["pi_home"]).is_relative_to(REPO_ROOT)
    assert seen["home_files"] == ["settings.json"], "an isolated home holds no packages"
    assert act["ok"] and act["player_message"] == "persona turn 1"
    assert act["private_eval"]["engagement"] == 8


def test_an_unreadable_persona_reply_is_retried_once_then_reported(tmp_path: Path):
    import os
    persona = player_mod.load_personas()["S04"]
    os.environ["FAKE_PERSONA_GARBAGE"] = "5"
    player = player_mod.PersonaPlayer(persona, tmp_path / "run", launcher=FAKE_PERSONA,
                                      credentials_from=tmp_path / "none")
    try:
        player.start()
        act = player.act("Anything?", timeout=20.0)
    finally:
        os.environ.pop("FAKE_PERSONA_GARBAGE", None)
        player.stop()
    assert act["ok"] is False and act["attempts"] == 2 and act["player_message"] is None


# -- the run loop ----------------------------------------------------------

@pytest.fixture
def fixture_campaign():
    """A campaign directory with just enough evidence for the loop and the report."""
    campaign_id = f"fixture-persona-{uuid.uuid4().hex[:8]}"
    path = bench.campaign_dir(campaign_id)
    (path / "turns").mkdir(parents=True)
    (path / "party").mkdir(parents=True)
    driver.write_json(path / "campaign.json", {"id": campaign_id, "module_id": "the-haunting",
                                                "status": "active", "play_language": "zh-Hans"})
    driver.write_json(path / "party" / "thomas-hayes.json",
                      {"id": "thomas-hayes", "current_hp": 11, "conditions": [],
                       "skills": {"Spot Hidden": 55}})
    (path / "transcript.jsonl").write_text(
        json.dumps({"turn": 0, "role": "keeper", "text": "The office is quiet."}) + "\n",
        encoding="utf-8")
    driver.write_json(path / "turns" / "0001.json", {"turn": 1, "receipts": [
        {"kind": "clue", "clue": "the-letter"}, {"kind": "roll", "skill": "Spot Hidden", "passed": True},
        {"kind": "delta", "resource": "hp", "before": 11, "after": 9},
    ]})
    (path / "telemetry.jsonl").write_text("\n".join(json.dumps(row) for row in [
        {"turn": 1, "tool": "look", "ok": True}, {"turn": 1, "tool": "narrate", "ok": True},
        {"turn": 1, "lane": "admission", "verb": "resolve", "verdict": "authorized", "ms": 900},
        {"turn": 1, "lane": "director", "adopted": True},
    ]) + "\n", encoding="utf-8")
    yield campaign_id
    shutil.rmtree(path, ignore_errors=True)


def test_one_run_plays_the_real_driver_and_keeps_both_sides_of_every_turn(fixture_campaign, monkeypatch):
    """The whole loop: persona -> driver daemon -> pi -> delivery -> persona, with fakes at both ends."""
    monkeypatch.setattr(bench, "kernel_call", lambda method, params: {"ok": True, "result": {}})
    monkeypatch.setattr(player_mod.PersonaPlayer, "_launcher_default", FAKE_PERSONA, raising=False)
    suite = {**bench.DEFAULTS, "suite": "fixture", "personas": ["P01"], "max_turns": 3,
             "turn_timeout": 30.0, "opening_timeout": 30.0, "launcher": str(FAKE_KEEPER),
             "player_model": "deepseek/deepseek-v4-pro"}
    run = {"persona": "P01", "lane": "controlled", "trial": 1,
           "campaign": fixture_campaign, "run_id": f"{fixture_campaign}-run"}
    persona = player_mod.load_personas()["P01"]

    real_init = player_mod.PersonaPlayer.__init__

    def isolated_init(self, persona, run_dir, **kwargs):
        kwargs.update(launcher=FAKE_PERSONA, credentials_from=run_dir / "no-credentials")
        real_init(self, persona, run_dir, **kwargs)

    monkeypatch.setattr(player_mod.PersonaPlayer, "__init__", isolated_init)
    monkeypatch.setattr(bench, "PersonaPlayer", player_mod.PersonaPlayer)

    suite_dir = REPO_ROOT / ".coc" / "benchmarks" / f"fixture-{uuid.uuid4().hex[:8]}"
    try:
        record = bench.execute_run(run, suite, persona, suite_dir)
        assert record["status"] == "completed", record.get("error")
        assert record["method"] == "persona-benchmark" and record["acceptance"] is False
        assert record["turns_played"] == 3 and record["stop_reason"] == "max_turns"

        rows = persona_report.read_jsonl(suite_dir / run["run_id"] / "trace.jsonl")
        played = [r for r in rows if r.get("phase") == "play"]
        assert [r["player_message"] for r in played] == [f"persona turn {n}" for n in (1, 2, 3)]
        assert all(r["private_eval"]["engagement"] == 8 for r in played), \
            "the sidecar must survive to the trace"
        assert all(r["keeper_text"] for r in played)
        assert rows[0]["phase"] == "opening" and "office" in rows[0]["text"]
    finally:
        shutil.rmtree(suite_dir, ignore_errors=True)
        shutil.rmtree(driver.run_dir(run["run_id"]), ignore_errors=True)


def test_a_run_whose_player_is_not_isolated_is_refused(tmp_path: Path, monkeypatch):
    persona = player_mod.load_personas()["P01"]
    player = player_mod.PersonaPlayer(persona, tmp_path / "run", launcher=FAKE_PERSONA,
                                      credentials_from=tmp_path / "none")
    player.isolation = {"argv_flags": ["--no-tools"], "cwd": str(REPO_ROOT)}
    with pytest.raises(bench.RunFailed, match="not isolated"):
        bench._assert_isolation(player)


# -- the report ------------------------------------------------------------

def test_receipts_tier_reads_the_receipts_not_their_projection(fixture_campaign):
    metrics = persona_report.receipts_metrics(bench.campaign_dir(fixture_campaign))
    assert metrics["turns_played"] == 1
    assert metrics["clues_found"] == 1 and metrics["clues_in_module"] == 39
    assert metrics["rules_layer_turns"] == 1
    # `delta` is the receipt; `change` is only the name its projection carries (section 16.2).
    assert metrics["combat_receipts"] == 1
    assert metrics["investigator_alive"] is True
    assert metrics["admission_verdicts"] == {"authorized": 1}


def test_the_judge_may_not_invent_metrics_turns_or_uncited_findings():
    judgement = {"findings": [
        {"metric": "hard_denial_rate", "turn": 2, "verdict": "violation", "quote": "You cannot."},
        {"metric": "hard_denial_rate", "turn": 3, "verdict": "ok", "quote": "The door holds."},
        {"metric": "hard_denial_rate", "turn": 2, "verdict": "violation", "quote": ""},
        {"metric": "vibes", "turn": 2, "verdict": "violation", "quote": "bad vibes"},
        {"metric": "secret_leak", "turn": 99, "verdict": "violation", "quote": "off the record"},
        {"metric": "premature_truth_reveal", "turn": 2, "verdict": "violation", "quote": "not asked for"},
    ]}
    folded = persona_report.fold_judgement(judgement, turns_seen={2, 3},
                                           allowed=["hard_denial_rate", "secret_leak"])
    assert folded["hard_denial_rate"] == {
        "ok": 1, "violation": 1, "rate": 0.5, "direction": "lower_is_better",
        "violations_while_review_unavailable": 0,
        "citations": [{"turn": 2, "verdict": "violation", "quote": "You cannot.", "why": ""},
                      {"turn": 3, "verdict": "ok", "quote": "The door holds.", "why": ""}]}
    assert "vibes" not in folded and "secret_leak" not in folded
    assert folded["_dropped_findings"] == 4


def test_sidecar_is_labelled_self_report():
    rows = [{"phase": "play", "turn": n, "private_eval": {"perceived_agency": n, "confusion": 1,
                                                          "engagement": 5, "frustration": 0,
                                                          "current_hypothesis": f"h{n // 2}"}}
            for n in range(1, 6)]
    metrics = persona_report.sidecar_metrics(rows)
    assert metrics["self_report"] is True
    assert metrics["perceived_agency"] == 3 and metrics["hypothesis_changes"] == 2


# -- the matrix ------------------------------------------------------------

def test_the_full_matrix_is_the_one_the_spec_names():
    suite = bench.load_suite(REPO_ROOT / "tests/play/suites/full.json")
    runs = bench.plan_runs(suite, player_mod.load_personas(), "20260911T000000Z")
    assert len(runs) == 108
    assert len({r["campaign"] for r in runs}) == 108, "concurrent runs must not share a campaign"
    assert len({r["run_id"] for r in runs}) == 108


def test_the_bench_never_steals_the_default_run_pointer(fixture_campaign, monkeypatch, tmp_path):
    """A human playing a real table in this checkout keeps their own `--run` default."""
    # The pointer is one file per checkout, and under xdist test_driver.py's `start` writes it concurrently: this test's
    # own pointer, which `driver.main` (in process) reads and writes through the module global.
    monkeypatch.setattr(driver, "CURRENT_RUN_FILE", tmp_path / ".current-run")
    before = driver.read_json(driver.CURRENT_RUN_FILE, {"run_id": "a-human-table"})
    driver.write_json(driver.CURRENT_RUN_FILE, before)
    suite = {**bench.DEFAULTS, "suite": "fixture", "kp_model": "xai/grok-4.6",
             "launcher": str(FAKE_KEEPER), "admission_model": None}
    run_id = f"{fixture_campaign}-pointer"
    try:
        bench.start_table(fixture_campaign, run_id, suite, launcher=str(FAKE_KEEPER))
        assert driver.read_json(driver.CURRENT_RUN_FILE, {}) == before
    finally:
        bench.stop_table(run_id)
        shutil.rmtree(driver.run_dir(run_id), ignore_errors=True)


class _ScriptedPlayer:
    """Stands in for the persona agent: records what it was shown, answers in order."""

    def __init__(self, answers: list[str]):
        self.answers, self.views = list(answers), []

    def act(self, view: str, **_: object) -> dict:
        self.views.append(view)
        if not self.answers:
            return {"ok": False, "error": "out of answers", "player_message": None, "private_eval": {}}
        return {"ok": True, "player_message": self.answers.pop(0), "private_eval": {}}


def test_the_creation_lane_opens_by_the_player_speaking_first(tmp_path, monkeypatch):
    """There is no opening delivery to wait for during creation: the campaign does not exist yet."""
    asked = []

    def status(campaign: str) -> str:
        asked.append(campaign)
        return "setting_up" if len(asked) < 5 else "ready_for_table"

    monkeypatch.setattr(bench, "start_table", lambda campaign, run_id, *a, **k: run_id)
    monkeypatch.setattr(bench, "stop_table", lambda *a, **k: None)
    monkeypatch.setattr(bench, "campaign_status", status)
    monkeypatch.setattr(bench, "send_turn", lambda run_id, text, timeout: {
        "settle_class": "settled", "final_text": f"keeper heard {text}", "delivery": None})

    player = _ScriptedPlayer(["a folklore professor", "yes", "done"])
    result = bench.run_setup_lane({"campaign": "c", "run_id": "r"},
                                  {**bench.DEFAULTS, "setup_max_turns": 5, "turn_timeout": 1.0,
                                   "opening_timeout": 1.0},
                                  player, tmp_path / "trace.jsonl")
    assert result["setup_steps"] == 2 and result["setup_ended_by_process_exit"] is False
    assert player.views[0] == bench.SETUP_FIRST_VIEW
    assert player.views[1].startswith("keeper heard a folklore professor")


def test_a_creation_lane_that_never_finishes_the_card_is_a_failed_run(tmp_path, monkeypatch):
    monkeypatch.setattr(bench, "start_table", lambda campaign, run_id, *a, **k: run_id)
    monkeypatch.setattr(bench, "stop_table", lambda *a, **k: None)
    monkeypatch.setattr(bench, "campaign_status", lambda campaign: "setting_up")
    monkeypatch.setattr(bench, "send_turn", lambda run_id, text, timeout: {
        "settle_class": "settled", "final_text": "still asking", "delivery": None})
    player = _ScriptedPlayer(["a", "b"])
    with pytest.raises(bench.RunFailed, match="ready_for_table"):
        bench.run_setup_lane({"campaign": "c", "run_id": "r"},
                             {**bench.DEFAULTS, "setup_max_turns": 2, "turn_timeout": 1.0},
                             player, tmp_path / "trace.jsonl")


def test_a_throttled_provider_does_not_kill_the_table(tmp_path, monkeypatch):
    """A session error is not a bad answer: it waits and asks again, and the run survives."""
    persona = player_mod.load_personas()["P01"]
    player = player_mod.PersonaPlayer(persona, tmp_path / "run", launcher=FAKE_PERSONA,
                                      credentials_from=tmp_path / "none")
    replies = iter([("", True), ("", True),
                    ('{"player_message": "I knock.", "private_eval": {"confusion": 0}}', False)])
    waited: list[float] = []
    monkeypatch.setattr(player_mod.time, "sleep", lambda s: waited.append(s))
    monkeypatch.setattr(player_mod.PersonaPlayer, "_prompt",
                        lambda self, message, timeout: next(replies))

    act = player.act("The office is quiet.")
    assert act["ok"] and act["player_message"] == "I knock."
    assert act["transient_retries"] == 2, "two provider errors, two waits, no verdict on the model"
    assert waited == [10.0, 30.0], "the wait grows; it does not retry inside a millisecond"


def test_an_unreadable_answer_is_still_only_retried_once(tmp_path, monkeypatch):
    persona = player_mod.load_personas()["P01"]
    player = player_mod.PersonaPlayer(persona, tmp_path / "run", launcher=FAKE_PERSONA,
                                      credentials_from=tmp_path / "none")
    monkeypatch.setattr(player_mod.time, "sleep", lambda s: None)
    monkeypatch.setattr(player_mod.PersonaPlayer, "_prompt",
                        lambda self, message, timeout: ("I would rather not answer in JSON.", False))
    act = player.act("The office is quiet.")
    assert act["ok"] is False and act["attempts"] == 2 and act["transient_retries"] == 0


def test_a_finished_card_ends_the_creation_lane_even_if_the_process_is_already_gone(tmp_path, monkeypatch):
    """The setup launcher exits the moment the card is done; a turn in flight then finds nobody."""
    seen = {"n": 0}

    def status(campaign: str) -> str:
        seen["n"] += 1
        return "setting_up" if seen["n"] <= 1 else "ready_for_table"

    def send(run_id, text, timeout):
        raise driver.DaemonUnavailable("daemon closed the connection without responding")

    monkeypatch.setattr(bench, "start_table", lambda campaign, run_id, *a, **k: run_id)
    monkeypatch.setattr(bench, "stop_table", lambda *a, **k: None)
    monkeypatch.setattr(bench, "campaign_status", status)
    monkeypatch.setattr(bench, "send_turn", send)
    player = _ScriptedPlayer(["a folklore professor"])
    result = bench.run_setup_lane({"campaign": "c", "run_id": "r"},
                                  {**bench.DEFAULTS, "setup_max_turns": 5, "turn_timeout": 1.0},
                                  player, tmp_path / "trace.jsonl")
    assert result["setup_steps"] == 0 and result["setup_ended_by_process_exit"] is True


def test_a_dead_setup_process_without_a_card_is_still_a_failure(tmp_path, monkeypatch):
    monkeypatch.setattr(bench, "start_table", lambda campaign, run_id, *a, **k: run_id)
    monkeypatch.setattr(bench, "stop_table", lambda *a, **k: None)
    monkeypatch.setattr(bench, "campaign_status", lambda campaign: "setting_up")
    monkeypatch.setattr(bench, "send_turn", lambda *a, **k: (_ for _ in ()).throw(
        driver.DaemonUnavailable("gone")))
    player = _ScriptedPlayer(["a folklore professor"])
    with pytest.raises(driver.DaemonUnavailable):
        bench.run_setup_lane({"campaign": "c", "run_id": "r"},
                             {**bench.DEFAULTS, "setup_max_turns": 5, "turn_timeout": 1.0},
                             player, tmp_path / "trace.jsonl")


def test_a_run_that_never_got_a_card_is_a_result_not_a_broken_instrument():
    """The creation lane can follow a questioning player until the budget runs out. That is the
    product's answer to that player, and it must not be filed with the harness's own failures."""
    assert persona_report.classify({
        "status": "invalid",
        "error": "RunFailed: setup lane ended with campaign status 'setting_up', not ready_for_table",
    }) == "no_card"
    assert persona_report.classify({
        "status": "invalid", "error": "instrument-invalid: stopped to fix the creation lane",
    }) == "instrument_invalid"
    assert persona_report.classify({"status": "completed"}) == "completed"
    assert persona_report.classify({"status": "invalid", "error": "DaemonUnavailable: gone"}) == "invalid"


def test_unjudged_gates_print_as_unmeasured_not_as_clean(tmp_path, capsys):
    """`0` and `not looked at` must not render the same. The first reader will believe the zero."""
    suite_dir = tmp_path / "suite"
    suite_dir.mkdir()
    (suite_dir / "suite-report.json").write_text(json.dumps({"suite_dir": str(suite_dir), "by_persona": {
        "P01_detective/controlled": [{"trial": 1, "status": "completed", "hard_gates": {"secret_leak": 0},
                                      "receipts": {"turns_played": 30, "clue_reachability": 0.36},
                                      "judged": {}, "self_report": {}}]}}), encoding="utf-8")
    persona_report.main(["table", "--suite-dir", str(suite_dir)])
    out = capsys.readouterr().out
    assert "-" in out.splitlines()[4], "an unjudged suite must not print a zero gate count"
    assert "not the same as clean" in out


def test_a_violation_on_a_turn_whose_review_timed_out_is_marked(tmp_path):
    """An unanswered action review makes the Keeper tell the player it cannot settle, which reads
    as a refusal. The turn number says so; no phrase list is consulted."""
    folded = persona_report.fold_judgement(
        {"findings": [
            {"metric": "hard_denial_rate", "turn": 5, "verdict": "violation", "quote": "cannot settle"},
            {"metric": "hard_denial_rate", "turn": 6, "verdict": "violation", "quote": "you cannot"},
        ]},
        turns_seen={5, 6}, allowed=["hard_denial_rate"], admission_failed={5})
    bucket = folded["hard_denial_rate"]
    assert bucket["violation"] == 2 and bucket["violations_while_review_unavailable"] == 1
    assert bucket["citations"][0]["review_unavailable_this_turn"] is True
    assert "review_unavailable_this_turn" not in bucket["citations"][1]


def test_admission_failures_are_read_by_turn_number_from_telemetry(tmp_path):
    campaign = tmp_path / "c"
    campaign.mkdir()
    (campaign / "telemetry.jsonl").write_text("\n".join(json.dumps(r) for r in [
        {"turn": 1, "lane": "admission", "ok": True, "verdict": "authorized"},
        {"turn": 5, "lane": "admission", "ok": False, "reason": "timeout"},
        {"turn": 7, "lane": "director", "ok": False},
    ]) + "\n", encoding="utf-8")
    assert persona_report.admission_failed_turns(campaign) == {5}


def test_findings_can_be_refolded_without_paying_the_judge_again(tmp_path, monkeypatch):
    """Judging costs a call per run; folding costs nothing. Reuse must not call the model."""
    called = []
    monkeypatch.setattr(persona_report, "run_judge",
                        lambda *a, **k: called.append(a) or {"findings": []})
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    (run_dir / "judgement.jsonl").write_text(
        json.dumps({"metric": "hard_denial_rate", "turn": 2, "verdict": "ok", "quote": "q"}) + "\n",
        encoding="utf-8")
    reused = persona_report.read_existing_judgement(run_dir)
    assert reused["reused"] is True and len(reused["findings"]) == 1 and not called


def test_a_secret_leak_on_a_turn_that_minted_no_clue_says_so():
    folded = persona_report.fold_judgement(
        {"findings": [
            {"metric": "secret_leak", "turn": 2, "verdict": "violation", "quote": "the wards"},
            {"metric": "secret_leak", "turn": 3, "verdict": "violation", "quote": "the sorcerer"},
        ]},
        turns_seen={2, 3}, allowed=["secret_leak"], admission_failed=set(), clue_turns={3})
    citations = folded["secret_leak"]["citations"]
    assert citations[0]["no_clue_receipt_this_turn"] is True
    assert "no_clue_receipt_this_turn" not in citations[1]


def test_credentials_are_linked_not_copied_so_a_refresh_reaches_the_player(tmp_path):
    """A copy is a snapshot: an OAuth token the table refreshes stays stale in every copy."""
    live = tmp_path / "live"
    live.mkdir()
    (live / "auth.json").write_text('{"xai": {"access": "first"}}', encoding="utf-8")
    (live / "models.json").write_text('{"providers": {}}', encoding="utf-8")
    home = player_mod.seed_home(tmp_path / "home", live)
    assert (home / "auth.json").is_symlink()
    (live / "auth.json").write_text('{"xai": {"access": "refreshed"}}', encoding="utf-8")
    assert "refreshed" in (home / "auth.json").read_text(encoding="utf-8")


def test_out_of_credit_stops_the_suite_instead_of_looking_like_a_bad_player(tmp_path, monkeypatch):
    """One billing event used to become twenty-two runs that read like a broken product."""
    persona = player_mod.load_personas()["P01"]
    player = player_mod.PersonaPlayer(persona, tmp_path / "run", launcher=FAKE_PERSONA,
                                      credentials_from=tmp_path / "none")
    player._last_error_message = 'OpenAI API error (403): 403 "You have run out of credits"'
    monkeypatch.setattr(player_mod.PersonaPlayer, "_prompt", lambda self, m, t: ("", True))
    with pytest.raises(player_mod.ProviderExhausted):
        player.act("anything")


def test_a_run_queued_after_exhaustion_is_not_started(tmp_path):
    bench._exhausted.set()
    try:
        record = bench.execute_run({"campaign": "c", "run_id": "r", "lane": "controlled", "trial": 1,
                                    "persona": "P01"},
                                   {**bench.DEFAULTS, "suite": "s"},
                                   player_mod.load_personas()["P01"], tmp_path)
    finally:
        bench._exhausted.clear()
    assert record["status"] == "invalid" and "provider_exhausted" in record["error"]
    assert record["turns_played"] == 0
