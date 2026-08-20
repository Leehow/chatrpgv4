# Memory Protocol

Grep-native memory layer for the COC Story Director and the live KP. The historical design spec is retired; see the tombstone index `docs/status/DIAGNOSIS-LEDGER.md`.

Memory is **never authoritative truth**: HP, clue permissions, timeline, items,
and dice are answered only by `state.*` / `rules.*`. Retrieval results are data;
the live KP judges relevance and realization semantically (Semantic Matcher
Constitution). Overlap scoring over structured entities/tags/cues is data
retrieval, not a semantic decision.

This Director card store is distinct from host-context recovery. Per-turn
startup/compaction recovery uses the typed `session.resume` operation and the
hash-bound `save/continuation/` checkpoint described in `state-schema.md`.
Never make a new model context grep all cards or session history merely to
resume play; retrieve cards later only when the current semantic beat needs
them. The checkpoint directory is a bounded 16-file rebuildable cache; durable
history remains in canonical append-only receipts and memory streams. Resume
also returns current operation opportunities and the stable narrative
opportunity when present, so a compacted host continues the attempt instead of
re-confirming tool parameters or rolling again. Resume runs once per host
context epoch, not once per played turn. Its entire data projection has a fixed
40 KiB canonical budget; the MCP coding-host envelope is separately projected
below 16 KiB. Oversized values become canonical refs plus typed exact-read
cards such as `session.continuation_detail`, while the per-turn checkpoint
stores transcript hashes/lengths/refs rather than duplicating delivered prose.

## Layout
```
.coc/campaigns/<id>/memory/
  cards/player-safe/mem-*.md     # player-visible memory
  cards/keeper-only/mem-*.md     # keeper/system-only
  context-packs/turn-NNNNN.md    # per-turn director context
  index.json                     # retrieval accelerator (valid + invalid_cards)
  session-summaries.jsonl        # append-only session recaps
```

## Card format
Markdown + YAML frontmatter. Frontmatter keys (English, stable): `memory_id`,
`kind`, `scope`, `privacy`, `salience`, `status`, `introduced_at`,
`resolved_at`, `entities`, `tags`, `reactivation_cues`, `scenes`,
`source_events`, `possible_payoff`. Body: short play-language summary.

### Kinds (required, closed namespace)

Every card requires `kind`; clean-slate law: a card without a valid `kind`
fails validation, is listed under `index.json.invalid_cards`, and is never
served by retrieval. No migrations, no dual readers.

| kind | what it records |
| --- | --- |
| `fact` | a stable campaign-local truth the table established |
| `event` | something that happened in play (default for Director plan writes) |
| `npc_relationship` | how an investigator/NPC pair stands and why |
| `unresolved_hook` | an open thread the table planted and expects to matter |
| `foreshadowing` | a keeper-planted signal awaiting payoff |
| `player_preference` | how this player likes to play (pace, tone, focus) |
| `keeper_correction` | a mistake the KP made and the correction adopted |

### Hook lifecycle (`unresolved_hook` / `foreshadowing` only)

`status`: `open` (default) → `resolved` / `paid_off` / `abandoned`, moved only
through `memory.resolve_hook`, which stamps `resolved_at` evidence. `status`
on any other kind is a validation error. `introduced_at` / `resolved_at` are
turn/scene reference strings, not wall-clock time.

## KP tool surface

- `memory.search` — filter by `kinds` / `statuses` / entities / cues / tags on
  top of the existing overlap scoring. Results always carry `privacy` labels;
  `view=keeper` (default) may see keeper-only cards, but narration projection
  still obeys the normal secrecy boundaries.
- `memory.write` — typed card write, idempotent via `decision_id`.
- `memory.resolve_hook` — hook lifecycle transition, idempotent via
  `decision_id`; re-resolving into the same status is a no-op receipt.

The Director consumes the same store: `director.advise` returns advisory
`callback_candidates` (open hooks/foreshadowing overlapping the current scene,
each with a reason). Adopt, modify, or ignore them; they never gate play.

## Grep examples
```
grep -R "kind: unresolved_hook" memory/cards
grep -R "status: open" memory/cards
grep -R "entities:.*ada-king" memory/cards
```

## Write triggers (don't write too often)
1. player expresses preference/fear/hypothesis → `player_preference` (or `fact`)
2. player spends big Luck or pushes a roll → `event`
3. NPC attitude changes → `npc_relationship`
4. critical clue understood/misunderstood → `fact` / `event`
5. irreversible choice → `event`
6. trauma/insanity/major wound → `event`
7. foreshadow set → `foreshadowing` / `unresolved_hook`; paid off → `memory.resolve_hook`
8. the player corrects a KP mistake, or the KP notices its own drift, and the
   correction is adopted → `keeper_correction` (write once, at adoption time,
   not on every reminder)

`player_preference` and `keeper_correction` are written when the signal is
**explicit and durable** (stated preference, accepted correction), never
inferred from one-off keyword hits. The KP decides semantically when to write;
this protocol only suggests triggers — there is no fixed per-turn memory
pipeline.
