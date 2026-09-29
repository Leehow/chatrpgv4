"""Contract §152 over the emitted kernel's RPC: a language-scoped package, installed from its test fixture."""
import shutil

from conftest import MODULE, PREGEN, WORKTREE, campaign_dir, read_json

FIXTURE = WORKTREE / "tests" / "fixtures" / "mods" / "language-zh"
ID = "language-zh"


def create(kernel, campaign, tag):
    kernel.ok("campaign.create", {"id": campaign, "module": MODULE, "pregen": PREGEN, "play_language": tag})


def test_the_package_is_on_where_it_names_the_tag_and_extends_the_voice_lane_there(kernel):
    kernel.ok("mods.install", {"path": str(FIXTURE)})
    create(kernel, "zh", "zh-Hans")
    create(kernel, "en", "en")
    locks = {c: read_json(campaign_dir(kernel.workspace, c) / "world.json")["mods"]["active"][ID]["enabled"] for c in ("zh", "en")}
    assert locks == {"zh": True, "en": False}
    # The shipped Chinese package is on in the zh-Hans campaign as well; switch it off so the fixture's addendum is what
    # this test reads (tests/extension/language-scoped-mods.test.mjs covers zh-optimize itself).
    assert read_json(campaign_dir(kernel.workspace, "zh") / "world.json")["mods"]["active"]["zh-optimize"]["enabled"] is True
    kernel.ok("mods.configure", {"campaign": "zh", "id": "zh-optimize", "enabled": False})
    owner = (WORKTREE / "mods" / "narration-craft" / "voice-lane.md").read_text(encoding="utf-8").strip()
    addendum = (FIXTURE / "voice-addendum.md").read_text(encoding="utf-8").strip()
    assert kernel.ok("voice.job", {"campaign": "zh", "backfill": True})["instruction"] == f"{owner}\n\n## Language addendum: {ID}\n\n{addendum}"
    assert kernel.ok("voice.job", {"campaign": "en", "backfill": True})["instruction"] == owner


def test_an_over_budget_language_brief_is_refused_by_name(kernel, tmp_path):
    package = tmp_path / "language-zh"
    shutil.copytree(FIXTURE, package)
    (package / "brief.md").write_text("x" * 401, encoding="utf-8")
    error = kernel.err("mods.install", {"path": str(package)})
    assert error["code"] == "invalid_params" and error["details"]["reason"] == "language_brief_over_budget"
    assert (error["details"]["bytes"], error["details"]["limit"], error["details"]["field"]) == (401, 400, "contributes.brief")
    assert error["fix"] and error["message"].startswith("language-zh 1.0.0: ")
