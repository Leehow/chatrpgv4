"""Tests for tests/play/jev-steps-report.py (ticket 05 of docs/specs/jev-decides-llm-writes.md, D-C): the report
reads any number of homes -- a repo checkout, a PipiCOC App home, an App userData directory -- and prints the D6 2a
verdict of docs/specs/jev-driven-steps.md aggregated over every campaign found.

Synthetic telemetry in the shapes `runtime/jev/hybrid-engine.ts` writes (`pairConsequences`'s candidate rows, the
`consequence_budget` cost row, the `run_end` row) stands in for real tables, so the counting rules are pinned
without live playtest data. The App layout is `<userData>/pi-coc/.coc/campaigns/<cid>/`, read off
`Electron/apps/electron/src/main/runtime-assets.ts` (`join(userData, 'pi-coc')` is the packaged home) and
`pipicoc/product.json` (`userDataDirname: "Pipi/pipicoc"`).
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

SCRIPT = Path(__file__).with_name("jev-steps-report.py")
_spec = importlib.util.spec_from_file_location("jev_steps_report", SCRIPT)
report = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(report)

FIRST_IMPRESSION = "natural-npc:first-impression"


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n", encoding="utf-8")


def write_campaign(campaigns: Path, cid: str, rows: list[dict], turns: dict[int, dict] | None = None) -> Path:
    folder = campaigns / cid
    write_jsonl(folder / "telemetry.jsonl", rows)
    for turn, record in (turns or {}).items():
        target = folder / "turns" / f"{turn:04d}.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps({"turn": turn, "player_text": "", "receipts": [], **record}), encoding="utf-8")
    return folder


def candidate(cls: str, key: str, turn: int, *, cleared: bool, did, confidence: float | None = 0.8, **extra) -> dict:
    return {"lane": "route", "purpose": "consequence", "shadow": True, "run": f"run-{turn}", "class": cls,
            "key": f"consequence:{cls}:{key}", "cleared": cleared, "confidence": confidence,
            "distribution": None if confidence is None else {"true": confidence, "false": 1 - confidence},
            "keeper_did": did, "turn": turn, **extra}


def budget(turn: int, ms: float, run: str | None = None) -> dict:
    return {"lane": "run", "event": "consequence_budget", "turn": turn, "run": run or f"run-{turn}", "ms": ms, "rows": 1}


def run_end(turn: int, status: str) -> dict:
    return {"lane": "run", "type": "run_end", "turn": turn, "status": status}


def person_and_roll(who: str, name: str) -> dict:
    return {"receipts": [{"kind": "person", "who": who, "name": name},
                         {"kind": "roll", "decision": FIRST_IMPRESSION, "npc": who}]}


def table_a_rows() -> list[dict]:
    """A repo-checkout table: every counting rule in one campaign."""
    return [
        # npc_reaction: tp, fp ('other'), fn, tn; a duplicate of the tp row written earlier says false and must lose.
        candidate("npc_reaction", "kp:vittorio-macario", 1, cleared=True, did=False),
        candidate("npc_reaction", "kp:vittorio-macario", 1, cleared=True, did=True),
        candidate("npc_reaction", "kp:dr-smith", 2, cleared=True, did="other"),
        candidate("npc_reaction", "kp:anna", 3, cleared=False, did=True, confidence=0.3),
        candidate("npc_reaction", "kp:bob", 4, cleared=False, did=False, confidence=0.1),
        # clue_follow_up: this table executed the class (one executed row), so the whole class-table is left out.
        candidate("clue_follow_up", "ledger", 1, cleared=True, did=False, executed=True, shadow=False),
        candidate("clue_follow_up", "diary", 2, cleared=False, did=False, confidence=0.2),
        # time_cost: a direct row (never asked), an unanswered row (Jev outage), one true positive.
        candidate("time_cost", "library", 1, cleared=True, did=True, confidence=None, direct=True),
        candidate("time_cost", "archive", 2, cleared=False, did=True, confidence=None),
        candidate("time_cost", "morgue", 3, cleared=True, did=True, confidence=0.9),
        # a stranded turn: its rows are not paired.
        run_end(5, "failed"),
        candidate("npc_reaction", "kp:ghost", 5, cleared=True, did=False),
        # an `exists` row belongs to no verdict.
        {"lane": "route", "purpose": "consequence", "shadow": True, "class": "npc_reaction", "exists": True, "cleared": True,
         "confidence": 0.9, "turn": 1},
        # cost: three turns, the middle one written twice by the same run (SL-85 pre-fix) -> mean (1000+2000+1500)/3.
        budget(1, 1000), budget(2, 2000), budget(2, 2000), budget(3, 1500),
    ]


def table_b_rows() -> list[dict]:
    """An App-home table: a pre-SL-83 label key the pairing read wrong, plus clean rows and two false positives."""
    return [
        candidate("npc_reaction", "kp:Vittorio Macario", 1, cleared=True, did="other"),  # artifact: same entity as the roll
        candidate("npc_reaction", "kp:anna", 2, cleared=True, did=True),
        candidate("npc_reaction", "kp:bob", 3, cleared=True, did=True),
        candidate("clue_follow_up", "ledger", 1, cleared=True, did=True),
        candidate("clue_follow_up", "diary", 2, cleared=True, did=True),
        candidate("clue_follow_up", "map", 3, cleared=True, did=False),
        candidate("clue_follow_up", "key", 4, cleared=True, did="other"),
        candidate("time_cost", "docks", 1, cleared=True, did=True),
        candidate("time_cost", "church", 2, cleared=True, did=True),
        budget(1, 500), budget(2, 700),
    ]


@pytest.fixture()
def homes(tmp_path):
    """A repo checkout with two campaigns (one a setup session), and an App userData directory with one."""
    repo = tmp_path / "repo"
    write_campaign(repo / ".coc" / "campaigns", "tbl-a", table_a_rows(), turns={t: {} for t in range(1, 6)})
    write_campaign(repo / ".coc" / "campaigns", "setup-only", [{"lane": "run", "type": "run_end", "turn": 0, "status": "delivered"}])
    user_data = tmp_path / "Application Support" / "Pipi" / "pipicoc"
    write_campaign(user_data / "pi-coc" / ".coc" / "campaigns", "game-b", table_b_rows(),
                   turns={1: person_and_roll("vittorio-macario", "Vittorio Macario"), 2: {}, 3: {}, 4: {}})
    return {"repo": repo, "user_data": user_data, "app_home": user_data / "pi-coc"}


def resolve(*paths):
    found, globs, errors = report.split_arguments([str(p) for p in paths])
    assert not globs and not errors
    return found


def test_resolve_home_recognises_every_layout(homes, tmp_path):
    repo, user_data, app_home = homes["repo"], homes["user_data"], homes["app_home"]
    assert report.resolve_home(str(repo)) == (str(repo / ".coc" / "campaigns"), "home")
    assert report.resolve_home(str(app_home)) == (str(app_home / ".coc" / "campaigns"), "home")
    assert report.resolve_home(str(user_data)) == (str(app_home / ".coc" / "campaigns"), "app-userdata")
    assert report.resolve_home(str(app_home / ".coc")) == (str(app_home / ".coc" / "campaigns"), "workspace")
    assert report.resolve_home(str(app_home / ".coc" / "campaigns")) == (str(app_home / ".coc" / "campaigns"), "campaigns-dir")
    assert report.resolve_home(str(tmp_path / "nowhere")) is None
    (tmp_path / "empty").mkdir()
    assert report.resolve_home(str(tmp_path / "empty")) is None


def test_the_same_campaigns_dir_named_two_ways_is_one_home(homes):
    found = resolve(homes["user_data"], homes["app_home"], homes["app_home"] / ".coc")
    assert len(found) == 1


def test_aggregate_over_a_checkout_and_an_app_home_pins_every_number(homes):
    agg = report.aggregate(resolve(homes["repo"], homes["user_data"]))

    assert agg["scanned"] == 3
    assert [t["label"] for t in agg["tables"]] == ["h1:tbl-a", "h2:game-b"]  # setup-only is scanned, never a table

    a, b = agg["tables"]
    assert a["classes"]["npc_reaction"] == {"rows": 4, "artifacts": 0, "excluded": {"duplicate": 1, "stranded": 1},
                                            "tp": 1, "fp": 1, "fn": 1, "tn": 1}
    assert a["classes"]["clue_follow_up"] == {"rows": 0, "artifacts": 0, "excluded": {"class_executes": 2},
                                              "tp": 0, "fp": 0, "fn": 0, "tn": 0}
    assert a["classes"]["time_cost"] == {"rows": 1, "artifacts": 0, "excluded": {"direct": 1, "unanswered": 1},
                                         "tp": 1, "fp": 0, "fn": 0, "tn": 0}
    assert b["classes"]["npc_reaction"]["artifacts"] == 1  # the label key resolved through the turn's person receipt
    assert (b["classes"]["npc_reaction"]["tp"], b["classes"]["npc_reaction"]["fp"]) == (3, 0)
    assert (b["classes"]["clue_follow_up"]["tp"], b["classes"]["clue_follow_up"]["fp"]) == (2, 2)
    assert a["cost"] == {"turns_with_call": 3, "mean_ms": 1500, "median_ms": 1500, "max_ms": 2000}
    assert b["cost"]["mean_ms"] == 600

    npc, clue, time_cost = (agg["classes"][c] for c in ("npc_reaction", "clue_follow_up", "time_cost"))
    assert (npc["tp"], npc["fn"], npc["fp"]) == (4, 1, 1)
    assert npc["agreement"] == pytest.approx(0.8) and not npc["agreement_met"] and npc["fp_met"] and not npc["met"]
    assert clue["agreement"] == 1.0 and clue["fp_over"] == ["h2:game-b"] and not clue["fp_met"] and not clue["met"]
    assert time_cost["agreement"] == 1.0 and time_cost["fp_met"] and time_cost["cost_met"] and time_cost["met"]
    assert agg["cost"] == {"tables_with_data": 2, "over": [], "met": True}


def test_verdict_text_says_met_or_not_met_with_the_table_count_and_per_table_numbers(homes, capsys):
    assert report.main(["jev-steps-report.py", str(homes["repo"]), str(homes["user_data"])]) == 0
    out = capsys.readouterr().out
    assert "tables with consequence telemetry: 2" in out
    assert "[npc_reaction] NOT MET -- 2 of 2 tables have rows of this class" in out
    assert "[clue_follow_up] NOT MET -- 1 of 2 tables" in out
    assert "h1:tbl-a: not counted {'class_executes': 2}" in out
    assert "[time_cost] MET -- 2 of 2 tables" in out
    assert "h1:tbl-a: rows 4 tp 1 fp 1 fn 1 tn 1" in out
    assert "h2:game-b: rows 4 tp 2 fp 2 fn 0 tn 0" in out
    assert "h1:tbl-a: 3/5 turns with a call; mean 1500 ms" in out
    assert "campaign: tbl-a" not in out  # the per-campaign sections are opt-in


@pytest.mark.parametrize("ms, met", [(1500, True), (1501, False)])
def test_the_added_ms_line_is_inclusive_and_judged_per_table(tmp_path, ms, met):
    campaigns = tmp_path / "home" / ".coc" / "campaigns"
    good = [candidate("time_cost", "docks", 1, cleared=True, did=True), budget(1, 100)]
    bad = [candidate("time_cost", "docks", 1, cleared=True, did=True), budget(1, ms)]
    write_campaign(campaigns, "good", good)
    write_campaign(campaigns, "edge", bad)
    agg = report.aggregate(resolve(tmp_path / "home"))
    assert agg["cost"]["met"] is met
    assert agg["cost"]["over"] == ([] if met else ["h1:edge"])
    assert agg["classes"]["time_cost"]["met"] is met  # a pooled mean of the two would hide the slow table


def test_agreement_line_is_inclusive_at_point_nine(tmp_path):
    campaigns = tmp_path / "home" / ".coc" / "campaigns"

    def table(hits: int, misses: int) -> list[dict]:
        return ([candidate("time_cost", f"hit{i}", i, cleared=True, did=True) for i in range(hits)]
                + [candidate("time_cost", f"miss{i}", 100 + i, cleared=False, did=True, confidence=0.2) for i in range(misses)]
                + [budget(1, 10)])

    write_campaign(campaigns, "t", table(9, 1))
    v = report.aggregate(resolve(tmp_path / "home"))["classes"]["time_cost"]
    assert (v["tp"], v["fn"]) == (9, 1) and v["agreement_met"] and v["met"]
    write_campaign(campaigns, "t", table(8, 2))
    v = report.aggregate(resolve(tmp_path / "home"))["classes"]["time_cost"]
    assert (v["tp"], v["fn"]) == (8, 2) and not v["agreement_met"] and not v["met"]


def test_a_table_that_executed_the_class_is_not_a_shadow_table_for_it(tmp_path):
    """Under execute mode a cleared clue became a clerk write; the uncleared rows left over can only read as misses,
    so counting them would fail the class for a reason that is not Jev's agreement. The whole class-table is out."""
    campaigns = tmp_path / "home" / ".coc" / "campaigns"
    rows = [candidate("clue_follow_up", "ledger", 1, cleared=True, did=False, executed=True, shadow=False),
            candidate("clue_follow_up", "diary", 2, cleared=False, did=True, confidence=0.2),
            candidate("clue_follow_up", "map", 3, cleared=False, did=True, confidence=0.2), budget(1, 10)]
    write_campaign(campaigns, "t", rows)
    v = report.aggregate(resolve(tmp_path / "home"))["classes"]["clue_follow_up"]
    assert v["agreement"] is None and v["fn"] == 0 and v["tables_with_rows"] == 0 and v["met"] is False
    assert v["excluded"] == {"class_executes": 3}
    # The same misses in a table that only shadowed the class do count.
    write_campaign(campaigns, "t", rows[1:])
    v = report.aggregate(resolve(tmp_path / "home"))["classes"]["clue_follow_up"]
    assert v["fn"] == 2 and v["agreement"] == 0.0


def test_a_first_impression_roll_without_an_npc_field_is_not_the_keepers_action(tmp_path):
    """The label/handle correction must not read a roll that names nobody as a match for a target nobody resolved."""
    campaigns = tmp_path / "home" / ".coc" / "campaigns"
    write_campaign(campaigns, "t", [candidate("npc_reaction", "kp:Unknown Person", 1, cleared=True, did="other"), budget(1, 10)],
                   turns={1: {"receipts": [{"kind": "roll", "decision": FIRST_IMPRESSION}]}})
    v = report.aggregate(resolve(tmp_path / "home"))["classes"]["npc_reaction"]
    assert (v["tp"], v["fp"], v["artifacts"]) == (0, 1, 0)


def test_two_false_positives_in_one_table_fail_and_one_passes(tmp_path):
    campaigns = tmp_path / "home" / ".coc" / "campaigns"
    hits = [candidate("time_cost", f"k{i}", i, cleared=True, did=True) for i in range(20)]
    one = candidate("time_cost", "fp1", 30, cleared=True, did=False)
    two = candidate("time_cost", "fp2", 31, cleared=True, did=False)
    write_campaign(campaigns, "t", hits + [one, budget(1, 10)])
    assert report.aggregate(resolve(tmp_path / "home"))["classes"]["time_cost"]["met"] is True
    write_campaign(campaigns, "t", hits + [one, two, budget(1, 10)])
    v = report.aggregate(resolve(tmp_path / "home"))["classes"]["time_cost"]
    assert v["fp_over"] == ["h1:t"] and v["met"] is False


def test_no_evidence_is_never_a_pass(tmp_path, capsys):
    """No row where the Keeper acted on the class, and a table with no cost row: NOT MET, and the text says why."""
    campaigns = tmp_path / "home" / ".coc" / "campaigns"
    write_campaign(campaigns, "t", [candidate("time_cost", "docks", 1, cleared=False, did=False, confidence=0.1)])
    agg = report.aggregate(resolve(tmp_path / "home"))
    assert agg["classes"]["time_cost"]["agreement"] is None and agg["classes"]["time_cost"]["met"] is False
    assert agg["classes"]["npc_reaction"]["met"] is False and agg["classes"]["npc_reaction"]["tables_with_rows"] == 0
    assert agg["cost"] == {"tables_with_data": 0, "over": [], "met": False}
    assert report.main(["jev-steps-report.py", str(tmp_path / "home")]) == 0
    out = capsys.readouterr().out
    assert "no row in which the Keeper acted on this class" in out
    assert "no table has a consequence_budget row: NOT MET, no evidence" in out


def test_same_campaign_id_in_two_homes_is_two_tables(tmp_path):
    for name in ("one", "two"):
        write_campaign(tmp_path / name / ".coc" / "campaigns", "same", [candidate("time_cost", "docks", 1, cleared=True, did=True), budget(1, 5)])
    agg = report.aggregate(resolve(tmp_path / "one", tmp_path / "two"))
    assert [t["label"] for t in agg["tables"]] == ["h1:same", "h2:same"]
    assert agg["classes"]["time_cost"]["tp"] == 2


def test_campaign_filter_applies_across_homes(homes):
    agg = report.aggregate(resolve(homes["repo"], homes["user_data"]), ["game-*"])
    assert agg["scanned"] == 1 and [t["label"] for t in agg["tables"]] == ["h2:game-b"]


def test_original_root_and_glob_form_still_prints_every_campaign_then_the_verdict(homes, capsys):
    assert report.main(["jev-steps-report.py", str(homes["repo"]), "tbl-*"]) == 0
    out = capsys.readouterr().out
    assert "campaign: tbl-a" in out and "campaign: setup-only" not in out
    assert "-- per class (candidate rows) --" in out
    assert "D6 2a verdict" in out and "[time_cost] " in out
    assert report.main(["jev-steps-report.py", str(homes["repo"]), "no-such-*"]) == 1


def test_detail_flag_prints_the_per_campaign_sections(homes, capsys):
    assert report.main(["jev-steps-report.py", str(homes["user_data"]), "--detail"]) == 0
    out = capsys.readouterr().out
    assert "campaign: game-b" in out and "D6 2a verdict" in out


def test_a_directory_that_is_no_home_is_an_error_not_no_data(tmp_path, capsys):
    (tmp_path / "typo").mkdir()
    assert report.main(["jev-steps-report.py", str(tmp_path / "typo")]) == 1
    assert "holds no .coc/campaigns" in capsys.readouterr().out
    assert report.main(["jev-steps-report.py", str(tmp_path / "missing")]) == 1  # not a directory: read as a glob, no home


def test_no_arguments_prints_the_docstring(capsys):
    assert report.main(["jev-steps-report.py"]) == 2
    assert "D6 2a verdict" in capsys.readouterr().out


def test_an_unreadable_turn_file_is_a_missing_turn_not_a_crash(tmp_path, capsys):
    campaigns = tmp_path / "home" / ".coc" / "campaigns"
    folder = write_campaign(campaigns, "t", [candidate("time_cost", "docks", 1, cleared=True, did=True), budget(1, 5)])
    (folder / "turns").mkdir()
    (folder / "turns" / "0001.json").write_text('{"turn": 1, "receipts": [', encoding="utf-8")  # a live App mid-write
    (folder / "turns" / "notes.json").write_text("{}", encoding="utf-8")
    assert report.main(["jev-steps-report.py", str(tmp_path / "home"), "--detail"]) == 0
    assert "[time_cost] MET" in capsys.readouterr().out


def snapshot(*roots: Path) -> dict[str, tuple[int, int]]:
    return {str(p): (p.stat().st_size, p.stat().st_mtime_ns) for root in roots for p in [root, *root.rglob("*")]}


def test_the_report_writes_nothing_and_leaves_the_execute_list_alone(homes, tmp_path, capsys):
    budgets = homes["repo"] / "content" / "rulesets" / "coc7" / "host-budgets.json"
    budgets.parent.mkdir(parents=True)
    budgets.write_text(json.dumps({"jev_steps": {"execute": ["clue_follow_up"]}}), encoding="utf-8")
    before = snapshot(homes["repo"], homes["user_data"].parent.parent)
    assert report.main(["jev-steps-report.py", str(homes["repo"]), str(homes["user_data"]), "--detail"]) == 0
    capsys.readouterr()
    assert snapshot(homes["repo"], homes["user_data"].parent.parent) == before
    assert json.loads(budgets.read_text(encoding="utf-8")) == {"jev_steps": {"execute": ["clue_follow_up"]}}
