# Module Graph extraction protocol

## Purpose

Compile a bounded source section into one candidate graph shard. This protocol
was checked against short linear investigations, location sandboxes, political
missions, time loops, multi-era scenarios, anthologies, and multi-volume
campaigns. It preserves facts needed by later Keeper projections without
turning the graph into a fixed story pipeline.

## GraphShard shape

```json
{
  "contract_id": "coc.module-graph-shard.v2",
  "schema_version": 2,
  "module_id": "module-semantic-id",
  "section_id": "section-semantic-id",
  "aspects": ["structure", "world", "direction"],
  "evidence_span_ids": ["span-example-page-1-block-1"],
  "node_refs": ["npc-defined-in-an-earlier-shard"],
  "coverage": {
    "structure":"accepted", "world":"partial", "actors":"accepted",
    "relationships":"partial", "events":"accepted", "knowledge":"partial",
    "causal":"partial", "mechanics":"unresolved", "assets":"absent",
    "direction":"partial"
  },
  "nodes": [{
    "node_id":"scene-example", "node_kind":"scene", "name":"Example",
    "visibility":"player-safe", "aliases":[], "summary":"bounded summary",
    "evidence_span_ids":["span-example-page-1-block-1"],
    "properties":{}
  }],
  "claims": [{
    "claim_id":"claim-example-occurs-at-place",
    "subject_id":"scene-example", "predicate":"occurs-at",
    "object":{"node_id":"location-example"},
    "truth_status":"authored-fact", "visibility":"keeper-only",
    "evidence_span_ids":["span-example-page-1-block-1"],
    "asserted_by_ids":[], "known_by_ids":[]
  }],
  "relations": [{
    "relation_id":"relation-example-occurs-at-place",
    "relation_kind":"occurs-at", "from_node_id":"scene-example",
    "to_node_id":"location-example", "claim_id":"claim-example-occurs-at-place"
  }]
}
```

Omit `node_refs` when empty. Cite only span IDs supplied in the evidence view;
the model never emits source IDs, page hashes, or grep anchors. Every node and
claim cites its own evidence. `assemble-shard` deterministically closes the
root evidence union before validation, so root scope is not semantic model
authority. Every claim `object` contains exactly one `node_id`; scalar source
facts belong in node `properties`. Do not add keys outside this contract.

Every node ID is namespaced by its exact kind: `<node_kind>-<semantic-slug>`.
This includes one-person names (`npc-kloppe`, never bare `kloppe`).
All identifiers use lowercase ASCII kebab-case only. Keep Chinese characters,
diacritics, punctuation, and display wording in labels or properties rather
than mixing them into IDs.

Preserve source terminology for retrieval. If `name` is translated,
romanized, normalized, or summarized instead of using the exact source term,
put the exact source-language wording in `aliases`. Do not force a source
language out of the graph.

## What to extract

Use the frozen kinds rather than inventing source-shaped labels. Preserve the
source heading or label in `properties.source_label` when useful.

- publication: source documents, editions, variants, collection members,
  supplements, handout/map/portrait packs;
- structure: playable units, chapters, scenes, beats, optional sidetracks,
  opening and ending units;
- world: locations and containment, routes and travel times, eras, factions,
  institutions, objects, artifacts, vehicles, hazards, cultures and concepts;
- actors: NPCs, creatures, investigator templates, identities, disguises,
  membership, control, allegiance, opposition, possession and presence;
- events: authored history, live schedules, deadlines, journeys, rituals,
  branching events, time-loop resets and retained memory;
- knowledge: facts, beliefs, rumors, lies, secrets, clues, questions,
  conclusions, reveal sources and contradictions;
- causal: quests, named outcomes, scoped requirements, bypasses, effects,
  threats and clocks;
- mechanics: custom rules, checks, damage/SAN, procedures and steps;
- assets/direction: handouts, maps, portraits, read-aloud purpose, tone,
  content warnings, improvisation limits, endings, aftermath and rewards.

Do not create nodes for scalar decoration that is always consumed with its
owner. Use `properties` for source labels, tags, numeric authored values, and
small presentation attributes. Use a node when the thing has identity, can be
queried independently, participates in several relations, or has its own
temporal/visibility/source lifecycle.

`quest` is reserved for an action-shaped objective the investigators may be
offered, adopt, or close. A villain's plot, ritual plan, invasion sequence, or
threat escalation is a `procedure`, `event`, `threat`, and/or `clock` graph.

## Claims and epistemic status

- `authored-fact`: the source presents this as module/world truth.
- `authored-belief`: one actor believes it; fill `known_by_ids` and normally
  use a `believes` relation.
- `authored-rumor`: the source presents it as circulating, unverified report.
- `authored-lie`: the source explicitly says the actor/information is false.
- `inferred-candidate`: a useful interpretation not stated as fact. Keep it
  keeper-only and never use it to create a hard requirement.

Different assertions about the same subject coexist. Never overwrite a rumor
or belief with objective truth, and never collapse a public version and Keeper
version into one string.

Truth status belongs to the proposition, not automatically to its delivery.
If Mary factually says "I am looking for my cat" while lying, model two
meanings: the speech/delivery happened (`authored-fact`), while Mary `asserts`
the search proposition with `authored-lie`. A clue that detects the lie
contradicts the false proposition, not the fact that the words were spoken.

When a paragraph gives both folklore/rumor and a Keeper-only correction, make
separate nodes or claims with separate visibility/truth. The revealable node's
name, summary, aliases, and properties contain only the discoverable version;
the correction remains in keeper-only graph material.

## Ordering and collections

These relations are deliberately distinct:

- `print-precedes`: document order only;
- `play-precedes`: source-supported recommended/required play order;
- `triggers`: one event causally creates another situation;
- `independent-from`: anthology or sidetrack members are separate playable
  units even when printed as consecutive chapters;
- `hands-off-to`: a terminal playable unit explicitly transfers to another.

Do not infer any one of them from another. In particular, chapters in a
sandbox may be printed in a common route while remaining freely selectable.
If the source explicitly presents a named sequence, record adjacent
`print-precedes` edges so ordering survives merge and search; array position is
not a graph fact. This still does not authorize `play-precedes`.

An authored transition that happens only after a condition is not necessarily
caused by that condition. Model the condition as an outcome-scoped requirement
and the chapter transition as `hands-off-to` when applicable. Use `triggers`
only when the source states that the subject causally produces the target.

## Causal requirements

Represent a requirement as its own node when it affects an outcome. Put the
following structured fields in `properties`:

```json
{
  "gate": "hard|soft",
  "applies_to_outcome_id": "outcome-semantic-id",
  "method_domain": "semantic-method-domain",
  "required_fact_ids": ["fact-or-claim-semantic-id"],
  "bypass_affordance_ids": [],
  "outcome_ceiling_when_missing": "semantic-outcome-id"
}
```

Only source/rule invariants are hard. Recommended sequence, common method,
uncertain OCR, missing sections, and extractor assumptions are soft,
`unresolved`, or absent.

## Relation discipline

- `uses-rule` means an actor, procedure, or scene invokes an authored game
  rule/check. A transformation scheme, ritual, or scientific process is world
  procedure, not a game rule; represent its steps, products, conditions, or
  effects instead.
- Separate where an event happens from where evidence about it is found. Use
  `occurs-at` for the event location and `discoverable-at` for a clue's access
  point. Do not make a jail cell `present-in` a distant sacrifice merely
  because a prisoner can witness it from there.
- `delivered-by` runs from information/clue to the actor or asset delivering
  it. `discoverable-at` runs from clue to location. Direction is part of the
  relation's meaning and must match the bound Claim.
- `worships` carries explicit devotion from an actor, creature, faction, or
  organization to a deity/concept. Sacrifice or worship is not generic
  `supports`.

## Section workflow

1. Identify the section's real role. A heading called "chapter" may be an
   independent scenario, appendix, historical sidetrack, or campaign leg.
2. Apply `default_visibility` first. Change an item to `player-safe` only when
   its exact source span is explicitly approved as player-safe; use
   `revealable` only for authored material that play can earn.
3. List semantic entities already known from the packet. Reuse their exact IDs
   through `node_refs`.
4. Extract source-grounded nodes before relations. Use the smallest useful
   number of nodes; do not turn every sentence into an entity.
5. Extract assertions with truth/visibility and exact evidence. Keep scalar
   facts in the owning node's properties.
6. Add one relation for every node-to-node claim. Its relation kind and
   endpoints exactly equal that claim's predicate, subject, and object.
7. Put evidence directly on every node and claim. Root evidence scope is
   machine-assembled later and does not replace these citations.
8. Account for all ten coverage domains. Only packet-declared `aspects` may be
   `accepted`, `partial`, or `absent`; every undeclared domain is exactly
   `unresolved` because it was not reviewed. Within declared aspects, `absent`
   requires evidence that the domain is not present. `unresolved` is success
   when the supplied section cannot answer that domain.
9. Return one bare JSON object for deterministic validation.

## Reject these shortcuts

- a graph containing only scenes, NPCs, clues, and quests;
- generic node kinds or relations outside the contract;
- copying array/TOC order into a causal or hard-gate edge;
- invented NPC stats, ritual steps, travel times, rewards, or handout text;
- one node that merges a character's surface identity, secret identity, and
  separate creature form without authored identity relations;
- a player-safe node/property that contains Keeper-only truth;
- unknown evidence span IDs or any model-created source IDs, anchors, digests;
- a non-ASCII, mixed-script, snake-case, or otherwise non-kebab identifier;
- a node or claim with no direct evidence citation;
- claiming whole-module coverage from one section shard.
