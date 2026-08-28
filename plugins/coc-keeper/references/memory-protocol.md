# Memory Protocol

Memory layer for the live KP under schema generation `temporal-memory-1`.
The canonical path is the Git-backed temporal memory: Git immutable history,
a rebuildable SQLite projection, and canonical advisory temporal records under
`memory/temporal/`. Legacy Markdown cards are immutable historical evidence,
not a runtime store: only the explicit non-destructive converter or
report/export evidence path may read them. They remain on disk and are never
silently migrated or deleted.

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
history; it returns the bounded temporal capsule described below, and temporal
assertions are retrieved later only when the current semantic beat needs them.

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
schema campaigns and legacy card evidence stay read-only: no implicit,
in-place, live-runtime, or automatic import, migration, fallback, or cleanup.
The explicit non-destructive historical converter
(`coc_legacy_memory_convert.py`) may read preserved evidence only to create a
fresh temporal target; it never mutates source bytes or evidence.

## Legacy Markdown card store (non-canonical technical debt)

This non-canonical legacy technical debt is immutable historical evidence, not
a normal or fallback memory path: `memory/cards/`, `memory/context-packs/`,
and `memory/index.json`. The
retired `memory.search`, `memory.write`, and `memory.resolve_hook` operations
are no longer registered on any live surface, and no live KP, Director, or
runtime reads or writes card-era data.

Campaigns, cards, context packs, indexes, logs, and conversion evidence remain
on disk byte-preserved: no in-place migration, dual read, cleanup, or deletion
is permitted. The only permitted card reads are the explicit non-destructive
historical converter (`coc_legacy_memory_convert.py`), which creates a fresh
temporal target campaign, and the report/export evidence path. Neither path
mutates its legacy source. All live play uses the canonical temporal operations
above.
