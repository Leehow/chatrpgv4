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


# Every effect kind's labels now resolve through the chrome table, so ja-JP
# gets Japanese instead of the English arm of an inline branch. These were
# strict xfails until the migration landed; they are real assertions now.
JAPANESE_BODY_KINDS = ("condition", "loaded_ammunition", "rest")


@pytest.mark.parametrize("kind", JAPANESE_BODY_KINDS)
def test_japanese_bodies_are_not_english(kind):
    """Japanese is a supported language and used to render English bodies.

    Before the chrome consolidation a ja-JP table got a Japanese TAG over an
    English BODY -- `【変化】condition: added "prone"` -- because these labels
    lived in `if language == "zh-Hans": ... else: ...` branches and Japanese
    took the else. This needed no fourth language to be a live defect.

    The check is that Japanese and English differ. It deliberately does NOT
    scan for Latin characters: `prone` and `revolver` are data values carried
    by the effect, and a check that cannot tell chrome from data would fail on
    correct output.
    """
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
    bodies = {
        language: coc_turn._render_state_delta(
            dict(fixtures[kind]), play_language=language
        ).split("】", 1)[1]
        for language in ("zh-Hans", "en-US", "ja-JP")
    }
    assert bodies["ja-JP"] != bodies["en-US"], (
        f"ja-JP body is byte-identical to en-US: {bodies['ja-JP']!r}"
    )
    assert bodies["ja-JP"] != bodies["zh-Hans"], (
        f"ja-JP body is byte-identical to zh-Hans: {bodies['ja-JP']!r}"
    )
    assert len(set(bodies.values())) == 3, bodies


# ---------------------------------------------------------------------------
# The language space, opened through per-campaign chrome overrides
# ---------------------------------------------------------------------------

FRENCH_CHROME = {
    "chrome.change_tag": "Changement",
    "chrome.condition_delta": "état : {action} « {condition} »",
    "chrome.condition_action_added": "ajouté",
    "chrome.rest_delta": "repos : nuit complète en sécurité{reset}",
    "chrome.rest_reset": " ; compteur de jours de {san} réinitialisé",
}


def test_a_campaign_language_with_no_built_in_table_can_still_render_itself():
    """`play_language` is a free-form tag, and chrome must not be an enum.

    Three built-in languages is a starting set, not the supported set. A
    campaign carries its own labels under the `chrome.` prefix in
    `localized_terms[play_language]`, so rendering stays a deterministic table
    lookup a stored receipt can replay while the language space stays open.
    """
    effect = {
        "effect_kind": "condition", "action": "added",
        "condition": "prone", "effect_id": "e",
    }
    with_override = coc_turn._render_state_delta(
        dict(effect), play_language="fr-FR", terms=FRENCH_CHROME
    )
    without = coc_turn._render_state_delta(dict(effect), play_language="fr-FR")

    assert with_override == "【Changement】état : ajouté « prone »"
    assert "condition: added" in without, (
        "without overrides a fr-FR table still gets English chrome; that is the "
        "state this override path exists to let a campaign leave"
    )


def test_a_substituted_chrome_language_is_answerable_not_silent():
    """The defect was never English chrome; it was English chrome with no signal."""
    import coc_language

    assert coc_language.chrome_is_substituted("zh-Hans") is False
    assert coc_language.chrome_is_substituted("en-US") is False
    assert coc_language.chrome_is_substituted("ja-JP") is False
    assert coc_language.chrome_is_substituted("fr-FR") is True
    assert coc_language.chrome_is_substituted("fr-FR", FRENCH_CHROME) is False


@pytest.mark.parametrize("language", ["zh-Hans", "en-US", "ja-JP"])
def test_overrides_do_not_disturb_a_language_that_has_a_table(language):
    """A built-in language with no overrides must render exactly as before."""
    effect = {
        "effect_kind": "condition", "action": "added",
        "condition": "prone", "effect_id": "e",
    }
    plain = coc_turn._render_state_delta(dict(effect), play_language=language)
    empty_terms = coc_turn._render_state_delta(
        dict(effect), play_language=language, terms={}
    )
    unrelated_terms = coc_turn._render_state_delta(
        dict(effect), play_language=language, terms={"Spot Hidden": "侦查"},
    )
    assert plain == empty_terms == unrelated_terms


def test_chrome_overrides_do_not_collide_with_rulebook_terminology():
    """`Spot Hidden` and `change_tag` share one map; only one is render furniture."""
    import coc_language

    labels = coc_language.table_mechanics_labels(
        "zh-Hans", terms={"change_tag": "WRONG", "Spot Hidden": "侦查"},
    )
    assert labels["change_tag"] == "变化", (
        "an unprefixed key must not reach chrome; the prefix is what keeps "
        "rulebook terms and render furniture from overwriting each other"
    )
