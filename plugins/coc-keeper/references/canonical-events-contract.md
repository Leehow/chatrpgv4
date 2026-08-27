# Canonical Events Contract (`coc-events-1`)

Normative reference for the unified campaign event stream. Implementation:
`plugins/coc-keeper/scripts/coc_canonical_events.py` (envelope validation,
type registry, per-type payload schemas, semantic-ID construction,
sequence-allocation seam). Stream file `.coc/campaigns/<id>/logs/canonical-events.jsonl`
and its append path land in the following plan task; this document freezes
the schema they must satisfy.

Standing law recap:

- `state.*` / `rules.*` stay authoritative. Canonical events are **derived
  evidence** for projections (battle report, history query). No event-replay
  state restoration.
- Clean-slate generation `coc-events-1`: no migrations, no dual readers, no
  compatibility fallbacks. Historical events are immutable; upcasting happens
  read-side only.
- Event types come from emission-point code. Never keyword-, regex-, or
  prose-classified (semantic matcher constitution).
- Model-visible identifiers are semantic ids. Random digests stay
  machine-internal; models never transcribe opaque bytes.
- `privacy="secret"` rows never reach player-facing surfaces.

## Envelope

CloudEvents-shaped, no SDK dependency. Exactly twelve attributes; the field
set is closed — unknown fields fail validation (`UnknownFieldError`), every
attribute is required.

| Field | Type | Invariants |
| --- | --- | --- |
| `specversion` | string | Always `"coc-events/1"`. Any other value fails closed. |
| `type` | string | One of the 12 registered types below (`ClosedEnumError`). Past-tense kebab-case. |
| `id` | semantic id | Built by `event_id_for(...)`; grammar `^[a-z0-9][a-z0-9._:-]*(?:-[a-z0-9][a-z0-9._:-]*)+$`, ≤128 chars; MUST start with `<type>-`. |
| `source` | token | Emitting module semantic name, e.g. `coc_operation_kernel.log_roll`. Lowercase `[a-z0-9._-]`; dots expose `module.writer`. |
| `campaign` | token | Campaign slug, e.g. `amaranthine-16`. |
| `timeline` | token | Timeline id; shares the temporal-memory vocabulary (`tl-main`, forks `tl-*`). |
| `turn` | int ≥ 1 | Exact integer (no bool/float). Pre-first-turn opening bookkeeping belongs to turn 1's events. |
| `sequence` | int ≥ 1 | Allocator-stamped ordering position; monotonic per `(campaign, timeline)`, comparable *only within* one pair. Code-assigned, never model-supplied in live play. |
| `game_time` | string ≤400 | Rendered in-fiction clock label at emission (e.g. `day3-morning`). Provenance display only — precise transitions live in authoritative state/payloads, not parsed from here. |
| `privacy` | enum | `public` or `secret` (`PrivacyError` otherwise). Public rows may flow to player-facing projections verbatim; secret rows stay Keeper-side forever. |
| `decision_id` | semantic id | Idempotency key binding the event to the settled transaction/rule receipt decision. Grammar-checked semantic id. |
| `data` | mapping | Typed payload; MUST carry `_v` (payload schema version, currently `1`). Validated against the type's closed schema. |

Integrity digests of a record (`record_digest`) are SHA-256 over sorted-key
compact JSON — machine evidence for verification code, never model-facing ids.

## The 12 Event Types v1

Merge discipline: similar facts share one type; detail demotes to payload
fields instead of spawning types (e.g. `sanity_loss` / `sanity_rewarded`
→ `sanity-changed.delta` sign; belief assert/repeat → `mode`). Each payload's
field set below is closed at `_v=1`: unknown key → fail; present-but-null →
fail (omit the field instead). Required fields marked ✓ in "R".

| Type | Meaningful fact | Payload fields (bold = required) |
| --- | --- | --- |
| `turn-started` | A table turn began | (none beyond `_v`) |
| `player-declared` | Player intent resolved by emitter code | **declared_kind**, choice_ref?, note? |
| `roll-resolved` | A dice check settled | **roll_id**, **check**, **actor**, **result_level**; dice?, target_value?, cause?, effect_refs? |
| `clue-discovered` | A clue reached an investigator | **clue_id**, **discovered_by**; method?, scene_ref?, handout_ref?, note? |
| `scene-moved` | Scene transition committed | **to_scene**; from_scene?, moved_by?, reason? |
| `npc-relationship-changed` | Investigator↔NPC relationship moved | **npc**, **investigator**, **channel**, **after**; before?, reason?, source_roll_id? |
| `belief-asserted` | Hypothesis taken on / repeated | **hypothesis_id**, **holder**; mode?, statement?, evidence_refs? |
| `belief-reframed` | Existing hypothesis recast | **hypothesis_id**, **change**; previous_hypothesis_id?, holder?, reason?, evidence_refs? |
| `memory-written` | Temporal-memory record persisted | **memory_id**, **memory_kind**; subject_refs?, note? |
| `sanity-changed` | SAN delta applied | **investigator**, **delta**, **cause**; before?, after?, source_roll_id? |
| `item-transferred` | Item changed hands | **item**, **from_holder**, **to_holder**; qty?, reason?, source_roll_id? |
| `turn-finalized` | Turn output released via finalization receipt | **finalization_id**; settled_roll_ids?, note? |

Field kinds: semantic-id fields follow the shared grammar (no fixed prefix
enforced — cross-store references match what their owning store mints;
recommended prefixes listed in `RECOMMENDED_REFERENCE_PREFIXES`). `ref`
fields are lowercase tokens ≤128 (entity slugs, scene slugs, channel names).
`text` fields are free short strings ≤400 (player-visible renderings allowed).
`scalar` accepts a JSON number-or-string (dice renderings, prior values).
Enums: `result_level ∈ {critical, extreme, hard, regular, failure, fumble}`,
`mode ∈ {asserted, repeated}`, `moved_by ∈ {kp, player, storylet, rule}`,
`memory_kind ∈ {episode, assertion, summary, hook, transfer, backlog}`.
Lists are duplicate-free semantic-id lists; empty lists allowed where optional.

Privacy expectations: mechanics rows bound to public rolls
(`roll-resolved`, first-contact `npc-relationship-changed`,
public `clue-discovered`) default `public`; Keeper-only causality (hidden NPC
agendas, mythos internals, concealed dispositions), sanity internals when
secrecy-preserving, and any content under active concealment is `secret`.
The KP chooses per emission point; validator enforces only membership.

## Semantic-ID Construction

```
id = f"{event_type}-{campaign}-{timeline}-t{turn}-{slug}"
slug = ordinal_slug(n)           # "occ-01", "occ-02", … per same-type occurrence within the turn
decision_id recommendation = f"{operation}-{campaign}-{timeline}-t{turn}-{token}"
```

Campaign/timeline slugs legitimately embed `-` (e.g. `amaranthine-16`);
identifiers are matched whole-string after deterministic construction —
never dash-split back into parts. Uniqueness comes from namespace
architecture (type × campaign × timeline × turn × occurrence), not randomness.
Code builds these ids; callers copy them out of receipts, never invent them.

## Sequence Rule

Allocation goes through the `SequenceAllocator` interface:

```python
class SequenceAllocator:
    def next_sequence(self, campaign: str, timeline: str) -> int: ...
```

- First call for a fresh `(campaign, timeline)` pair returns `1`; each
  further call advances by exactly 1.
- The file-backed allocator (stream-append task) must persist the cursor in
  the same transaction as the appended line, so a crash can never reissue a
  used sequence.
- Ordering across timelines is deliberately incomparable; use
  `(timeline, sequence)` keys or projection-local joins.
- `build_event` accepts an explicit `sequence` or an `allocator`; supplying
  neither raises `SequenceError`.

## Idempotency Rule (`decision_id`)

Emitters call the event path **only after** the transactional/rules
settlement succeeded. Replay discipline is enforced by
`resolve_duplicate(existing, incoming)`:

- Records agreeing on everything except the allocator-stamped `sequence`
  are the same fact re-emitted → return `existing` untouched (append nothing).
- Same `decision_id` with any other difference (different payload, different
  `id`) → `DuplicateDecisionIdError`; the conflict fails closed rather than
  silently forking one decision into two events.

Storage-level dedupe scans belong to the append task; this function is the
single authority for the comparison semantics.

## Evolution Discipline

- Additive-only within a payload version: new optional fields may appear;
  removing, renaming, retyping, or repurposing requires a new payload `_v`.
- Readers are tolerant: ignore unknown fields only *within* a declared
  higher `_v` they understand, never by skipping their own version's missing
  required fields (validators above stay strict for current data).
- Per-type `_v` travels inside each `data`; different types may evolve at
  different paces.
- Upcasting happens read-side, in projection code needing a normalized shape
  (temporal-memory pattern). Old records are never rewritten on disk.
- New event type: extend the registry tuple + payload tables additively;
  unknown types fail loudly in validators, which keeps the taxonomy honest.

## Worked Examples

### `roll-resolved`

```json
{
  "specversion": "coc-events/1",
  "type": "roll-resolved",
  "id": "roll-resolved-amaranthine-16-tl-main-t12-occ-03",
  "source": "coc_operation_kernel.log_roll",
  "campaign": "amaranthine-16",
  "timeline": "tl-main",
  "turn": 12,
  "sequence": 187,
  "game_time": "day3-late-morning",
  "privacy": "public",
  "decision_id": "skillcheck-amaranthine-16-tl-main-t12-spot-hidden-01",
  "data": {
    "_v": 1,
    "roll_id": "roll-spot-hidden-t12-01",
    "check": "spot-hidden",
    "actor": "subject-investigator-elise",
    "result_level": "hard",
    "dice": "1d100=21",
    "target_value": 60,
    "cause": "searching-the-parish-study",
    "effect_refs": ["clue-diary-page-13"]
  }
}
```

Exceptional-result law satisfied structurally: the roll binds its causal
effects (`effect_refs`) at settlement time, before finalization renders.

### `clue-discovered`

```json
{
  "specversion": "coc-events/1",
  "type": "clue-discovered",
  "id": "clue-discovered-amaranthine-16-tl-main-t12-occ-02",
  "source": "coc_operation_kernel.log_event",
  "campaign": "amaranthine-16",
  "timeline": "tl-main",
  "turn": 12,
  "sequence": 188,
  "game_time": "day3-late-morning",
  "privacy": "public",
  "decision_id": "reveal-amaranthine-16-tl-main-t12-diary-page-13",
  "data": {
    "_v": 1,
    "clue_id": "clue-diary-page-13",
    "discovered_by": "subject-investigator-elise",
    "method": "spot-hidden",
    "scene_ref": "parish-study"
  }
}
```

### `belief-asserted`

```json
{
  "specversion": "coc-events/1",
  "type": "belief-asserted",
  "id": "belief-asserted-amaranthine-16-tl-main-t12-occ-01",
  "source": "coc_operation_kernel.log_event",
  "campaign": "amaranthine-16",
  "timeline": "tl-main",
  "turn": 12,
  "sequence": 189,
  "game_time": "day3-late-morning",
  "privacy": "public",
  "decision_id": "hypothesis-amaranthine-16-tl-main-t12-tunnel-assert",
  "data": {
    "_v": 1,
    "hypothesis_id": "hyp-cult-meets-in-tunnel",
    "holder": "subject-investigator-elise",
    "mode": "repeated",
    "statement": "信仰者通过教堂地下的隧道集会。",
    "evidence_refs": ["clue-diary-page-13"]
  }
}
```

Player-visible statement text rides in zh-Hans (`play_language`); ids and
keys stay machine tokens.

### `turn-finalized`

```json
{
  "specversion": "coc-events/1",
  "type": "turn-finalized",
  "id": "turn-finalized-amaranthine-16-tl-main-t12-occ-01",
  "source": "coc_turn_finalization.append_finalization",
  "campaign": "amaranthine-16",
  "timeline": "tl-main",
  "turn": 12,
  "sequence": 204,
  "game_time": "day3-noon",
  "privacy": "public",
  "decision_id": "finalize-amaranthine-16-tl-main-turn-12",
  "data": {
    "_v": 1,
    "finalization_id": "fin-amaranthine-16-tl-main-turn-12",
    "settled_roll_ids": [
      "roll-spot-hidden-t12-01"
    ]
  }
}
```

`finalization_id` points at the authoritative receipt; the event adds stream
ordering, not a second copy of the receipt body.

## Emitter Contract (for wiring tasks)

- Emit strictly post-settlement; failures inside state/rules writes leave no
  canonical event behind.
- One fact, one event: choose `type` from the 12-token registry at the
  emission site in code; fold detail into payloads, never into prose parsing.
- Assign `sequence` through an allocator atomically with the append (append
  task's responsibility); reuse the same `decision_id` when replaying a
  settled transaction so dedupe collapses it.
