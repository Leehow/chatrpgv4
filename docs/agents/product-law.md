# Keeper product law

Read before changing or reviewing Keeper behavior, rules/state boundaries, prompts, semantic contracts, identifiers or their acceptance evidence. These are binding product laws across hosts.

Paths and commands below are relative to the repository root unless absolute. Read only this route when the task requires it; it does not expand authorization.

## Keeper Toolbox Architecture

The live Keeper drives every turn, choosing semantically from canonical skills
and the one registry; there is no fixed turn pipeline:

```bash
uv run --frozen python plugins/coc-keeper/scripts/coc_toolbox.py list
uv run --frozen python plugins/coc-keeper/scripts/coc_toolbox.py <tool> --root . --campaign <id> --json '<args>'
```

Exactly four tool-enforced rules are hard; everything else is advisory
`warnings` / `hints`:

1. `rules.*` owns deterministic dice and HP/SAN/skill arithmetic; the KP never
   invents or adjusts results.
2. `state.*` owns transactional, idempotent writes using `decision_id`; never
   hand-edit a live save.
3. Module truth is read-only. Keeper-only material stays `secret: true` and is
   revealed only through play.
4. After a played turn settles checks, player output is released only from one
   hash-bound finalization receipt created after all rule/state writes. It
   closes every settled check with causal fictional realization or an explicit
   secrecy-preserving concealed disposition, and renders every required public
   roll and visible mechanical change exactly once from authoritative sources.

Rule 4 is only a settled-output completeness boundary. It is not a prose judge
or permission to require Director, Storylet, NPC, or narration calls; rerun
mechanics; reveal secrets; or allow, deny, force, reorder, or suppress actions,
scenes, or clues. Do not add another blocking narrative gate. Scene transitions,
clue delivery, Storylet eligibility, pacing, and prose review stay advisory.

## COC Keeper Product Constitution

These product laws bind code, docs, review, and validation; only explicit user
direction may change them.

### The KP Is The Product

- The canonical KP is an agent that understands the player and runs the table:
  intent, world causality, framing, NPC agency and portrayal, clues, pacing,
  personal horror, consequences, and final narration.
- Tools support the KP. A rules/state shell wrapped in prose is not an
  acceptable Keeper.
- The KP chooses methods and final fiction. Never replace that judgment with a
  fixed call order, workflow, quota, or second orchestration engine.

### Player-Visible Language

- Every player-visible string uses active `play_language` (default `zh-Hans`):
  narration, dialogue, delivered handouts, rolls, visible mechanics, choices,
  prompts, and recaps.
- Prose is **written in the player's language, not looked up**. `play_language`
  is a free-form tag, never an enum of supported languages, and there is no
  `language_profile` label bundle — it was removed after every one of its keys
  proved to have zero readers. Do not add one back; see
  `docs/status/play-language-layer-is-unnecessary.md`.
- The two surviving tables are not exceptions waiting to be cleaned up.
  `DEFAULT_LOCALIZED_TERMS` holds rulebook terminology, where cross-turn
  consistency is the point. `TABLE_MECHANICS_LABELS` holds chrome for
  deterministic mechanics blocks, which the host composes and hashes into
  `rendered_text_sha256` — the Keeper must not author them, so an output
  instruction cannot reach them.
- Source modules and machine IR may remain in source language. Prefer
  `localized_text` / `localized_terms`; otherwise faithfully render the full
  substance in table language. Do not append source English unless asked.
- JSON keys, IDs, enums, tool envelopes, and audit labels are machine data, not
  finished prose.
- Only diegetic foreign speech may remain foreign, governed by the
  investigator's Language skills and `coc-keeper-play` guidance.

### Semantic Matcher Constitution And Advisory Authority

- Meaning-bearing decisions—player intent, NPC hostility, clue relevance,
  Storylet fit, report coverage, and prose quality—must use semantic reasoning.
  Never infer them from keyword hits, regexes, exact free-prose fragments, or
  fixed phrase lists.
- Valid inputs include structured enums, IDs, tags, booleans, rules data, and
  recorded semantic-router/LLM results with reasons. If only prose exists, call
  a semantic compilation step; do not add a keyword list.
- Director, narrative, enrichment, Storylet, NPC, pacing, and language methods
  return reasoned facts or suggestions. The KP may adopt, modify, or ignore
  them. They never allow, deny, force, suppress, reorder, or replace the KP or
  player, and their absence never blocks play.
- The KP owns interpretation, causality, pacing, and prose; rules tools own
  arithmetic and state tools persistence. Raw outputs are data. Fiction may
  portray a false report but never alter authoritative results/state.
- Existing string-heuristic fallbacks are technical debt and must not be copied.

### Controlled Improvisation Becomes Campaign Canon

- Module/rulebook source stays read-only, but the KP may semantically create
  campaign-local identities, histories, motives, events, clue interpretations,
  hooks, and ambiguous hints—even when they appear to conflict with source or
  earlier fiction.
- Preserve both assertions and provenance as structured
  `continuity contradiction` / `narrative debt` in the best-fitting campaign
  records. What becomes canon immediately is that each assertion occurred, not
  that either is final objective truth.
- Carry the debt into later causality and resolve or deepen it semantically.
  Never use keyword-to-excuse mappings, silent retcons, or deletion.
- Dice/state authority and secrecy remain hard boundaries. Contradiction never
  permits numeric mutation or secret dumping; a guess is not canon by itself.

### Player Knowledge Boundary (KP Owns The Intercept)

Players may guess, speculate, or bait a spoiler. **KP owns the intercept.**

- Track investigator knowledge from player-visible fiction, sheet, public
  rolls, journals, and discovered clues—not keywords.
- Separate an achievable attempt from a player's unearned assertion about room
  contents, NPC secrets, module layout, or unrevealed clues. Never enact the
  assertion merely because the player said it.
- A lucky correct guess remains a guess; discovery must still be earned.
- Intercept clearly, preferably in play voice with light Table Wit rather than
  an OOC scold.
- Do not ban players from guessing. Ban the KP from treating a guess as
  established knowledge or permission to reveal module truth.

### Exceptional Results Must Change Play

- A critical, fumble, or failed pushed roll closes only when it causes a
  source-bound, auditable effect that changes play: authoritative resource
  change, scoped bonus/penalty, bounded condition/access change, relationship
  or threat change, or a concrete opportunity/danger/event.
- The KP selects the effect semantically from method, stakes, scene, portrayal,
  and result. Never map skills, prose keywords, or result labels to canned
  rewards. The causal connection must be player-visible.
- Elapsed time or a generic flag counts only when it fires a real deadline,
  restriction, threat, resource window, or downstream opportunity.
- Apply the effect through canonical rules/state tools before finalization,
  render it once, bind it to the exact roll, and preserve it in report evidence.
  `turn.finalize` fails closed when a qualifying roll lacks that binding.

### NPC Contact, Multi-NPC Scenes, And Relationships

- Each investigator/stable-NPC pair's first material meeting uses one public
  D100 check against the higher of APP or Credit Rating. Record the source and
  freeze the receipt; never reroll-shop.
- Agenda, relationship, duty, safety, and causality constrain realization. A
  critical cannot erase committed hostility; critical/fumble outcomes require a
  concrete benefit/cost, not an attitude adjective.
- Render the one-time public block with APP, Credit Rating, governing value,
  roll, and level; preserve it in canonical roll and report evidence.
- A scene may contain zero, one, or many materially acting NPCs. Never collapse
  several voices, receipts, engagements, or effects into a single-NPC turn.
- Each investigator/NPC pair owns its identity, reaction receipt, engagement,
  causal realization, and first-contact block. This is capacity, not a crowd
  quota.
- Later relationships change through semantic KP judgment and canonical NPC
  state/effects. Record investigator, NPC, source, reason, applicability, and
  end/consumption. Never use prose keywords or quotas; the first receipt stays
  immutable.

## Model-Facing Identifier Law (Semantic IDs Only)

Large models mis-transcribe random identifiers — uuids, hex digests, hash
ids, base62 noise — at very high rates. This is a protocol-design law, not
a prompt-tuning problem; it binds code, schemas, prompts, worker
instructions, and reviews on every host.

- Any identifier a model must read, copy, echo, choose, or emit on a
  contract surface is a **semantic id**: human-readable, meaning-bearing
  tokens (kind, entity slug, page scope, ordinal) that stay stable across
  retries. Example: `deepen-handout:small-card-1:page-13`, never
  `job-75caedf23af6`.
- Random digests are **machine-internal integrity evidence**. Code owns
  their generation, attachment, and verification end-to-end. A protocol
  must never require a model to relay a random id between messages: the
  machine re-attaches identity after the model's semantic payload, and
  anti-drift is enforced by digest checks in code — never by asking the
  model to echo opaque bytes.
- Where an id is both machine-created and model-visible (job ids, dispatch
  keys, lease ids, packet ids), it is semantic by construction with a
  designed namespace — kind prefix + entity slug + scope + revision
  ordinal — so ids cannot collide across kinds, campaigns, or asset roots.
  Uniqueness comes from namespace architecture, not randomness.
- New contracts, schemas, prompts, and instructions must not introduce
  random-id transcription for models. Existing surfaces that demand it
  (`job-<hex>` ids, `source-lease-<hex>`, hash-derived dispatch keys,
  byte-equal receipt echoes) are technical debt: convert the lane
  systemically when it is touched, and never copy the pattern into new
  work.
