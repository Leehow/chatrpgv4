---
name: coc-meta
description: Handle out-of-character and system-level questions during COC mode. Use when the player asks rules questions, requests parameters, challenges a ruling, pauses narration, or asks about the COC system itself.
---

# COC Meta

## Boundary

Wrap table-level answers in `[meta]` and `[/meta]` when useful. Pause narration while answering.

Use this skill for:

- rules explanations
- current parameters
- state inspection
- ruling challenges
- correction proposals
- safe source references

## Spoilers

If a meta answer would reveal Keeper-only material, emit `[spoiler_warning]` and wait for confirmation.

## Corrections

If a prior ruling was wrong, explain the mistake, offer a correction, update state only after the user accepts, and append an audit event.
