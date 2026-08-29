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

On this installation, `module-meta.json.handout_asset_root_id` optionally
overlays the versioned local source-bound root
`the-haunting-keeper-rulebook-40th-full-v1`.
When that root exists, its validated Rulebook cards and player map replace or
extend the built-in derivative card by semantic `asset_id`; when it is absent,
the open starter remains fully playable without source prose or images.

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
module-assets root. A source owner can install those local bytes with:

```bash
uv run --frozen python plugins/coc-keeper/scripts/coc_starter_graph.py \
  install-local-assets --workspace . \
  --starter-dir plugins/coc-keeper/references/starter-scenarios/the-haunting \
  --source-bundle /absolute/path/to/validated/source-bundle \
  --packs-dir /absolute/path/to/english-source-handout-packs
```

Without that private source bundle, the structured graph and open derivative
materialized views remain playable; unavailable media never becomes invented
content or a reveal receipt.

The version suffix is an evidence boundary: earlier campaigns may still bind
the historical `the-haunting-keeper-rulebook-40th` cache. The full 17-page
bundle never overwrites or repoints that older page evidence.

Mechanical hooks (Flesh Ward, floating knife, own-dagger exception) align with
`../../../rulesets/coc7/rules-json/the-haunting.json`. Walter Corbitt presentation/stats are
referenced from `../../../rulesets/coc7/rules-json/monsters.json`.

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
