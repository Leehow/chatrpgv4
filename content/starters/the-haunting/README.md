# The Haunting — Built-in Starter Scenario

An original derivative introductory investigation for the COC Keeper plugin,
structured after the classic Call of Cthulhu beginner scenario set in 1920s
Boston (Corbitt House). Narrative prose, scene names, and NPC dialogue in this
pack are original work by the chatrpgv4 contributors and do **not** reproduce
Chaosium Product Identity boxed text.

`handouts.json` follows the same boundary. Its 1918 *Boston Globe* city-desk
copy is an Apache-2.0 original in-world prop derived only from this starter's
structured facts, explicitly marked `starter-original-derivative`; it is not a
transcription or paraphrased substitute for Chaosium source prose.

On this installation, `module-meta.json.module_graph_asset_root_id` binds the
versioned local source-bound root
`the-haunting-keeper-rulebook-40th-full-v1`.
When that root exists, its validated Rulebook cards and player map replace or
extend the built-in derivative card by semantic `asset_id`; when it is absent,
the open starter remains fully playable without source prose or images.
Historical campaigns that only contain `handout_asset_root_id` remain readable;
new starter installs no longer write that compatibility pointer.

## Graph-backed source authority

`module-graph.json` is now the starter's structured semantic authority.
`coc.module-graph-runtime-projection.v1` materializes the nine current Scenario
IR documents during install; the committed JSON views are generated fixtures
and must remain exactly reproducible from the graph. The graph is English-only
and contains no persistent table-language translation cache.

The graph also catalogs every reviewed scenario page, the 18 source image
regions, two player-delivery image variants, and ten information cards. Only
semantic metadata is committed. Exact Rulebook page text, handout bodies, map
bytes, illustrations, hashes, and source manifests remain in the ignored local
module-assets root. A source owner can provide local bytes through the module's
relative `asset_ref` entries (for example,
`assets/source/corbitt-house-keeper-map-ground.jpg`). Keep source pages and
preview derivatives in the local, ignored module-assets area and use the graph's
`image_sources` page/box metadata to produce the preview; do not commit source
bytes, absolute paths, or a source bundle.

Without those private local bytes, the structured graph and open derivative
materialized views remain playable; unavailable media never becomes invented
content or a reveal receipt.

The version suffix is an evidence boundary: earlier campaigns may still bind
the historical `the-haunting-keeper-rulebook-40th` cache. The full 17-page
bundle never overwrites or repoints that older page evidence.

Mechanical hooks (Flesh Ward, floating knife, own-dagger exception) align with
`../../../rulesets/coc7/rules-json/the-haunting.json`. Walter Corbitt presentation/stats are
referenced from `../../../rulesets/coc7/rules-json/monsters.json`.

## What a newcomer sees (graph v2, 2026-10-08)

Each scene carries a short `summary` for every turn and a `properties.description` of what a newcomer sees on arrival. Each
person met openly carries a `properties.biography` of looks and manner and is `player-safe`, so §168.5's first sight owes
them. The house's floors and rooms are `location` nodes. Everything is the book's (pages cited in `source_refs`), written in
the contributors' own words under the boundary above; nothing the book leaves to the Keeper is filled in. See
`docs/specs/haunting-graph-v2.md`.

## The built-in source window (SL-28, contract §14.16)

By the owner's decision of 2026-09-24 this package ships the scenario's own pages: `source.pdf` is
pages 446–462 (printed 435–451) of the *Call of Cthulhu Keeper Rulebook, 40th Anniversary Edition*,
extracted once from the owner's copy with the import pipeline's PDF.js extractor
(`node scripts/build-starter-source.ts the-haunting <book.pdf>`). `source-binding.json` declares
which book (its sha256) and which pages, and the sha256 of the shipped window. Every campaign from
this starter is bound to that window the way an imported PDF module is bound to its book: the same
`source.pdf` store, the reading lane, `lookup kind=source` and the prescreen's source material. No
other page of the Rulebook is shipped, and nothing else in this folder changed: the graph, its digest
and the bundled guidance are as before. The paragraph above about private local bytes still holds
for the handout and map images.

## Building the source-bound twin from the Rulebook (#29)

This starter is an original derivative: it carries the scenario's structure, not the book's
prose. The book itself says things the derivative cannot — what Arty Wilmot wants, what
Corbitt hides, what Dooley would exaggerate — so §17.2's dossier (`believes`, `hides`,
`asserts`, ties) has no source here to extract from.

A source owner can build a **second, source-bound module** from the Rulebook and play that
one instead. It does not replace this starter: the starter is the fixture the kernel tests
are written against, and nothing here is overwritten.

The existing source-bound twin remains readable as published data. To prepare another book, choose its original PDF through `bin/pi-coc setup`; the visual reader uses page images and the source-reading contract in `docs/kernel-rpc.md` §22. The former text-bundle build recipe has been retired.

> The sections below predate the 0.9.0a rewrite and still name `plugins/coc-keeper/…`
> scripts, which live only in the old tree (`0.8.2a`). Treat them as history.

## Playing

### One-line quick start (N7)

```bash
uv run --frozen python plugins/coc-keeper/scripts/coc_starter.py quick-start \
  --scenario the-haunting --pregen thomas-hayes
# or: --pregen eleanor-reed
```

This creates a setup campaign, installs the starter, copies the pregen
investigator into `.coc/investigators/<id>/` and the campaign `investigators/`
folder, and seeds `save/investigator-state/`. The canonical setup host then
calls the returned `setup.complete` handoff before launching/resuming the play
role; a setup-role session must not call play-only `module.context` or begin
the table directly.

Pregens:

| id | name | occupation |
| --- | --- | --- |
| `thomas-hayes` | 托马斯·海斯 | 私家侦探 |
| `eleanor-reed` | 埃莉诺·里德 | 记者 |

### Install only (create your own investigator)

```bash
uv run --frozen python plugins/coc-keeper/scripts/coc_starter.py install \
  --campaign <campaign-id> --scenario the-haunting
```

Then create or link an investigator for 1920s Boston before play. The normal
install path still expects a player-made (or explicitly chosen) investigator;
quick-start is the opt-in pregen path.

## Structure

Branching investigation with real `scene_edges`:

1. Commission briefing (Knott)
2. Parallel research: newspaper morgue / hall of records / neighbors / previous tenants
3. Corbitt house ground floor → upper-floor poltergeist → basement rites → confrontation

Critical conclusions require multiple independent clue routes (R-5).

## Page transcripts of the shipped window (contract §191.8)

`content/source-transcripts/31e36f72d0ac9a3654b61a09b1f071d3d82f25d78641e5069bfe343e44c5c7db/` holds one record per page of
`source.pdf` (the same 17 pages, physical pages 447-463 of the 40th Anniversary Keeper Rulebook; no other page). Each
record's `text` is the page's own PDF.js lines in reading order (a checked permutation, never rewritten), its `markdown`
the reading version, and `image_text` what a model read off the two map pages, labelled. The table reads them through
before its own store, so the Keeper and the reader see this window in reading order with no transcript call. Made with
`node scripts/build-source-transcripts.ts --pdf content/starters/the-haunting/source.pdf --model grok-build/grok-4.5`
(2026-10-07); re-run only when `transcript_version` or the native extraction version changes.
