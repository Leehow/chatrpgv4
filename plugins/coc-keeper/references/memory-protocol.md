# Memory Protocol

Memory layer for the live KP under schema generation `temporal-memory-1`.
The canonical path is the Git-backed temporal memory: Git immutable history,
a rebuildable SQLite projection, and canonical advisory temporal records under
`memory/temporal/`. The older grep-native Markdown card store is retained at
the bottom of this document as explicitly **non-canonical legacy technical
debt**; the historical card-era design spec is retired (see the tombstone
index `docs/status/DIAGNOSIS-LEDGER.md`).

Memory is **never authoritative truth**: HP, clue permissions, timeline,
items, and dice are answered only by `state.*` / `rules.*`. Temporal memory
answers "who knew, believed, misremembered, or forgot what, when, on which
timeline" — it is advisory data for the KP. Retrieval is deterministic
narrowing over structured fields (subject/knowers, timeline, valid-time turn
intervals, entities, scene, privacy); relevance and realization are the KP's
semantic judgment (Semantic Matcher Constitution). No layer of this protocol
uses keyword or phrase rules to decide meaning.

This memory system is distinct from host-context recovery. Per-turn
startup/compaction recovery uses the typed `session.resume` operation and the
hash-bound `save/continuation/` checkpoint described in `state-schema.md`.
Resume never makes a new model context grep the whole memory store or session
history; it returns the bounded temporal capsule described below, and cards
or assertions are retrieved later only when the current semantic beat needs
them.

## Canonical layers (`temporal-memory-1`)

- **Git is the immutable history.** Every `turn.finalize` commits canonical
  state, logs, receipts, and memory records to the campaign's sidecar bare
  repository (`.coc/repos/campaigns/<campaign-id>.git`). History is never
  rewritten: no reset, no force push, no history-mutation code path. Forks
  and confluences create new branches; old commits stay byte-identical.
- **SQLite is a rebuildable projection.** `memory/history-projection.db`
  serves `history.query` / `history.diff` reads. It is a deletable,
  rebuildable cache derived deterministically from Git — never a second
  source of truth. If it is corrupt or missing it is rebuilt from Git,
  byte-equivalent. **No migration, no dual reader, no fallback** (clean-slate
  `temporal-memory-1`).
- **`memory/temporal/*.jsonl` are the canonical advisory temporal records.**
  Episodes, subjects, entities, assertions, adjudications, and backlog live
  as rebuildable JSONL tracked in the Git tree (schema generation
  `temporal-memory-1`, closed field sets, unknown fields fail validation).
  Records carry **no wall-clock fields**; transaction time is projected by
  code from the source commit, so replay is byte-equivalent.

## Canonical normal operations

| Operation | Contract |
| --- | --- |
| `history.query` | Read the committed state history at one timeline turn: full authoritative snapshot from the projection. Read-only; semantic timeline/turn selectors only. |
| `history.diff` | Structured leaf-level diff between two settled turns (same or different timelines). Read-only. |
| `memory.recall` | Deterministically narrow canonical temporal assertions by subject knower, timeline, valid-time turn, entities, scene, and privacy. Returns advisory candidates with memory state, valid interval, and provenance; never keyword rules. |
| `memory.adjudicate` | Record the KP's accept / modify / reject decision on one candidate (`player_assertion`, extraction candidate, contradiction). Idempotent via `decision_id`; nothing is ever edited or deleted — acceptance writes a new confirming assertion. |
| `timeline.fork_request` | Record the KP's intent to fork the worldline at one settled turn (receipt only; active timeline unchanged). Idempotent via `decision_id`. |
| `timeline.fork_confirm` | Create the new timeline branch at the stored fork point and make it active; the parent timeline stays immutable. |
| `timeline.confluence_query` | Enumerate the complete conflict list for merging two timelines: hard-state classes (deterministic resolver diff) and KP-semantic classes. |
| `timeline.confluence_confirm` | Land the third two-parent timeline with a disposition and receipt for every conflict. Idempotent; dice, deaths, one-time effects, and consumed resources are never double-settled. |

Players never call tools and never see Git terminology; a natural-language
rewind/fork request ("if we hadn't gone into the basement…") is interpreted
and confirmed by the KP semantically, then lands through
`timeline.fork_request` → `timeline.fork_confirm`.

## Subjects, entities, and scopes

- Subject kinds: `world` / `investigator` / `npc` / `party` / `keeper` /
  `player`. `world` / `party` / `npc` subjects are campaign-scoped;
  `investigator` / `keeper` / `player` subjects may be cross-campaign.
- Entities are campaign-scoped by default; a cross-campaign entity requires
  an explicit `same_entity_as` binding.
- Resolution is exact-match only: the same name resolving to multiple ids is
  an ambiguity error, **never** an automatic merge. Cross-campaign identity
  (the same investigator living through multiple modules) exists only through
  explicit `same_subject_as` / `same_entity_as` edges. Same-id rewrites are
  limited to byte-equivalent replay or sanctioned immutable extension;
  silently replacing identity, campaign scope, or alias sets fails closed.
- Assertions are campaign-scoped (bound to campaign + timeline) or
  cross-campaign (both empty, `mem-xc-` domain). Scope violations are
  validation errors.

## Privacy tiers

- Tiers: `player_safe` / `keeper_only` / `system_only`.
- Visibility is enforced by deterministic code, not KP discretion: the player
  view returns only rows whose own privacy is exactly `player_safe`; a
  `suppressed` assertion is always keeper-only.
- `player_assertion` records are always player-safe (their subject must be a
  player) — the player said it, so hearing it back leaks nothing.
- Secret-bearing keeper-only rows never reach player-visible projections
  through any recall or view path. The KP still owns not *narrating*
  secrets; the code owns not *handing them over*.

## Player assertions and the knowledge boundary

Anything the player says about the world ("the curator already knew me") is
recorded at most as a `player_assertion` candidate — never as world fact or
character memory. The KP owns the intercept (Player Knowledge Boundary): a
lucky correct guess is still a guess; discovery must be earned. Only
`memory.adjudicate` can promote a candidate into knowledge, belief, or
world-event assertions, and only when play earned it.

## Supersession and narrative debt

Old cognition is never deleted and never edited in place. Closing an
assertion goes through sanctioned supersession: `valid_until_turn` and
`superseded_by` appear as a pair on the same id. Contradictions are preserved
as `contradicts` / `confirms` edges — both sides stay queryable as narrative
debt for the KP to digest in later causality. Self-references and dangling
references are validation errors.

## Episodes and the extraction backlog

Every finalized turn commit deterministically produces one episode
(`episode-<campaign>-<timeline>-turn-<n>`) bound to its commit and
finalization receipt; replay requires byte-equivalent records and evidence or
fails closed. Background semantic extraction proposes candidate assertions on
top of episodes; it never blocks `turn.finalize`. Extraction failures land in
an explicit backlog (`pending` / `recovered` / `abandoned`) that is itself
rebuildable from Git. Candidates are data: only the KP's `memory.adjudicate`
turns them into memory.

## Semantic IDs vs machine hashes

Model-facing identifiers are semantic, stable, and meaning-bearing
(`mem-…`, `episode-…`, `tl-…`, `subject-…`, `entity-…`, `confluence-…`,
`transfer-…`, `backlog-…`; lowercase kebab, ≤128 chars). Commit SHAs and
record digests are machine-internal integrity evidence: code generates,
attaches, and verifies them end-to-end, and no model is ever asked to
transcribe or relay them. History tools accept semantic timeline/turn
selectors, never a commit hash.

## Bounded resume capsule

`session.resume` returns a bounded temporal capsule instead of loading
history: a hot projection of the active timeline's newest effective
assertions and recent episodes, privacy-projected per viewer, with a fixed
budget, explicit `authority: advisory`, `hard_gate: false`, and explicit
status when no finalized history exists yet. Machine-internal commit identity
never enters the capsule. Warm/cold tiers (deterministic index narrowing,
`summary` assertions with `covers_commits` auditable compression) are pulled
later only when a semantic beat needs them — the full history is never
dumped into a model context.

## Evidence preservation

A campaign's Git history, `memory/` (including `memory/temporal/`), logs,
receipts, and exported reports are the sole evidence for battle reports, bug
diagnosis, and acceptance. Never delete a campaign, its memory, its logs, or
its playtest artifacts after a run — start a new campaign id instead. Old
schema campaigns stay read-only: no import, no migration, no cleanup.

## Legacy Markdown card store (non-canonical technical debt)

The Markdown card store below is **not** an alternate normal memory path.
Its typed model-facing surfaces — `memory.search`, `memory.write`,
`memory.resolve_hook` — have been **retired**: they are no longer registered
in the toolbox, the operation archive, or any generated policy surface, so a
live KP cannot discover or invoke them. The deterministic `coc_memory.py`
internals (card schema, retrieval, hook lifecycle) remain available to
non-model callers only — the Director's advisory callback candidates still
read open hooks through them. Existing campaign card files stay on disk
read-only: no migration, no dual reading, no cleanup. New play writes
canonical temporal memory only (the operations above); do not build new flows
on the card store, and do not bridge or dual-read between the two stores. The
material below documents the retired legacy formats for reading old campaign
evidence.

### Legacy layout
```
.coc/campaigns/<id>/memory/
  cards/player-safe/mem-*.md     # player-visible memory
  cards/keeper-only/mem-*.md     # keeper/system-only
  context-packs/turn-NNNNN.md    # per-turn director context
  index.json                     # retrieval accelerator (valid + invalid_cards)
  session-summaries.jsonl        # append-only session recaps
```

### Legacy card format
Markdown + YAML frontmatter. Frontmatter keys (English, stable): `memory_id`,
`kind`, `scope`, `privacy`, `salience`, `status`, `introduced_at`,
`resolved_at`, `entities`, `tags`, `reactivation_cues`, `scenes`,
`source_events`, `possible_payoff`. Body: short play-language summary.

### Legacy kinds (required, closed namespace)

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

### Legacy hook lifecycle (`unresolved_hook` / `foreshadowing` only)

`status`: `open` (default) → `resolved` / `paid_off` / `abandoned`; while the
card era was live, transitions moved through the retired `memory.resolve_hook`
surface, which stamped `resolved_at` evidence. Historical cards keep that
stamped evidence read-only; nothing moves it now. `status`
on any other kind is a validation error. `introduced_at` / `resolved_at` are
turn/scene reference strings, not wall-clock time.

### Legacy tool surface (retired)

The former typed operations — `memory.search` (structured filter/privacy
view), `memory.write` (typed idempotent card write), and `memory.resolve_hook`
(hook lifecycle transition) — are no longer registered anywhere on the model
surface. Use canonical `memory.recall` / `memory.adjudicate` instead; read
historical cards directly from disk only when auditing old campaigns.

The Director consumes the same store: `director.advise` returns advisory
`callback_candidates` (open hooks/foreshadowing overlapping the current scene,
each with a reason). Adopt, modify, or ignore them; they never gate play.

### Legacy grep examples
```
grep -R "kind: unresolved_hook" memory/cards
grep -R "status: open" memory/cards
grep -R "entities:.*ada-king" memory/cards
```

### Legacy write triggers (don't write too often)
1. player expresses preference/fear/hypothesis → `player_preference` (or `fact`)
2. player spends big Luck or pushes a roll → `event`
3. NPC attitude changes → `npc_relationship`
4. critical clue understood/misunderstood → `fact` / `event`
5. irreversible choice → `event`
6. trauma/insanity/major wound → `event`
7. foreshadow set → `foreshadowing` / `unresolved_hook`; paid off → lifecycle
   supersession recorded as temporal assertions (`memory.adjudicate`)
8. the player corrects a KP mistake, or the KP notices its own drift, and the
   correction is adopted → `keeper_correction` (write once, at adoption time,
   not on every reminder)

`player_preference` and `keeper_correction` are written when the signal is
**explicit and durable** (stated preference, accepted correction), never
inferred from one-off keyword hits. The KP decides semantically when to write;
the protocol only suggests triggers — there is no fixed per-turn memory
pipeline. In canonical temporal play the same signals are carried by the
assertion kinds (`player_preference`, `keeper_correction`, `player_assertion`,
…) with provenance and adjudication instead of free-standing cards.
