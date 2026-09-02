"""A module's asset root must be named with something the Keeper can read.

`asset_root_id` travels into results the Keeper reads — `setup.phase`,
`progressive.status`, and `session.resume`, the operation a host restart
depends on — and all three declare it semantic. Declared semantic still means
the value must pass the closed identity grammar, and the digest fallback minted
`pdf-<sha[:16]>`: a 16-character hex token, exactly what that grammar refuses.
A campaign rooted that way would have failed those results closed in their
entirety, `session.resume` included.

It was reachable. Registering the prepared Cold Harvest bundle (2026-09-01)
produced `pdf-e4832eec4aa06a2a` on the first try, and projecting that value
through the Keeper's own identity projection dropped it from every operation
above. The bundle already carries a semantic `source_id` — enforced at bind
time since the Amaranthine relabel — so the root derives from that, and a
caller with neither a canonical module id nor a semantic source id is refused
rather than handed an unreadable name.

Roots already on disk are resolved by file digest before this is reached and
keep the names they have.
"""
from __future__ import annotations

import importlib.util
import re
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
PI_PROJECTION = (
    ROOT / "plugins" / "coc-keeper" / "pi" / "lib" / "tool-contract-projection.ts"
)


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


assets = _load("coc_module_assets_root_id_tests", SCRIPTS / "coc_module_assets.py")


def _grammar_refuses(value: str) -> bool:
    """The consumer's own entropy rule, read out of its source.

    `violatesSemanticIdentityGrammar` rejects any token of 16+ hex characters
    or 20+ alphanumerics; this mirrors that one clause so the test states the
    rule the value must survive rather than a hand-picked example.
    """
    text = PI_PROJECTION.read_text(encoding="utf-8")
    assert "if (token.length >= 16 && HEX_TOKEN.test(token)) return true;" in text, (
        "the consumer's entropy rule changed; re-derive this check from it"
    )
    for token in re.split(r"[^0-9a-zA-Z]+", value):
        if not token:
            continue
        if len(token) >= 16 and re.fullmatch(r"[0-9a-fA-F]+", token):
            return True
        if len(token) >= 20 and re.fullmatch(r"[0-9a-zA-Z]+", token):
            return True
    return False


SHA = "e4832eec4aa06a2a4946ac91e9b82388b2a7419310308b625171df95f15ec771"


def test_the_digest_shaped_root_this_replaces_is_unreadable():
    # The exact id the old fallback produced for Cold Harvest.
    assert _grammar_refuses(f"pdf-{SHA[:16]}")


def test_a_root_derived_from_the_source_id_is_readable():
    root = assets.resolve_asset_root_id(
        file_sha256=SHA, source_id="pdf:cold-harvest",
    )
    assert root == "cold-harvest"
    assert not _grammar_refuses(root)


def test_a_namespaced_source_id_keeps_every_meaning_bearing_segment():
    assert assets.resolve_asset_root_id(
        file_sha256=SHA, source_id="module:masks-of-nyarlathotep:peru",
    ) == "masks-of-nyarlathotep-peru"


def test_a_canonical_module_id_still_wins():
    assert assets.resolve_asset_root_id(
        canonical_module_id="the-haunting",
        file_sha256=SHA,
        source_id="pdf:something-else",
    ) == "the-haunting"


def test_neither_id_is_refused_rather_than_minted():
    with pytest.raises(assets.ModuleAssetsError) as excinfo:
        assets.resolve_asset_root_id(file_sha256=SHA)
    message = str(excinfo.value)
    assert "session.resume" in message, (
        "the refusal should say what breaks, not just that it refused"
    )


def test_a_bad_digest_is_still_a_bad_digest():
    # The refusal path must not become a way to skip digest validation.
    with pytest.raises(assets.ModuleAssetsError):
        assets.resolve_asset_root_id(file_sha256="not-a-digest")


@pytest.mark.parametrize("source_id", [
    "pdf:cold-harvest",
    "pdf:an-amaranthine-desire",
    "module:masks-of-nyarlathotep:peru",
    "source:keeper-rulebook-40th",
])
def test_every_id_the_bind_gate_accepts_yields_a_readable_root(source_id):
    """The two contracts must compose: bind-time legal implies table-readable."""
    root = assets.resolve_asset_root_id(file_sha256=SHA, source_id=source_id)
    assert root and not _grammar_refuses(root)
