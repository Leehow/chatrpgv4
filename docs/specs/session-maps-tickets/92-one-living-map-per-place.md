# 92: one living map per place — new places are uncovered on it, not printed as new cards

Status: needs-triage (owner request 2026-09-29; design below, two decisions marked **Owner** still open)
Parent: [session-maps.md](../session-maps.md). Amends Decisions 11 and 12 and §39 / §39.2 / §39.3; see "Contract to amend" below.
Remote ticket: none (local only).

## Owner request (2026-09-29)

> 这个地图这个还是设计一下吧，就是如果是相同地点的地图就不要一直弄新的了，就往上增加新地点，把隐藏的地方显示出来吧，不然之后越积越多溢出了

## What happened (installed App at ce1fa4138, campaign `game-5d82fd23-6c33-4efc-b8ef-bb65ccadf046`, Dust to Dust, turn 28)

One `apply move` to `martins-beach` printed **two** map cards, 「马丁滩村」 (14 regions) and 「马丁滩村地图」 (7 regions), and the case board lists both. They are the same printed map.

- **Two nodes for one print.** Both are crops of physical page 8: `asset-map-martins-beach-village`, box `[0.05,0.05,0.95,0.52]`, from `read-7` (a `detail` job, focus `martins-beach`); and `asset-martins-beach-village-map`, box `[0.08,0.03,0.92,0.48]`, from `read-10` (a `source_unit` job, pages 7–8). The two jobs were claimed at the same second after an orphan recovery; each reader's known-node snapshot lacked the other's map. Publication merges only by `node_id` (`kernel-ts/modules/visual.ts:721-750`), and nothing compares assets by page, box or `asset_digest`. Their regions share no ids and no coordinate frame (「1 浪峰旅店」 `[0.78,0.55,0.92,0.72]` vs 「1 Wavecrest Inn」 `[0.72,0.28,0.88,0.42]`), and map 2's region 5 frames a tree.
- **Not only maps.** On the same graph, newspaper cards #1–#5 have two or three nodes each (for example `handout-arkham-advertiser-2` and `handout-xiaokapian-2-martins-beach-robbery`). The reader was told "reuse known asset and place identities… do not duplicate", with both nodes in its packet, and still drafted new ones; nothing refused them.
- **Every map on a place mints its own card.** `presentArrivalMaps` emits one receipt per map that `depicts` the scene (`kernel-ts/read/maps.ts:220-249`). `apply map` always mints another receipt and card, even on a map already shown (`maps.ts:279-311`, `kernel-ts/apply/index.ts:241-242`).
- **Every card carries its whole picture.** Each card embeds its PNG as a data URL in the `coc-mechanics` session entry (`extensions/kernel/map-view.ts:89`, `extensions/kernel/index.ts:2009`). This one arrival added about 1.5 MB (1,111,959 + 393,411 bytes of PNG, before base64). The session file already weighs 6 MB. This is the "越积越多溢出".
- **The black is not hidden places.** `renderMapView` paints the canvas `#171613` and pastes only the known regions' rectangles (`map-view.ts:73-80`). Everything outside a region box, sea and roads included, is black, even on a map whose every region is player-safe. What looks like "hidden areas" is the gaps between coarse rectangles.
- **A reveal card hides what arrival showed.** An `apply map` card draws only `map_knowledge` regions, not the regions arrival presented (`maps.ts:176-181`). `look` / `mapCatalog` also ignore arrival-shown regions (`maps.ts:313-322`, `kernel-ts/read/handlers.ts:424-431`), so the Keeper reads a map the player is holding as unknown.

## Design

**1. One printed visual, one node** (publication; covers maps and handouts).
- A drafted asset whose crop lies on the same physical page as an existing asset and overlaps its source box is not published as a new node on geometry alone. The overlap is a structural trigger. Whether it is the same print is decided by the independent visual reviewer, which already receives crops and overlay previews (§152, `map-review-preview.ts`). No code decides sameness from names or text.
- **Same print:** the draft extends the existing node. New regions are expressed in that node's frame and reviewed on its overlay preview.
- **Different print** (two maps on one page): both stand.
- The check runs against the graph generation at publication time, not the claim-time snapshot, so two concurrent jobs cannot both publish.
- **Existing graphs:** a reviewed `variant-of` / supersede relation (already in the vocabulary, `module-graph-contract-v3.json:136`, with no consumer yet) marks the survivor. Play reads only the survivor, and campaign state keyed by the superseded handle is carried over by alias. Region knowledge moves only through a reviewed correspondence (Decision 5 stands).

**2. A map is printed once; later knowledge uncovers it** (cards; transcript).
- A map's **first presentation** prints its card, as today.
- **After that, nothing on the same map prints a picture again.** A later reveal, whether from arriving at a place it depicts or from `apply map`, delivers a short row with no image: the map's name, the places newly uncovered, and a control that opens the living map. It is still bound as `{{map:<handle>}}` with a receipt, so the ledger and the transcript stay honest.
- Historical cards are never changed in place (Decision 12 kept). The first card stays as it was delivered, and the living map carries the growth.
- A delta row carries no image bytes, so the session no longer grows by a picture per reveal.

**3. The living map** (board; `table.maps`).
- The board holds one entry per map node (per printed map, after 1). It is rendered on read from the union of everything the table knows: arrival-shown and `apply map` regions together.
- The same union feeds `look`, `mapCatalog` and every later card, so the Keeper and the player see the same map.

**4. New places uncover regions on the map that contains them.**
- At publication, each region may name the graph place it depicts (`region.place: <node id>`), written by the reader and checked by the reviewer.
- Arriving at a place, or learning of it, uncovers that place's region on every map depicting the place or a place it lies in (`located-in` / `occurs-at`, the walk `sceneAssetNodes` already does). It does not mint another map.
- The two "which maps depict this scene" computations (`mapsDepictingScene`, `sceneAssetNodes`) become one.

**5. What is dark** — **Owner** decision.
- **Proposal:**
  - A map whose source is player-safe (a handout-style map the book gives players) renders **whole**, with only regions not yet learned and secret regions masked.
  - A `revealable` map (a Keeper's map revealed by knowledge) keeps today's known-regions-only rendering.
- **Why:** a public village map read as black patches between rectangles is the artefact the player saw. Masking only the unknown shows the roads, sea and shape, which the book already gave the player.
- **Alternative:** keep the collage everywhere and only tighten the boxes.

**6. Delta row versus refreshing the first card** — **Owner** decision.
- **Proposal: 2 as written.** History is immutable; later reveals are imageless rows pointing to the living map.
- **Alternative:** the first card is patched in place (§132's card patch has no map-row addressing today). This conflicts with Decision 12 and with §39's "an old card cannot silently become a later view".

## Contract to amend

- §39 / §39.2: arrival and `apply map` on an already-presented map deliver a delta row, not a card.
- §39.3: board rows are per surviving node; the union includes arrival-shown regions.
- §152: publication identity for visual assets.
- `session-maps.md` Decision 11: collapsing by reviewed same-print identity is allowed, and names alone still never collapse.
- Decision 12 is kept.
- Ticket 90's "two maps with similar labels retain separate identities" stays true for different prints.
- Tests that pin today's rules: `tests/extension/map-session-viewer.test.mjs:114`, `map-arrival-late.test.mjs`, `map-view.test.mjs`, `board-panel.test.mjs`, `tests/kernel/test_map_arrival.py:138`.

## Also in scope (small, found on the way)

- `maps_presented` is not carried through worldline confluence (`kernel-ts/worldline/confluence-plan.ts:98-118` unions `map_knowledge` and `map_labels` only).
- There is no arrival path for a map depicting the opening scene; the only callers are `apply/index.ts:314` and `maps.ts:267`.
- Authored map words are projected per map, so duplicate nodes also duplicate the translation work (`kernel-ts/read/maps.ts:92-107`). Design 1 removes that.

## Acceptance

- [ ] Rebuild Dust to Dust from the PDF (fresh campaign, installed App): page 8's village map is **one** node; cards #1–#5 are one node each. Two concurrent jobs over the same page cannot both publish, and a test drives the race.
- [ ] The existing campaign `game-5d82fd23…` (two village handles) keeps playing: one board entry, knowledge carried only through a reviewed correspondence, nothing lost.
- [ ] Arrive at Martin's Beach: one card. Walk to the Poe Street cemetery and to the Felder house: each gives a row naming the uncovered place with no image. The board's single village map shows them.
- [ ] The session file grows by no image bytes for a delta row (measured).
- [ ] After arrival, `look focus=map` reports the map as known, with the arrival regions.
- [ ] The main session plays the live table as the player on the installed App; screenshots and turn records are cited under `## Comments`.

## Comments
