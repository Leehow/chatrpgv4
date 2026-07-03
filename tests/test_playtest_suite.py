import importlib.util
import json
from pathlib import Path


def load_module(name: str, relative_path: str):
    path = Path(relative_path)
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_playtest_harness = load_module("coc_playtest_harness", "plugins/coc-keeper/scripts/coc_playtest_harness.py")
coc_playtest_suite = load_module("coc_playtest_suite", "plugins/coc-keeper/scripts/coc_playtest_suite.py")


def test_suite_report_indexes_runs_and_core_rulebook_coverage(tmp_path):
    coc_playtest_harness.create_haunting_module_run(tmp_path, run_id="v2-haunting-module")
    coc_playtest_harness.create_chase_drill_run(tmp_path, run_id="v3-chase-drill")

    report_path = coc_playtest_suite.generate_suite_report(tmp_path)
    index_path = tmp_path / ".coc" / "playtests" / "index.json"

    report_text = report_path.read_text()
    index = json.loads(index_path.read_text())

    assert report_path == tmp_path / ".coc" / "playtests" / "suite-report.md"
    assert index["schema_version"] == 1
    assert {run["run_id"] for run in index["runs"]} == {"v2-haunting-module", "v3-chase-drill"}
    assert index["runs"][0]["audit_result"] == "PASS"
    assert index["runs"][1]["audit_result"] == "PASS"
    assert index["coverage"]["character_dossier"]["status"] == "covered"
    assert index["coverage"]["kp_player_transcript"]["status"] == "covered"
    assert index["coverage"]["mechanical_rolls"]["status"] == "covered"
    assert index["coverage"]["combat"]["status"] == "covered"
    assert index["coverage"]["combat"]["runs"] == ["v2-haunting-module"]
    assert index["coverage"]["chase"]["status"] == "covered"
    assert index["coverage"]["chase"]["runs"] == ["v3-chase-drill"]
    assert index["coverage"]["sanity"]["status"] == "covered"
    assert index["coverage"]["sanity"]["runs"] == ["v2-haunting-module"]
    assert index["coverage"]["player_feedback"]["status"] == "covered"
    assert index["gaps"] == []
    assert index["non_passing_runs"] == []

    assert "# COC Playtest Suite Report" in report_text
    assert "## Run Index" in report_text
    assert "v2-haunting-module" in report_text
    assert "The Haunting Module Playthrough" in report_text
    assert "haunting_module" in report_text
    assert "v3-chase-drill" in report_text
    assert "Rooftop Chase Drill" in report_text
    assert "chase_drill" in report_text
    assert "## Core Coverage Matrix" in report_text
    assert "character_dossier: covered" in report_text
    assert "kp_player_transcript: covered" in report_text
    assert "mechanical_rolls: covered" in report_text
    assert "combat: covered" in report_text
    assert "chase: covered" in report_text
    assert "sanity: covered" in report_text
    assert "player_feedback: covered" in report_text
    assert "## Non-Passing Runs" in report_text
    assert "- No non-passing runs in this suite." in report_text
    assert "## Remaining Gaps" in report_text
    assert "- No gaps detected across indexed playtest runs." in report_text
