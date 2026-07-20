# Investigators, Personal Horror, and NPC Contact

> Normative when routed from `skills/coc-keeper-play/SKILL.md` (Progressive Context Routing). Load this file before adjudicating the matching case. This is not optional flavor.

## Personal Horror Weaving

Horror lands hardest when it is *this investigator's* horror (p.193-194).

- Session opening protocol: read the character sheet's backstory, pick 1-2
  entries (significant people, treasured possessions, meaningful locations,
  ideology…), and ask the player 3-5 short weaving questions about them
  before the first scene. Record each chosen entry as a structured hook via
  `state.personal_horror_add`.
- When the story presents a natural opening, bind the scene's horror or an
  NPC beat to a recorded hook, then persist actual delivered use with
  `state.personal_horror_mark_woven`. Later, call back to the woven hook as
  payoff.
- Bout-of-madness outcomes may suggest a backstory amendment
  (`corrupt_existing` or `add_irrational`). After the bout, propose the
  amendment to the player in-fiction, negotiate wording together, and record
  acceptance with `state.backstory_corruption_add`. Prefer
  corrupting an existing entry over inventing a new one (p.157).
- Bout table results that reference a Significant Person or Ideology must
  quote the investigator's actual backstory entry, not a generic stand-in.

## Investigator Parameters in Play

Characteristics are not just roll targets — they "suggest ways for them to
act and react during play" (p.30). Let them color your framing when relevant;
none of this is a hard gate or a mandatory call sequence.

- **First impressions (APP / Credit Rating, p.191).** Appearance and status
  precede words when an investigator first meets each stable NPC. Call
  `npc.reaction` once per investigator/NPC pair before its first
  `state.record_npc_engagement`; a second decision returns the frozen receipt
  and cannot shop for a reroll. Every new pair rolls a public D100 against the
  higher of APP or Credit Rating (APP wins an exact tie), with no implicit
  bonus/penalty die. Critical is 1; Extreme is one-fifth; Hard is one-half;
  Regular is at or below the base; fumble is 96–100 when the target is below
  50 and 100 otherwise. The structured achieved level maps to a reaction tier,
  but never rewrites agenda or allegiance: even a critical cannot make a
  committed enemy an ally or waive safety, law, duty, or access controls.
  Supply `context` and `first_impression_realization` from semantic KP judgment;
  no keyword or canned-prose classifier may decide why the NPC reacts. The
  finalizer prints the public die/basis once. The realization is Keeper-only
  portrayal context: work `observable_manner` naturally into action or dialogue,
  while `causal_explanation`, `opportunity_or_friction`, and
  `boundary_preserved` remain in NPC state and must never be quoted as a
  structured player-facing explanation.
  Schema-v1 concealed/override receipts from an already-running campaign stay
  frozen and readable, but every new pair uses the public schema-v2 contract.
- **Live relationships and impression rewards.** The frozen first impression
  is only a starting point. When an action actually matters to this NPC, the KP
  may use `state.npc_update` (with the investigator id) to adjust live
  trust/fear/suspicion, in either direction, based on persona, agenda, concrete
  action, and settled result. Never award trust or a benefit because prose
  merely contains words such as “help” or “gift,” and do not reward every small
  courtesy. A substantive successful action may also earn an NPC-scoped
  one-shot `bonus_die` through `state.exceptional_effect`: its mechanics must
  name exact investigator, skill, `target_id`/localized display name, linked
  `state.npc_update` decision, causal reason, and `until_consumed` boundary.
  The next matching `rules.roll` must carry the same `npc_id` and bonus die,
  then be consumed explicitly before journaling. A roll against another NPC or
  with another skill neither applies nor consumes it. `scene.context` exposes
  active rewards; final output and reports label earning/consumption as
  `【关系/印象奖励】`; there is no separate player-facing
  `【初次反应】` analysis block.
  Persist the NPC's subjective interpretation alongside those numeric fields:
  `state.npc_update` accepts an investigator-scoped `impression_update` with
  caller-authored `summary`, `expectations`, `reservations`, and a bounded
  `memory` (`memory_id`, observed `event`, `interpretation`, `reason`). The
  update reason and source action must be semantic KP evidence; do not derive
  it with keyword scans or a per-turn quota. The first
  `first_impression_realization` seeds this text once for the pair. Later
  meaningful observed/learned behavior may replace the summary and append a
  memory, so the current impression outranks the frozen roll without erasing
  its history. `npc.query` projects only the requested investigator/NPC pair;
  Director and narration receive it as bounded prompt context, never as a hard
  gate or a secret agenda.
- **Lifestyle envelope (Credit Rating, p.45-47, p.95-97).** Call
  `rules.cash_assets` for the tier's cash, assets, and daily spending level.
  Belongings matching the investigator's station are simply owned — no
  purchase roll, no bookkeeping until spending exceeds the daily level.
  Visible means (or their absence) are also social evidence to gatekeepers.
- **Build and scale (p.33, p.105, p.279).** SIZ/Build tell everyone who is in
  the room — whether they can see over a wall, be lifted, or be thrown. A
  maneuver against a target 3+ Build larger is physically impossible, not
  merely hard: narrate the impossibility instead of rolling. Call
  `rules.build_scale` for Table XV scale examples (child to blue whale) and
  the lift/carry/throw verdict between two builds.
- **Occupation (p.97, p.195).** Routine professional tasks simply succeed —
  do not roll an expert for their daily craft. Occupational skills also open
  Contacts: the right profession reaches local resources, and home ground or
  a shared trade eases the way.
- **Age and Luck (p.32, p.90, p.99).** Age shaped the sheet (teenagers roll
  Luck twice and keep the higher; APP and MOV decline from the 40s on).
  Current Luck is a fate-meter — when misfortune needs a victim, the lowest
  current Luck is the legitimate choice.

`scene.context` lists every party member's APP, credit tier, build, age,
occupation, and active madness under `party_investigators`; `director.advise`
plans carry `rule_signal_notes` when a notable credit tier or a depleted Luck
deserves attention.

## Reusable Investigator Selection

When starting a new campaign, restarting a live playtest, or entering
character creation/setup, check the workspace `/.coc/investigators/` library
before starting characteristic generation. If reusable investigators exist,
summarize them in player-facing language with name, occupation, era, and useful
resume context such as last campaign, last modified time, or a one-line
backstory. Let the player choose an existing investigator or explicitly create
a new one. Do not rebuild a character sheet when the player chooses an
existing investigator; load that investigator's `character.json` and create
fresh campaign-local `save/investigator-state/<id>.json` instead.

## Starter Scenario Character Gate

Built-in starter scenarios must not auto-select pre-generated investigators or
move straight into the opening scene. They provide a player-safe background
briefing for character creation, not default player characters. After a
starter scenario is installed, present the scenario premise and ask the player
to create an investigator or choose an existing reusable investigator that
fits the era. AI may draft a complete investigator only after the player asks
for auto-creation, and the player must confirm the final sheet before play
begins.

Exception — explicit one-line quick start: when the player asks for
`coc_starter.quick_start` / `coc-starter quick-start` (scenario + pregen id),
use the shipped pregen and enter the opening scene immediately. Do not offer
quick-start unless the player opts in; ordinary `install` still follows the
gate above.
