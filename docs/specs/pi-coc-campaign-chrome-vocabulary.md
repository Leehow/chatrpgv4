# Campaign chrome vocabulary — specification

> **Status:** specification only. No slice authorized, nothing built.
> **Track:** `ACTIVE_IMPLEMENTATION_TRACK=pi-coc`
> **Date:** 2026-09-01

## 1. The user job

A player should be able to play in their own language. Prose already works —
the Keeper follows the player without being told, and since the
`play_language` label layer was removed it is also told explicitly, through
`player_facing_style_contract().output_language`.

**Chrome does not work.** The deterministic mechanics blocks the host composes
— `【变化】理智：55 → 50（-5）` — are rendered from a closed three-language
table. A campaign in any fourth language gets English chrome, silently, with
no signal that anything was substituted.

Success is: a French table sees French chrome, and nothing about how it gets
there weakens determinism, hashing, or replay.

## 2. Why the obvious answers are wrong

**Add more languages to the table.** The table is a hardcoded mapping standing
in for an open-ended question ("how is this said in the player's language").
The project forbids that pattern by name. Four languages is the same defect as
three.

**Let the Keeper render the blocks.** These are not prose. They are composed by
`compose_segments`, and `_reject_mechanics_in_draft` exists specifically to
stop the Keeper from authoring them. They land in `rendered_text`, covered by
`rendered_text_sha256` and `integrity_digest`. Model-authored text cannot be
deterministic, and a receipt that cannot be replayed is not a receipt.

**Canonicalize the blocks to one language.** Considered and rejected while
removing the label layer: it breaks replay of every stored receipt, including
playtest evidence under `.coc/`, and demotes the zh-Hans-first audience to
English chrome. It works against the goal rather than toward it.

## 3. The shape

Resolve the vocabulary **once per campaign**, persist it, and render from the
persisted copy.

```
campaign.create (play_language: fr-FR)
        │
        ▼
  chrome vocabulary absent for fr-FR
        │
        ▼
  setup.chrome_vocabulary          ← the Keeper fills 77 short labels
        │                            in the campaign's language, once
        ▼
  host validates + persists into campaign.json beside localized_terms
        │
        ▼
  every later render is a pure table lookup — deterministic, hashable,
  replayable, identical across restarts
```

The division is the one the project already uses everywhere else: **semantic
judgment belongs to the Keeper, determinism belongs to the host.** The Keeper
answers "what is `【变化】` called in French" once; the host answers "what
exactly did this turn render" forever.

`localized_terms` is the existing precedent for a per-campaign, persisted,
language-keyed vocabulary. Chrome sits beside it, not inside it: terms are
rulebook nouns the module and Keeper both use, chrome is host render furniture.

## 4. Measured scope

| surface | size | where |
| --- | --- | --- |
| `TABLE_MECHANICS_LABELS` | 77 keys × 3 languages | `coc_language.py` |
| inline literals in the renderers | 45 CJK strings in 3 functions | `coc_turn_finalization.py:2131-2547` |
| inline literals elsewhere in finalization | 47 CJK strings total | same file |
| language branches to remove | 9 | `if language == "zh-Hans" or language.startswith("zh")` |

The inline half matters as much as the table. `_render_exceptional_effect`
alone carries 21 Chinese literals in an `if zh: … else: …` pair, and
`_render_state_delta` 18. **Any slice that migrates only `TABLE_MECHANICS_LABELS`
leaves two thirds of the chrome hardcoded** — DirectorGraph correction 6 and
the TextGraph residue gate both exist because exactly this was missed before.

## 5. Fail-closed positions

1. **A missing vocabulary is not English.** A campaign whose language has no
   persisted chrome must fail closed with a named error that says the
   vocabulary is unfilled, not silently render English. The current silent
   fallback is the defect being fixed; reproducing it one layer down fixes
   nothing.
2. **A partial vocabulary is a missing one.** All 77 keys or none. A half-filled
   map produces mixed-language chrome, which is worse than either language.
3. **Persisted chrome is immutable for the campaign.** Re-resolving mid-campaign
   changes what an already-hashed receipt would render. If it must change, that
   is a new campaign or an explicit migration with re-hashing, never an
   in-place edit.
4. **`zh-Hans`, `en-US`, `ja-JP` keep their current strings byte-identical.**
   Every existing receipt must still replay. The built-in tables become the
   seed for those three, not a fallback for everything else.

## 6. Gates

| # | gate |
| --- | --- |
| 1 | The three built-in languages render byte-identical output to today, proven by replaying preserved finalizations under `.coc/` |
| 2 | A campaign in a fourth language renders that language's chrome end to end, in real play, not a fixture |
| 3 | A campaign with unfilled chrome fails closed with the named error, and the error tells the Keeper how to fill it |
| 4 | Residue gate: no chrome literal remains outside the vocabulary — whole surface, both languages of the codebase, including the 9 inline branches |
| 5 | `verify_against_baseline.py` clean at set and content level |

Gate 2 is the one that retires TextGraph T5 gate 1's live half, which is
blocked today for exactly this reason.

## 7. Open questions, not decided here

- Does the vocabulary get filled at campaign creation (blocking setup) or at
  first render need (blocking the first mechanics turn)? Creation is simpler;
  first-need avoids paying for campaigns that never render mechanics.
- Do the 77 keys travel as one operation payload or several? 77 short strings
  is small, but `npc.query` collapsed on size once already.
- Does a module's own language interact with the table's? A French table
  running an English-source module is the normal case, not an edge one.
