"""A complete semantic fixture for setup contract tests, never a playtest player."""
from test_setup_drafts import profile


def confirmed_investigator(client, campaign="c1", name="Ada"):
    semantic = profile()
    semantic["name"] = name
    draft = client.ok("setup.draft", {"campaign": campaign, "profile": semantic})
    result = client.ok("setup.confirm", {"campaign": campaign, "revision": draft["revision"], "consent": "approved"})
    return {**result, "investigator": {"id": result["sheet"]["id"], "name": name}}
