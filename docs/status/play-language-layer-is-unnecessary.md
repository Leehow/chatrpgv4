# The play_language layer solves a problem that should not exist

> **Status:** Finding, recorded. Nothing repaired. No code changed.
> **Date:** 2026-09-01
> **Track:** `ACTIVE_IMPLEMENTATION_TRACK=pi-coc`
> **Origin:** surfaced by TextGraph T5 gate 1, then reframed by the user.

## What was observed in real play

A TextGraph T5 session asked, as the player, for an English table. The KP wrote
its prose in English without being told to — and the campaign around it was
`play_language: zh-Hans`, so **English narration arrived wrapped in Chinese
host-rendered labels**.

The first diagnosis was "no operation in the 147-op surface accepts
`play_language`, so an English table cannot be created." That is factually
true and was the wrong problem to fix.

## The measurement that reframes it

| | |
| --- | --- |
| `coc_language.py` | **2381 lines** |
| Keys per language profile | 21 |
| Label entries per profile | **224** |
| Built-in profiles | `zh-Hans`, `en-US`, `ja-JP` |
| **Hand-maintained translated strings** | **≈672** |

Plus `_infer_play_language_from_rendered` in `coc_turn_finalization.py:256`:

```python
if "【Public roll】" in rendered_text: return "en-US"
if "【公開ロール】" in rendered_text: return "ja-JP"
return DEFAULT_PLAY_LANGUAGE
```

That is hardcoded string matching used as language detection — the exact
pattern the project's standing rule forbids, with language detection named in
it explicitly.

## The argument

An LLM replies in the language it is addressed in. That is not a feature to
configure; it is how the model already behaves, and the T5 session demonstrated
it — the KP followed the player into English with nothing set.

So the only thing that needs a stored language is **host-composed
player-visible text**: report headings, speaker labels, dossier field names,
transcript labels. And the real question is not "how does the host learn the
language" but **why the host is composing player-visible prose at all.**

If every player-visible string is produced by the KP, then:

- no language needs to be stored, passed, defaulted or inferred;
- the 672 translated strings are not needed;
- `_infer_play_language_from_rendered` is not needed, and the standing-rule
  violation goes with it;
- a table in a language with no profile stops being a second-class case;
- the instruction reduces to one line in the prompt: render player-visible text
  in the player's language.

## The discarded fix, recorded because it was nearly committed

An input parameter was added to `setup.quick_start` and threaded through
`campaign.quick_start` → `coc_starter.quick_start` →
`coc_state._create_campaign_at`. It worked end to end: `play_language="en-US"`
produced `campaign.play_language='en-US'` with the English profile, and an
omitted value still produced `zh-Hans`.

It was reverted. It added a model-facing entry point to a layer that should be
removed, and it introduced 2 new failures in `tests/test_plugin_mcp.py` (11
pre-existing → 13). Both facts point the same way.

Also worth noting: the existing hint told the KP **"do not pass play_language to
setup.quick_start"**, and the operation description recorded the zh-Hans
default as settled. The gap was deliberate, not an oversight — which is why
widening it needed a design decision rather than a patch.

## What this is not

This is not a plan to delete `coc_language.py`. Removing a layer that renders
every player-visible host string is a change to all player-facing output and
needs its own specification, its own slices, and its own acceptance. The point
here is only that **adding to that layer is the wrong direction**, and that the
TextGraph T5 finding should be recorded as "the layer should not exist" rather
than "the layer is missing an input".

## Consequence for TextGraph T5

Gate 1's live half stays blocked, with the reason corrected: a non-Chinese
table cannot be seated today, and the fix is not a `play_language` parameter.
The structural half of gate 1 already passes — the obligation derivation takes
no language argument at all, verified by signature and by AST — so TextGraph is
already on the right side of this. It is the surrounding localization layer
that is not.
