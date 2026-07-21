# On-Demand Module Skeleton + Durable Asset Store

**Status:** thin repair slices are implemented and have returned repeatedly to
installed-plugin play. R13 proves a one-page canonical foreground pack plus a
source worker that finishes after player input is restored; R17 proves the
current ordinary-turn finalization guidance on its first submission. Opening
latency, Codex live activation, appendix/mechanics live evidence, and complete
background lifecycle ownership remain open; slices 7 and 9 are still Partial.**
**Date:** 2026-07-18
**Scope:** progressive PDF import, director-ready topology, mention-driven deepen,
local multi-campaign reuse of parsed assets.

### Implementation progress

| Slice | Status | Code |
|-------|--------|------|
| 1 Schema + store writer/reader + skeleton validate + queue | **Done** | `coc_module_assets.py`, `tests/test_module_assets.py` |
| 2 Tier 0–1 host workflow skill text | **Done** | `trpg-pdf-ingest`, `coc-scenario-import` progressive sections |
| 3 Opening deep → campaign IR projection | **Done** | `coc_module_project.py`, `tests/test_module_project.py` |
| 4 Enter-scene deepen + neighbor/mention enqueue | **Done** | `on_enter_scene` / `process_ready_deepens`; hooked from `state.move_scene` |
| 5 `scene.map` parse_state | **Done** | `scene.map` exposes `parse_state`, `evidence_gap`, `progressive_asset_root_id` |
| 6 Library/install reuse by file_sha256 | **Done** | `coc_module_reuse.py` (`reuse`, `link-library`, `resolve`); library install stamps progressive link |
| 7 Queue worker | **Partial** | Queue claim/merge exists and R13 completion arrived after player input was restored, but semantic dispatch and final fulfill still return to the main KP. |
| 8 Player-dig path (no scene move) | **Done** | `request_deepen` / `follow_structured_mentions` / `on_clue_discovered`; toolbox `progressive.*`; clue `mentions[]` preserved in IR |
| 9 Host-native source workers | **Partial / live opening exercised** | R12/R13 produced and first-fulfilled a canonical one-page opening pack without parent repair, but the adapter remains experimental and the main KP still owns dispatch/inspection/final fulfill. |

## 2026-07-20 repair objective

**User job:** a fresh campaign with an accepted source bundle should reach a
source-faithful, genuinely playable opening quickly, while non-critical module
enrichment continues without making the player wait or turning the KP into a
manual compiler/queue operator. A hollow result would be a fast status message,
synthetic timing harness, or green shape-only tests while normal plugin play
still blocks, falls back to shell, or corrupts source semantics.

**Product question:** can Codex and Grok use the canonical plugin path to show
the same trustworthy opening within the latency budget, then finish bounded
background work without weakening the live KP or inventing a fixed narrative
pipeline?

### Reopened repair ledger

| Item | Status | Required evidence |
|---|---|---|
| Native Codex MCP activation | **V0/V1 implemented; live host pending** | Source config now uses `./mcp/launch` with plugin cwd and passes a real launcher handshake; managed-cache refresh and fresh Codex-host activation remain unproved. |
| Canonical source-worker result | **Implemented; R12/R13 live pass** | The bare claimed packet reached the worker unchanged; its canonical pack reached first fulfill unchanged and passed without main-KP JSON repair. |
| Opening foreground boundary | **Implemented; R13 live pass** | The installed host selected and read only page 361 for the playable opening; neighboring scenes and appendix mechanics did not block it. |
| Autonomous background lifecycle | **Improved but still Partial** | R13 restored the character-card input 18.209 s before the source worker finished and handled completion later, but the host still owns semantic dispatch and final fulfill. |
| Content-addressed semantic cache | **Existing identities mapped; implementation pending** | Compose existing file/bundle/page/work-group/semantic hashes with entity/aspect and schema version; do not create a second store. |
| Locator and authored-absence proof | **Validation implemented; locator production missing in live path** | `pending|complete` and scope-bound absence receipts reject false completeness, but R18 proved no canonical post-opening pass currently produces the appendix locator index. |
| Mechanics field completeness | **Implemented; component-verified / live Joseph pending** | Authored actor packs account for the closed schema through `fields_observed`, `fields_extracted`, and `fields_not_authored`; partial flat profiles no longer pass as authored. |
| Structured clue delivery semantics | **Implemented; component-verified / live clue pending** | Canonical `automatic|check|conditional_check|keeper_judgment` survives projection; automatic clues no longer acquire `regular` merely because prose or legacy data names a skill. |
| Per-fact provenance | **Implemented mechanically; live evidence pending** | Nested facts accept source-authored or campaign-improvised provenance instead of inheriting a pack-wide source claim. |
| Real-host acceptance | **R17 format pass / latency fail / incomplete** | Updated installed-plugin Grok play has no shell fallback and first-pass finalization now works, but a normal turn still took 113.938 s; opening latency, five-turn evidence, Codex-host activation, and live appendix/clue checks remain open. |

### Acceptance targets

- Accepted source bundle + fresh campaign: first playable opening P50 <= 30 s,
  P95 <= 60 s; opening display to restored player input <= 5 s.
- The first screen does not read the full module or start neighbor/NPC deep
  packs, and background work continues while the host waits for player input.
- Codex and Grok agree on the opening entry and appendix/roster locator scope.
- Lucas and Jane resolve from the appendix; Joseph retains every authored
  mechanics field; an explicitly automatic archive clue does not become a
  Library Use check.
- Five normal live-KP turns use the native MCP path without shell fallback.

### 2026-07-21 R9 real-host evidence

- Method: installed `coc-keeper` plugin in an interactive Grok TUI under tmux;
  Grok was the sole live KP and one context-free Codex subagent supplied one
  player reply at a time. This was not one-shot, batch, scripted-player, or
  fake-KP execution.
- The MCP connected in 2.282 s and exposed only the three canonical gateway
  tools. An exact log scan found no `run_terminal_command` call.
- Before the playable opening, the host exact-read the bound manifest and only
  PDF indices 359-361; it did not crawl all 18 scenario pages.
- The real host source worker ran for 44.788 s, returned a canonical opening
  pack, and was fulfilled without main-KP field repair. Open host work then
  cleared to zero while the player was between replies.
- The KP projected Bennington Police Station, recorded two public first-contact
  rolls, delivered the Chinese opening, accepted the player's question to the
  sheriff, persisted its consequences, and completed `turn.finalize`.
- Performance failed: first host response 140.4 s (> 60 s), character
  confirmation to playable opening 127.3 s (> 60 s), and the first ordinary
  action 101.7 s. `turn.finalize` also rejected one unnecessary
  `advisory_uptake` payload before succeeding on retry.
- Scope remains incomplete: this run settled one normal play turn, not five;
  it did not validate Codex native activation, appendix locator completeness,
  Lucas/Jane mechanics, Joseph field completeness, or automatic-clue semantics.
- Raw source of truth: Grok session
  `019f82ad-9a59-7bc0-98a0-4fcb8f0aae81` under the focused Grok session store;
  isolated campaign workspace
  `/tmp/coc-opening-live-grok-r9-20260721-WLvKXy`.

### 2026-07-21 R10-R17 real-play repair loop

- Every acceptance run used the updated installed plugin in an interactive
  tmux TUI. Grok was the only live KP; a protocol-isolated Codex subagent
  supplied one player line at a time. No one-shot, batch, scripted-player, or
  fake-KP run is counted here.
- R10 selected three later pages and was stopped as invalid. R11 selected the
  correct single page but still required parent-side pack repair. R12/R13 then
  passed the bare-packet, canonical-pack, unchanged-first-fulfill path on page
  361. R13 visibly restored player input 18.209 seconds before its source
  worker completed, then processed that completion in a later host turn.
- R13 reduced character creation to first-pass create/link/render and removed
  the malformed empty operation and redundant item grant. It still needed
  three finalization attempts. R14/R15 were stopped and labeled invalid when
  the live KP wandered into unlocated/off-graph deepening instead of staying
  with the current playable scene; they are not acceptance evidence.
- R16 proved ignored advice is now recorded separately through
  `evidence.record_adoption`, but its first finalization joined text across a
  blank-line paragraph boundary and failed before a corrected retry.
- R17 tightened only that paragraph guidance, reinstalled the real plugin,
  and replayed a public-roll turn. The sole `turn.finalize` call succeeded;
  delivered output matched canonical `rendered_text` byte-for-byte. The turn
  took 113.938 seconds, while 23 MCP calls totaled 366 ms (45 ms max), and the
  final output tail was 3.406 seconds. Native tools were only `search_tool` and
  `use_tool`; there was no shell fallback. Queue pending/in-flight counts were
  both zero after the turn.
- New R17 risk: the KP issued independent-looking item grants and later state
  mutations in parallel waves. No conflict appeared in this run, but that does
  not satisfy the canonical serial-mutation guidance and remains an explicit
  correctness item for subsequent real play; no new scheduler or hard gate is
  inferred from one observation.
- R17 source of truth: Grok session
  `019f8319-1967-7191-bd9f-571bb48f5c6c` in workspace
  `/tmp/coc-opening-live-grok-r9-20260721-WLvKXy`.
- R18 used the same updated installed-plugin TUI and a new isolated player
  reply to start a non-lethal STR contest with Lucas. The live KP correctly
  called `mechanics.ensure` instead of inventing NPC numbers. The operation
  returned `source_work_required`, but the skeleton still had
  `mechanics_locator_pass_status=pending` and `mechanics_index=[]`; the derived
  mechanics request therefore had `requested_pdf_indices=[]` and
  `source_scope_status=unknown`. `progressive.claim_host_work` returned no
  packets (`ready_group_count=0`). The turn was cancelled at 84.754 seconds
  before the KP could widen the search, fake a pack, or generate fallback
  mechanics. This is valid failure diagnosis, not a completed play turn or
  acceptance pass. Source session:
  `019f8322-898e-7483-a90a-d1141ec4cd00`.

### Non-goals / hard boundaries

- No repository PDF parser or OCR fallback.
- No keyword/regex semantic routing, fixed Keeper pipeline, narrative gate, or
  fake-KP/batch-settle acceptance harness.
- `progressive.prepare_opening`, if adopted, is a thin source-window and work-
  plan operation; the live KP retains semantic interpretation and final prose.
- No full-module crawl before the first playable opening.

This document freezes the product contract for skeleton-first play and
on-demand deep parse. Implementation must match these shapes. Existing full
cold-compile of seven Scenario IR files remains valid for starters and
already-registered library hits; this track adds a **progressive** path for
player-supplied PDFs.

## Non-goals

- In-repo PDF/OCR parsing (host PDF skill still owns extraction).
- Keyword classification of free prose for mentions or edges (Semantic Matcher
  Constitution).
- Shipping Chaosium Product Identity prose in git.
- Unbounded background crawl of an entire mega-campaign PDF.
- Replacing the seven-file Scenario IR as the **play/director runtime** once a
  scene is deep-parsed.

## Product laws that bind this design

1. **Player-visible language:** table text uses campaign `play_language`;
   source-language pages stay in the asset store as evidence.
2. **Evidence before fiction:** no handout body on the table until that handout
   pack is deep-parsed; never invent handout text to fill an `evidence_gap`.
3. **Director advisory only:** skeleton depth never becomes a hard narrative
   gate that blocks player action; KP may move with warnings.
4. **Immediate durable write:** every accepted parse product is written to the
   module-assets store before the next player-facing turn depends on it.
5. **Reuse by content identity:** second campaign / replay hits store by
   `file_sha256` + `module_identity`, not by campaign id alone.

## Parse tiers

| Tier | Name | When | Output |
|------|------|------|--------|
| 0 | Identity | import start | `module_identity`, PDF hash, page_count, flags |
| 1A | Bootstrap skeleton | before first play turn | valid sparse topology + start candidate + exact opening locator |
| 1B | Skeleton enrichment | background after 1A | locations, provisional edges, NPC roster names, handout/threat/finale/mechanics locators |
| 2 | Opening deep | first playable scene | full packs for start scene + its clues/NPCs/handouts |
| 3 | On-demand deep | enter location / open handout / material NPC contact | location/NPC/clue packs for that entity |
| 4 | Hot-ring prefetch | after Tier 3 on L | neighbors depth-1 **partial**; mentioned entities **stub→partial** |
| 5 | Full chapter green | optional later | complete seven-file IR + `coc_scenario_compile --validate` |

### Decisions fixed by module-corpus survey

- **Skeleton producer:** host PDF skill (TOC + front matter + DP headings +
  resolution/timeline titles); repository only stores structured results.
- **Neighbor prefetch:** geographic/hierarchical **depth 1 partial** +
  structured mentions from the current deep pack.
- **Deep failure:** allow play on skeleton with `evidence_gap: true`; forbid
  fabricated handouts/secrets.
- **Unit of work:** chapter for Masks-class; whole short module; **region hub**
  partitions for 血色公路-class sandboxes.
- **Forward references are default:** create `named_only` stubs when dialogue,
  handouts, or keeper overview name a place/person before its body section.

## Durable store layout

Local only (under workspace `.coc/`, gitignored). Not a substitute for
`.coc/module-library/` (compiled seven-file packages).

```text
.coc/module-assets/
  registry.json
  <asset_root_id>/
    identity.json
    skeleton.json
    pages/
      <pdf_index zero-padded>.md
      <pdf_index zero-padded>.meta.json
    entities/
      location-<id>.json
      npc-<id>.json
      clue-<id>.json
      handout-<id>.json
      threat-<id>.json
    handouts/
      <handout_id>.md          # source-language or bilingual evidence body
      <handout_id>.meta.json
    mentions-index.json
    parse-queue.json
    LICENSE-note.md
```

### `asset_root_id`

Prefer `canonical_module_id` when known; else
`pdf-<first16 of file_sha256>`. One PDF fingerprint maps to at most one active
root at the current schema_version.

### `registry.json` (sketch)

```json
{
  "schema_version": 1,
  "modules": {
    "cold-harvest": {
      "asset_root_id": "cold-harvest",
      "file_sha256": "<64 hex>",
      "canonical_module_id": "cold-harvest",
      "updated_at": "2026-07-18T00:00:00+00:00",
      "parse_tier_max": 3
    }
  },
  "by_file_sha256": {
    "<64 hex>": "cold-harvest"
  }
}
```

## Skeleton schema (`skeleton.json`)

```json
{
  "schema_version": 1,
  "parse_tier": 1,
  "module_identity": {
    "canonical_module_id": "example-module",
    "canonical_title": "Example",
    "rules_edition": "7e",
    "locale": "zh-Hans",
    "chapter": null,
    "parent_module_id": null
  },
  "structure_type": "branching_investigation",
  "source": {
    "source_id": "pdf:example",
    "path": "/absolute/or/workspace-relative.pdf",
    "file_sha256": "<64 hex>",
    "page_count": 48,
    "producer": "codex-pdf-skill"
  },
  "start_candidates": ["opening-briefing"],
  "finale_buckets": [
    {"id": "end-resolve", "title": "Resolution", "importance": "critical"}
  ],
  "locations": [
    {
      "location_id": "farm-hub",
      "title": "Krasivyi Oktabur-3",
      "parent_id": null,
      "map_key": null,
      "parse_state": "toc_only",
      "source_span": {"pdf_index_start": 14, "pdf_index_end": 17},
      "location_tags": ["farm", "hub"],
      "npc_ids_mentioned": ["npc-abramov"],
      "handout_ids": [],
      "neighbors_provisional": ["avenue-records"],
      "evidence_gap": false
    }
  ],
  "edges_provisional": [
    {
      "from": "opening-briefing",
      "to": "farm-hub",
      "kind": "travel",
      "confidence": "low",
      "evidence": "toc_adjacency"
    }
  ],
  "npc_roster": [
    {
      "npc_id": "npc-abramov",
      "names": ["Pyotr Abramov", "阿布拉莫夫"],
      "parse_state": "named_only",
      "role_tags": ["witness", "mutated_family"],
      "home_location_ids": ["farm-hub"],
      "source_span": null
    }
  ],
  "handouts": [
    {
      "handout_id": "handout-1",
      "label": "小卡片#1",
      "player_visible": true,
      "parse_state": "toc_only",
      "source_span": {"pdf_index_start": 9, "pdf_index_end": 9}
    }
  ],
  "threats": [
    {
      "threat_id": "threat-lloigor",
      "label": "Lloigor pressure",
      "parse_state": "stub"
    }
  ],
  "conclusion_buckets": [
    {
      "id": "who-harms-the-farm",
      "title": "What is destroying the sovkhoz",
      "importance": "critical"
    }
  ],
  "timeline_events": [],
  "content_flags": []
}
```

### `parse_state` enum

| Value | Meaning |
|-------|---------|
| `named_only` | Mentioned in play/overview; no TOC span yet |
| `toc_only` | Listed in TOC/front matter; body not deep |
| `partial` | Neighbor/mention prefetch; enough for director tags, not table handouts |
| `body_parsed` / `deep` | Location/NPC/clue pack complete enough for table delivery |
| `failed` | Host extract failed; `evidence_gap` must be true |

### Provisional edge `kind` / `evidence`

- `kind`: `travel` | `contains` | `unlock` | `mentioned` | `chapter_handoff`
- `confidence`: `low` | `med` | `high`
- `evidence`: `toc_adjacency` | `map` | `body_mention` | `clue` | `handout` | `npc_dialogue`

**Rule:** `unlock` edges used as hard play gates require `confidence: high`
and deep-parse evidence. Low-confidence travel never blocks `state.move_scene`
(warn only).

## Entity packs (Tier 3+)

### Location pack `entities/location-<id>.json`

```json
{
  "schema_version": 1,
  "location_id": "farm-hub",
  "parse_state": "deep",
  "updated_at": "2026-07-18T00:00:00+00:00",
  "source_span": {"pdf_index_start": 14, "pdf_index_end": 17},
  "page_text_sha256": ["..."],
  "dramatic_question": "...",
  "scene_type": "investigation",
  "player_safe_summary": "...",
  "available_clue_ids": ["clue-a"],
  "npc_ids": ["npc-abramov"],
  "pressure_moves": ["..."],
  "affordances": [],
  "scene_edges": [],
  "mentions": [
    {"kind": "location", "ref_id": "avenue-records", "raw_label": "records office"},
    {"kind": "npc", "ref_id": "npc-smolskaya", "raw_label": "Smolskaya"}
  ],
  "keeper_secret_refs": [{"id": "sec-1", "category": "truth"}],
  "evidence_gap": false
}
```

`mentions[]` is **structured output of the host/LLM deep compile**, not a
runtime keyword scan of player prose.

### NPC / clue / handout packs

- NPC: agenda, voice, relationship tags, optional A21 blocks (all-or-nothing).
- Clue: `delivery_kind`, skills, `player_safe_summary` in storage language +
  optional `localized_text[play_language]` for table.
- Handout: markdown body path + meta; table delivery still follows play_language
  constitution (render in play language; source body remains in store).

### Canonical source-to-runtime bridge

`scenario.bind_pdf` registers validated bundle pages in this asset root before
either cold compilation or progressive projection. Additional bundle windows
for the same `file_sha256` add pages to the same content-addressed cache.

On a bundle-backed root, every `partial`, `body_parsed`, or `deep` entity with
`evidence_gap: false` must identify cached pages through `source_page_indices`,
`source_refs`, or `source_span`. `put_entity` canonicalizes that evidence into
page/bundle hashes and explicit refs on nested clues, NPCs, and secret rows.
Projection must preserve all meaning-bearing fields into Scenario IR; compiled
archive views must be semantically equivalent to IR for agenda, provenance,
clue delivery, and Keeper-only material.

`host_timing.duration_ms` records host semantic compilation separately from
queue wait/merge timings. `cached_scope_complete: true` in a host-work request
means the host must use `cached_page_refs` and must not reopen the PDF for that
entity scope.
The entity pack echoes `host_work_job_id`; accepting it closes that durable
request. Re-putting an identical semantic pack preserves the first timing
receipt and increments reuse metadata instead of recomputing request latency.

Source provenance also travels along structured `mentions[]`: enclosing page
refs are materialized on each mention, copied to its named-only entity stub,
then resolved by the queue worker into the narrow `requested_pdf_indices`.
This prevents a newly discovered place or NPC from degenerating into a scan of
all cached pages merely because it was absent from the initial skeleton.

## Parse queue (`parse-queue.json`)

Event-driven; not a free-running crawler.

```json
{
  "schema_version": 1,
  "pending": [
    {
      "job_id": "job-1",
      "kind": "deepen_location",
      "target_id": "avenue-records",
      "priority": 50,
      "reason": "mention_from:farm-hub",
      "enqueued_at": "2026-07-18T00:00:00+00:00"
    }
  ],
  "in_flight": [],
  "done": []
}
```

### Enqueue triggers

| Event | Jobs |
|-------|------|
| Import Tier 1 complete | optional partial for `start_candidates` |
| Opening deep | deepen start location + its handouts/NPCs |
| `state.move_scene` / enter L | deepen L; partial neighbors depth 1; stub+enqueue mentions from L pack |
| Clue/handout delivered | ensure entities in that pack's `mentions` |
| Material NPC engagement | deepen that NPC; stub relationship one-hop ids |
| Player commits “go to X / find Y” (KP semantic) | ensure + deepen X/Y |
| `director.advise` about to run | ensure active scene `parse_state` is `deep` or mark advice degraded |

### Priority hints

- 100: active scene missing deep
- 80: handout about to be shown
- 50: neighbor partial / mention
- 20: speculative finale (only if timeline imminent)

## Mentions index

```json
{
  "schema_version": 1,
  "entities": {
    "location:avenue-records": {
      "first_seen": "opening-briefing",
      "first_reason": "handout-1",
      "refs": ["location:farm-hub"]
    }
  }
}
```

## Runtime projection

### Into play IR

Progressive path may maintain **sparse** seven files under the campaign
`scenario/` directory:

- Global: all `scene_id`s + provisional/high edges as topology.
- Deep merge: when a location pack becomes `deep`, upsert that scene, its
  clues, and its NPCs into the seven files and re-validate **incrementally**
  (see Phased validation).

Director and toolbox continue to read the seven-file IR + world-state. Asset
store is the durable source of truth for progressive content; campaign IR is
the live projection.

### `scene.map` depth (KP-facing)

Each scene entry SHOULD expose:

```json
{
  "scene_id": "farm-hub",
  "parse_state": "deep",
  "evidence_gap": false,
  "unlocked": true,
  "visited": true
}
```

Players never see parse_state.

## Phased validation

| Gate | Requirement |
|------|-------------|
| **Skeleton publish** | `skeleton.json` schema; unique ids; start_candidates non-empty; every location has id+title; edges endpoints exist or are auto-stubbed |
| **Opening playable** | start scene pack deep; its clues have `delivery_kind` + `player_safe_summary`; its NPCs have agenda; world active_scene set |
| **Scene enter** | target location deep before table handout/clue body delivery |
| **Full green** | existing `coc_scenario_compile.validate_scenario` for chapter/module completeness claims |

Do not apply full green as a blocker for first play turn on the progressive
track. Do not ship partial six-field `scene_function` or partial A21 blocks
(omit until complete — director hard-fails on partial contracts).

## Relation to existing surfaces

| Surface | Role after this design |
|---------|------------------------|
| Host PDF skill + `trpg-pdf-ingest` | Tier 0–3 page extraction only |
| `coc_pdf_bundle` (≤32 pages) | Validates one host handoff window; large modules use multiple windows / chapter roots |
| `.coc/module-library/` | Compiled seven-file packages for install; may reference asset_root_id |
| `.coc/module-assets/` | Progressive pages + packs + skeleton (this design) |
| `scene.map` / director tools | Consume projected IR; show parse_state for KP |
| Starters | Unchanged full IR path |

## Implementation slices (suggested order)

1. Schema constants + empty store writer/reader (no play integration).
2. Tier 0–1 host workflow skill text + skeleton validator.
3. Opening deep → campaign IR projection + playable start.
4. Enter-scene deepen + neighbor/mention enqueue.
5. `scene.map` parse_state field.
6. Library/install reuse of asset_root by file_sha256.
7. Background parallel worker for queue (event-enqueued only; no unbounded crawl).
   - Dig/enter/clue-follow **only enqueue** and `kick_background_worker` (non-blocking).
   - Detached `coc_module_queue_worker.py run` claims jobs into `in_flight`, processes
     with a thread pool, merges ready deep packs into campaigns, writes
     `host-work/<job_id>.json` when packs are missing, then idles out.
   - Host PDF skill fulfills host-work (put_entity deep); `put_entity` re-enqueues
     merge at priority 100 and kicks workers again.
   - Disable detached spawn in tests via `COC_DISABLE_QUEUE_WORKER=1`.
8. Host-native semantic workers over the existing host-work boundary.
   - `progressive.claim_host_work` atomically leases up to four exact cached-page
     groups and recovers abandoned work after lease expiry.
   - The grouping identity is PDF hash + body/mechanics aspect + exact page set;
     mechanics never inherits narrative body pages.
   - Grok and Codex consume the same `coc.source-pack-worker.v1` packet. Children
     are read-only and the main KP remains the sole canonical fulfiller.

## Pilot modules (local corpus)

| Module | Why |
|--------|-----|
| 人煎百味 | Clean 地点 TOC |
| 冰冷的收获 | NPC-first + 小卡片 |
| 归于尘埃 | Forward refs + multi-town |
| 血色公路 | Hierarchical sandbox + timeline (MinerU extract exists) |
| Masks single chapter (in module-library) | Chapter unit + install reuse |

## Acceptance (progressive track)

1. After Tier 1, KP can open `scene.map`-equivalent topology and see start +
   stubs without reading full PDF body.
2. First player turn can run with only opening deep packs.
3. Entering a new location deepens it once; second visit does not re-extract
   if page hashes match.
4. A source-pack mention of an unseen entity creates a narrow, reusable stub
   immediately. Deepening is enqueued only when delivered clue evidence follows
   that mention or the player materially pursues the entity; merely entering a
   scene does not fan out host requests for every referenced place and NPC.
5. New campaign with same `file_sha256` reuses `.coc/module-assets` without
   host re-extract for already-deep pages.
6. No player-visible English dump when `play_language` is `zh-Hans`.
7. No fabricated handout when `evidence_gap` is true.

## Out of scope until later

- Automatic whole-Masks multi-chapter skeleton in one import.
- Shared multi-user cloud asset CDN.
- Changing MAX_PAGES without chapter/window design.
