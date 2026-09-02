"""Chrome render gate — every preserved mechanics segment must re-render byte-for-byte.

Written and made to pass BEFORE the chrome consolidation, so it gates that work
rather than describing it. The mechanics blocks the host composes
(`【变化】理智：55 → 50（-5）`) land in `rendered_text`, which is covered by
`rendered_text_sha256` and `integrity_digest`. Moving a label from an inline
`if language == "zh-Hans"` branch into the chrome table must not change one
byte of what any preserved turn rendered; if it does, every stored receipt
stops replaying, including real playtest evidence under `.coc/`.

The inputs are real: `turn-finalizations.jsonl` rows written by the product,
re-rendered through the real `_mechanic_source_lines` from their own `bundle`
and compared against the `segments` text recorded at the time. Nothing is
reconstructed from the thing being checked.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))


def _load(name: str, rel: Path):
    spec = importlib.util.spec_from_file_location(name, rel)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_turn = _load("coc_turn_finalization_chrome", SCRIPTS / "coc_turn_finalization.py")

MECHANIC_TYPES = ("public_check", "state_delta", "asset_delta", "exceptional_effect")


def _corpus() -> list[dict]:
    rows: list[dict] = []
    for path in sorted(REPO.glob(".coc/**/turn-finalizations.jsonl")):
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(row, dict) and row.get("bundle") and row.get("segments"):
                rows.append(row)
    return rows


@pytest.fixture(scope="module")
def corpus() -> list[dict]:
    rows = _corpus()
    if not rows:
        pytest.skip("no preserved finalizations on this checkout")
    return rows


def test_the_corpus_carries_mechanics_segments_to_check(corpus):
    """A gate over an empty corpus proves nothing; say how much it covers."""
    counted = sum(
        1
        for row in corpus
        for seg in row["segments"]
        if seg.get("segment_type") in MECHANIC_TYPES
    )
    assert counted >= 100, f"only {counted} mechanics segments to replay"


# Receipts written before the public-roll format changed. Current code renders
# `【明骰】理智｜掷骰：65；达到：失败` where these stored
# `【明骰】理智（骰值）：骰面 65 → 总值 65`. They are pinned, not excused: the
# gate fails if the set grows, and it also fails if the set SHRINKS, because a
# stale receipt starting to match again means the format moved back and
# something else drifted.
KNOWN_STALE_SOURCE_IDS = frozenset({
    "toolbox-the-white-war-qs-mt0c8rdz-000014",
    "toolbox-zai-glm53-full-e2e-20260821-5-000012",
    "toolbox-zai-glm53-full-e2e-20260821-5-000020",
})


def test_every_preserved_mechanics_segment_re_renders_byte_for_byte(corpus):
    """The gate. One byte of drift breaks a stored receipt's replay.

    Cross-version replay is not total and this records why: 534 of 546
    preserved mechanics segments re-render exactly, and 12 come from three
    receipts written before the public-roll format changed. Any consolidation
    of chrome literals must leave all 534 untouched.
    """
    mismatches: list[str] = []
    stale_seen: set[str] = set()
    checked = 0
    for row in corpus:
        try:
            sources = coc_turn._mechanic_source_lines(row["bundle"])
        except Exception as exc:  # noqa: BLE001 - a raise is also a mismatch
            mismatches.append(f"{row.get('finalization_id')}: render raised {exc!r}")
            continue
        for seg in row["segments"]:
            kind = seg.get("segment_type")
            if kind not in MECHANIC_TYPES:
                continue
            for source_id in seg.get("source_ids") or []:
                rendered = sources.get(kind, {}).get(source_id)
                if rendered is None:
                    # A source the bundle no longer carries is a corpus fact,
                    # not a rendering regression; the obligation replay in
                    # test_text_graph_replay.py owns that question.
                    continue
                checked += 1
                if rendered in seg.get("text", ""):
                    continue
                if source_id in KNOWN_STALE_SOURCE_IDS:
                    stale_seen.add(source_id)
                    continue
                mismatches.append(
                    f"{row.get('finalization_id')} {kind}/{source_id}:\n"
                    f"    stored:   {seg.get('text')!r}\n"
                    f"    rendered: {rendered!r}"
                )
    assert checked >= 500, f"only {checked} segments actually compared"
    assert not mismatches, "chrome render drift:\n  " + "\n  ".join(mismatches[:10])
    assert stale_seen == KNOWN_STALE_SOURCE_IDS, (
        "the pinned pre-format-change set moved: "
        f"{sorted(KNOWN_STALE_SOURCE_IDS - stale_seen)} now match, "
        f"{sorted(stale_seen - KNOWN_STALE_SOURCE_IDS)} newly stale"
    )


@pytest.mark.parametrize("language", ["zh-Hans", "en-US", "ja-JP"])
def test_the_three_built_in_languages_render_every_effect_kind(language):
    """Pin every branch the consolidation will touch, in all three languages.

    The corpus is 100% zh-Hans, so it cannot catch a change that only breaks
    English or Japanese. These fixtures cover the kinds the corpus does not.
    """
    import coc_language

    chrome = coc_language.table_mechanics_labels(language)
    assert chrome, language
    rendered = {
        "condition": coc_turn._render_state_delta(
            {
                "effect_kind": "condition",
                "action": "added",
                "condition": "prone",
                "effect_id": "e1",
            },
            play_language=language,
        ),
        "loaded_ammunition": coc_turn._render_state_delta(
            {
                "effect_kind": "loaded_ammunition",
                "change": 3,
                "weapon_label": "revolver",
                "before": 2,
                "after": 5,
                "effect_id": "e2",
            },
            play_language=language,
        ),
    }
    for kind, text in rendered.items():
        assert text.startswith("【"), (language, kind, text)
        assert "】" in text, (language, kind, text)


# The chrome table's own keys resolve per language, so `scalar` renders
# `【変化】幸運：55 → 50（-5）` correctly. The effect kinds whose labels live in
# inline `if language == "zh-Hans": ... else: ...` branches do not: Japanese
# falls into the English arm and gets a Japanese TAG over an English BODY.
JAPANESE_MIXED_LANGUAGE_KINDS = ("condition", "loaded_ammunition", "rest")


@pytest.mark.parametrize("kind", JAPANESE_MIXED_LANGUAGE_KINDS)
@pytest.mark.xfail(
    strict=True,
    reason=(
        "known defect: these labels are inline `if zh: ... else: ...` branches, "
        "so ja-JP takes the English arm. Fixed by migrating them into the "
        "chrome table; this flips to xpass when it is."
    ),
)
def test_japanese_bodies_are_not_english(kind):
    """Japanese is a SUPPORTED language today and is already broken.

    This is the case for consolidating chrome, and it needs no fourth language
    to make it: a ja-JP table gets `【変化】condition: added "prone"` right now.
    """
    import re

    fixtures = {
        "condition": {
            "effect_kind": "condition", "action": "added",
            "condition": "prone", "effect_id": "e",
        },
        "loaded_ammunition": {
            "effect_kind": "loaded_ammunition", "change": 3,
            "weapon_label": "revolver", "before": 2, "after": 5, "effect_id": "e",
        },
        "rest": {
            "effect_kind": "rest", "sanity_day_reset": True, "effect_id": "e",
        },
    }
    japanese = coc_turn._render_state_delta(
        dict(fixtures[kind]), play_language="ja-JP"
    )
    english = coc_turn._render_state_delta(
        dict(fixtures[kind]), play_language="en-US"
    )
    body_ja = japanese.split("】", 1)[1]
    body_en = english.split("】", 1)[1]
    assert body_ja != body_en, (
        f"ja-JP body is byte-identical to en-US: {japanese!r}"
    )
    assert not re.search(r"[A-Za-z]{4,}", body_ja), (
        f"ja-JP body carries English words: {japanese!r}"
    )
