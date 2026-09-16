# Guided Creation

## 1.1.1

The exchange is spoken by the host, not by a narrator and not by the guide (user
report 2026-09-16: the opening read stiffly and it was hard to tell what was going
on -- the guide's gestures, an unnamed "I" and rulebook words were mixed in one
reply). Each question is one plain question with one clause on why it matters and
one example answer, five short lines at most; slot purposes are plain words.

## 1.1.0

The exchange is a form. `slots.json` declares the slots the card needs (trade,
built_for, known_for; not_good_at only when volunteered); the kernel keeps the
notes (`setup.note`), the host prints the brief and the one allowed move every
turn, and refuses the draft while a required slot is missing. The guide keeps
only the rendering: the opening frame, the purpose line before each question, a
concrete acknowledgement, one question per turn, the fixed reminder, the aptitude
rules. Judging how much the player wants to say is gone; depth is the slot table
and `max_guided_turns`.


## 1.0.3

Every question now says what it decides before it is asked, and the first guiding
turn says what the exchange is for. Questions are about the person, not a
contrived incident; each answer is named concretely as the trait or ability it
puts on the card, then followed by a lead the player can take or leave. A plain
answer to a plain question no longer ends the exchange; the trade clarification no
longer counts toward the cap; and no card is drafted before one thing about the
body or mind and one known ability are in, unless the player says so. (1.0.2
below was described but never stamped into the manifest; this version carries
both changes.)

## 1.0.2

The package's player-facing `name` and `description` are per-language objects,
`en` beside `zh-Hans`, the shape the renderer and the kernel already read for the
other built-ins. Nothing else moved: the guide, the settings, the settings
schema and the required capabilities are the 1.0.1 text unchanged.

Those two fields were first rewritten in place under the 1.0.1 label. A
workspace holding the installed 1.0.1 snapshot then had bytes that no longer
matched the shipped package, and the catalog refused every package rather than
choose between them. The rename travels under its own version here. A campaign
locked to 1.0.1 keeps that package, and its plain English name, until it
upgrades explicitly.

## 1.0.1

A trade with no rulebook entry is settled first, in its own turn, before the
situational question, and counts as a guiding turn. The bytes of 1.0.0 stay
frozen wherever they were installed; a changed guide is a new version.

## 1.0.0

First version. Requires `setup.guidance.v1` and `setup.aptitude.v1`. Contributes
`guide.md`: a player-paced exchange before the draft, situational questions that
name their consequence on the card, a fixed one-line escape reminder, a turn cap
in `max_guided_turns`, and the aptitude rules that let the player's words reach the
rolled characteristics.
