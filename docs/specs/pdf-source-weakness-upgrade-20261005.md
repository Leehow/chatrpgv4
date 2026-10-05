# Source weakness collection and reviewed legacy upgrades

The historical PDF build retained Corbitt's sunlight condition and own-dagger effect in source properties,
but it predated the standardized weakness capability and published no `weaknesses` list. A newer reader
also made that source ask depend on a consumer Mod default. This change fixes both paths under §180.20.
It follows the independent source-weapon repair already integrated as `e10227c78`; it does not replace it.

Every new PDF task now carries the existing npc/creature weakness law, including when the consumer is off
or no consumer package is installed. The reader reviews the original actor pages, the shared checker
validates entries, publication preserves them, and build provenance binds them as source facts. Consumer
instructions and table-established additions keep their ordinary Mod switches. Source facts do not add
clue discovery, player knowledge, possession or executable combat rules.

## Explicit legacy upgrade

`module.source.upgrade` defaults to preview. A reviewed artifact states its exact base graph hash, source
fragment review, existing field witnesses and citations. The kernel checks those witnesses and the common
weakness schema. It does not infer semantics from names, module titles or legacy property keywords, and
does not claim that an exact text comparison proves the semantic review.

Only a missing weakness field is filled. Existing authored/manual lists, including an empty list or a
list in `runtime_projection.record`, survive unchanged. Preview reports other unassessed actors with
their citations as `source_extraction_required`. An artifact cannot silently apply to a different graph.

Apply requires the current preview revision. The existing locked publisher writes a new graph, manifest
and asset cohort, verifies it, then commits the metadata pointer. Previous bytes stay intact. Source-field
citations and the complete immutable review artifact are recorded. Replaying the same artifact does not
mint another generation; changing its bytes while reusing its id refuses. Campaign preview and rejected
preflight do not fork. Campaign apply uses its private source workspace; library apply leaves existing
private workspaces and campaign world/knowledge untouched.

Re-registering the unchanged starter retains the upgraded generation. A changed upstream starter needs
review. An upgraded PDF/user source also retains its identity when a bundled starter happens to share its
module id; registration cannot replace that source with the bundled graph.

The migration choice follows two existing precedents: [Flyway versioned migrations](https://documentation.red-gate.com/flyway/flyway-concepts/migrations/versioned-migrations)
record applied versions/checksums; the [Alembic cookbook](https://alembic.sqlalchemy.org/en/latest/cookbook.html)
separates optional data migration from schema migration. Here a graph snapshot has its own identity and
private campaign copies, so publication is explicit, revision-checked and append-only rather than an
automatic in-place update of every user graph. The contract already supplies the field schema.

## Reviewed source cohorts

The local original fragment is the shipped The Haunting PDF, SHA256
`31e36f72d0ac9a3654b61a09b1f071d3d82f25d78641e5069bfe343e44c5c7db`, window page 15 / printed page 449.
The retained historical source fields and citations were checked against that fragment. The transcription
preserves the successful own-floating-dagger stabbing condition regardless of spells and the Keeper's
discretion about sunlight killing Corbitt. It reuses the existing source dagger node and authored clue
conclusion. It creates no new learnable route or combat operation.

Two packaged artifacts cover the reviewed exact cohorts:

| Cohort | Base graph SHA256 | Artifact |
| --- | --- | --- |
| Shipped legacy twin | `9b8fb9aa28fe4240ba49f59572dd294d714055b82f11a6eec15cb5a346444760` | `content/starters/the-haunting-rulebook/weaknesses-upgrade.json` |
| Original historical publication | `060190e75489f66d4b3cc74cf748fdf88106cfc75b19e447e1a83982630eb073` | `content/starters/the-haunting-rulebook/weaknesses-upgrades/<base-hash>.json` |

The generic loader first tries an exact-hash packaged artifact, then the single starter artifact. All
other cohorts require an explicit reviewed artifact; no model is started and no entire book is reread.

Example kernel RPC sequence, using the preview's literal returned revision:

```json
{"id":"preview","method":"module.source.upgrade","params":{"module_id":"the-haunting-rulebook"}}
{"id":"apply","method":"module.source.upgrade","params":{"module_id":"the-haunting-rulebook","action":"apply","revision":"<returned-revision>"}}
```

Add the same explicit `campaign` to both calls for a private campaign upgrade. For another graph, supply
the same reviewed `upgrade` object to preview and apply. Inspect `additions`, `preserved` and `unassessed`
before applying. There is no bulk upgrade or background extraction command.

## Acceptance and boundaries

The source-upgrade tests use real publisher/RPC handlers and an isolated copy of the original historical
publication. They verify both kinds of actors, manual fields, empty fields, source mismatch refusals,
stale revisions, retry, re-registration, same-id PDF preservation and campaign isolation. The actual
source file remains read-only and its before/after hash agrees.

The new-PDF tests bind, claim, check and finish a fixture PDF while the consumer default is off, then read
the persisted graph and real Keeper surfaces. A table on the upgraded twin follows real scene routes to
discover its existing clue, advancing the route from 0/1 to 1/1. A renamed explicitly sourced physical
blade reports its actual root owner. Another source's same-name blade, a decoy and a scene owner cannot
substitute. Undiscovered source sunlight text stays out of the player view. Legacy unbound equipment
retains its existing normalized-name compatibility path.

The existing curated encounter's successful source-dagger use is separately exercised through real
stdin/stdout RPC and the ordinary combat executor. This verifies continued compatibility with the
integrated identity repair. It does not claim that prose in an upgraded historical graph automatically
becomes an executable rule. That graph's upgrade publishes facts, not a new combat/immunity engine.

All acceptance here uses controlled artifacts and zero model calls. It is mechanism acceptance, not
natural semantic reader coverage or installed App acceptance. No additional model request is necessary
for the two reviewed fragments, and none is made. Other unassessed actor/source facts remain explicit
extraction work; an authorized future reader can inspect those exact pages. Integration, package rebuild
and installed CLI checks belong to the sole coordinator's serial queue.

Persistent local receipts: `task-7/evidence/weakness-pdf-repair-20261005/`. Current candidate, test counts and
the integration/packaging state are recorded in tracker task `chatrpgv4/weakness-pdf-graph`.
