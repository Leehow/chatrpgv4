# The play_language layer solves a problem that should not exist

> **Status:** Finding recorded, then acted on. See *What was actually removed*.
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

## What was actually removed

| removed | size | evidence it was safe |
| --- | --- | --- |
| 13 unread label groups in `LANGUAGE_PROFILES` | 193 entries × 3 languages = **579 strings** | zero readers anywhere in `plugins/`, `scripts/`, `tests/` |
| `LANGUAGE_PROFILES` and `language_profile()` entirely | remaining 9 keys × 3 languages | **every one of the 9 had zero production readers** (below) |
| the `language_profile` blob written into `campaign.json` | one persisted object per campaign | written at creation, read only by `tests/test_state.py` |
| `_infer_play_language_from_rendered` | the standing-rule violation | both call sites did not need it (below) |
| the duplicated `if language == "zh-Hans": ... else: ...` branches in `player_facing_style_contract` | two near-identical dicts | they differed by exactly `translationese` and `deterministic_guard` |

`coc_language.py`: **2381 → 1593 lines.**

### The nine "live" keys were not live

An early scan counted string occurrences and reported 8 of 21 keys as still
used. That was wrong: they were substring hits, not reads. Checked individually:

- `outcome_labels`, `difficulty_labels` — `export_battle_report.py` defines its
  **own inline zh-only copy** at the point of use and never reads the profile.
- `speaker_labels`, `output_instruction`, `name_policy`, `term_policy`,
  `raw_payload_fallback` — no reader at all.

So `output_instruction` — the string that said *"Use X for player-visible
narration"*, the whole point of the layer — **was never delivered to anyone.**
The KP followed the player into English anyway, which is the observation this
document opens with.

### Why the language inference could just go

- **`_valid_finalization_contract`**: the recomputed `_mechanic_source_lines`
  result is consumed for its **keys only** (`roll_id` / `effect_id` /
  `event_id`), and the rendered values are discarded. The validation is
  language-independent; nothing is passed now.
- **`replay_matches`**: the only production caller always passes
  `campaign_dir`, so the inference branch was unreachable in production. It now
  falls back to `DEFAULT_PLAY_LANGUAGE`. The two tests that omit `campaign_dir`
  both use `zh-Hans` campaigns and are actually testing `localized_terms`
  overrides, so their assertions are unchanged.

## Correction: one of the two tables did not earn it

> The section below argued that `TABLE_MECHANICS_LABELS` was load-bearing and
> should stay hardcoded. That was wrong, and the user pushed back on exactly
> this: if the point was to stop restricting language, why is chrome still a
> closed three-language table?
>
> The argument rested on `_reject_mechanics_in_draft` proving the Keeper must
> not author mechanics blocks. It is a **de-duplication** guard —
> *"rendering the same authoritative roll or state delta twice"* — and receipt
> validation discards the rendered label text entirely. Determinism does
> require the labels to be fixed per campaign; it never required them to be
> hardcoded.
>
> It was also worse than a missed opportunity: **ja-JP, a supported language,
> was rendering English bodies under Japanese tags** for every effect kind
> behind an inline `if language == "zh-Hans"` branch.
>
> Fixed. The labels are consolidated into the table, a campaign can override
> any of them under a `chrome.` prefix in any language, coverage is reported
> instead of silently substituted, and `localized_terms` — which had no writer
> at all, 249 campaigns and 249 empty maps — now has one. See
> `docs/specs/pi-coc-campaign-chrome-vocabulary.md`.

## What was deliberately kept, and why it is not the same thing

Two tables survive. **They are not leftovers, and removing them is not a
follow-up slice.** A later reader who deletes them will regress the product.

| kept | size | why |
| --- | --- | --- |
| `DEFAULT_LOCALIZED_TERMS` | 127 entries | CoC7 rulebook terminology (`Spot Hidden` → `侦查`). A model translating freely renders the same skill as 侦查/察觉/发现隐物 across a campaign. Cross-turn terminology consistency is the whole job, and a table is the right tool for it. |
| `TABLE_MECHANICS_LABELS` | 231 entries | Chrome for **deterministic mechanics blocks** — `【变化】理智：55 → 50（-5）`. |

The mechanics blocks are the load-bearing case. They are:

1. **not model output** — composed by `compose_segments`, and
   `_reject_mechanics_in_draft` exists specifically to stop the Keeper from
   authoring them;
2. **hashed** — they land in `rendered_text`, which is covered by
   `rendered_text_sha256` and `integrity_digest`.

So "tell the model to write in the player's language" cannot reach them by
construction, and canonicalizing them to one language was considered and
**rejected**: it would (a) break replay of every stored receipt, including real
playtest evidence under `.coc/`, and (b) demote the zh-Hans-first audience to
English chrome. That works against the goal — playing in the player's language —
rather than toward it.

The honest residual limitation, recorded rather than hidden: mechanics chrome
exists in three languages and silently falls back to English chrome for a
fourth. Prose is unrestricted; **chrome is not yet.** That limitation now has a
specification — `docs/specs/pi-coc-campaign-chrome-vocabulary.md` — which also
measures a part this document had not: the table's 77 keys are only a third of
the chrome. Another 45 literals are inline in three renderer functions behind
nine `if language == "zh-Hans"` branches, and a slice that migrated the table
alone would leave them. Specified, not built.

## The replacement mechanism

`player_facing_style_contract()` now carries the instruction the user asked
for, and it reaches the Keeper through `turn.narration_brief`'s
`style_contract` — a path that actually has a consumer, unlike
`output_instruction`:

```json
"output_language": {
  "play_language": "<tag>",
  "instruction": "Write every player-visible sentence in the language the
    player is using ... This is a writing instruction, not a lookup: there is
    no translation table to consult and no supported-language list to stay
    inside. Machine-facing identifiers, JSON keys, canonical skill keys, and
    stable ids stay canonical in every language."
}
```

`play_language` remains a free-form tag with a `zh-Hans` default. It was never
an enum; the restriction people ran into was the silent English fallback, not a
rejected value.

## Guards against restoring this

- `tests/test_state.py` asserts `"language_profile" not in campaign` for both a
  default and a custom-language campaign.
- `AGENTS-coc-mode-template.md`, `mode-protocol.md`, and `state-schema.md` no
  longer instruct anyone to persist a `language_profile`; each says not to.

## Consequence for TextGraph T5

Gate 1's live half stays blocked, with the reason corrected: a non-Chinese
table cannot be seated today, and the fix is not a `play_language` parameter.
The structural half of gate 1 already passes — the obligation derivation takes
no language argument at all, verified by signature and by AST — so TextGraph is
already on the right side of this. It is the surrounding localization layer
that is not.
