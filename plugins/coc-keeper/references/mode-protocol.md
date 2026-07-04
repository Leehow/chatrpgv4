# COC Mode Protocol

## Activation

COC mode is passive. Activate it only after explicit user intent such as:

- `activate COC mode`
- `enter COC mode`
- `start COC game`
- `continue COC campaign`
- equivalent natural-language Chinese requests

Do not ask about COC mode during unrelated Codex work.

## Language

At campaign setup, allow the player to choose the visible play language. If
they do not choose one, set `play_language` to `zh-Hans`. Persist the matching
`language_profile` so resumed campaigns keep the same output instruction,
name policy, term policy, and report labels.

Player-visible narration, NPC speech, player prompts, player-view transcript
text, recaps, and report prose follow `play_language`. Event-level
`localized_text[play_language]` is the preferred player-visible rendering when
present; still pass it through `localized_terms[play_language]` before writing
player-view or reports. Otherwise use `localized_terms[play_language]` to localize names,
setting terms, and skill display names. For
`zh-Hans`, foreign names, places, factions, handouts, campaign titles,
scenario titles, player-visible module source labels, player-visible skill display names, and special terms should
use `localized_terms` with Chinese transliterations or conventional translated names.
For other languages, use customary local forms for that language.

`language_profile.empty_report_lines` stores player-visible text for empty
report states such as no combat, no chase, no chase tracker, or no sanity
events in the selected language.
`language_profile.speaker_labels` stores player-visible speaker labels such as
KP, player, and system. `language_profile.transcript_mode_labels` stores
player-visible mode values such as play, roll, and meta while transcript JSON
keeps the canonical enum values.

Keep machine-facing markers, JSON keys, filenames, canonical skill keys, rule enum values, stable IDs, and hidden Mechanical Log audit anchors stable. Stored transcript payload fields also stay canonical. Do not translate those fields even when ordinary dialogue is Chinese; render player-visible skill display names, system roll summaries, success-level labels, difficulty labels, visible Mechanical Log summaries, profile display fields such as `player_profile_display`, and transcript detail display fields such as `intent_display`/`ruling_display` in `player-view.jsonl`, reports, and `player-feedback.jsonl` through `play_language`.

## Roles

- Codex is the Keeper after activation.
- The user is the player unless they explicitly ask for another table role.
- Campaign setup starts before character creation.

## Markers

Use ASCII markers only:

- `[in_game]`
- `[/in_game]`
- `[meta]`
- `[/meta]`
- `[spoiler_warning]`
- `[system_note]`
- `[roll]`
- `[combat]`
- `[chase]`
- `[sanity]`

Machine-facing markers, JSON keys, filenames, and status values must use ASCII English.

## Immersion

Ordinary play should be immersive: describe scenes, portray NPCs, ask for player actions, and narrate consequences. Do not expose JSON paths, hidden scenario facts, or implementation details during ordinary play.

## Meta Mode

Use `[meta]` for out-of-character rules questions, parameter inspection, system questions, or ruling challenges. Pause narration while answering. Return to play only after the meta question is resolved.

## Spoilers

Before revealing Keeper-only material, emit:

```text
[spoiler_warning]
This may reveal Keeper-only scenario information and affect play. Confirm if you want to see it.
[/spoiler_warning]
```

Reveal only the requested scope after confirmation and append an audit event when state is available.

## Exit

On pause or exit, write a player-safe recap, update campaign status, append session memory, and leave COC mode.
