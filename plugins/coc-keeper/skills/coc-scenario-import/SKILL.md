---
name: coc-scenario-import
description: Import and index authored Call of Cthulhu scenarios for COC mode. Use for rulebook scenarios, external module PDFs, scenario skeletons, source maps, Keeper-only separation, and on-demand PDF lookup.
---

# COC Scenario Import

## Import Model

Use a two-stage import strategy:

1. An **external host PDF skill** extracts selected pages and assets into a
   versioned host source bundle. Prefer the host's existing PDF capability
   (Claude Code document `pdf`, Codex built-in `pdf`, etc.) when it can meet
   the contract; if none is available, recommend the open-source
   [`openai/skills` curated `pdf`](https://github.com/openai/skills/tree/main/skills/.curated/pdf)
   workflow. See `trpg-pdf-ingest` for priority and schema.
2. The repository validates/reformats the bundle and compiles scenario JSON.
   It never parses the original PDF and has no local OCR fallback.

### Progressive / on-demand track

Player PDFs should prefer **skeleton-first + on-demand deep parse** rather than
one-shot full-module cold compile when the book is large or multi-location.
For this normal installed-plugin path, call `scenario.bind_pdf` with
`compile_now` omitted or `false`. `compile_now=true` is only an explicit request
for an available repository cold compiler runtime; it is never an opening
prerequisite and must not delay the first playable scene.

**Implemented now (slices 1–3):**

| Step | Tool |
|------|------|
| Bind + cache verified pages | `scenario.bind_pdf` → `result.source_cache.asset_root_id` |
| Store skeleton | `coc_module_assets.py put-skeleton` |
| Project topology → campaign sparse IR | `coc_module_project.py skeleton` |
| Store pages / stubs / queue | `put-page`, `ensure-stub`, `enqueue` |
| Opening deep → campaign IR | `coc_module_project.py opening-deep` |
| Enter scene hot-ring | automatic via `state.move_scene`, or `coc_module_project.py on-enter` |
| Map depth | `scene.map` → `parse_state` / `evidence_gap` per scene |

**Experimental foreground-opening component (V0/V1a):** after a successful
`scenario.bind_pdf`, discover `progressive.prepare_opening` through the normal
toolbox/MCP path. It is a strict read-only diagnostic/work planner for one
structured start and one exact accepted contiguous 1–3-page window. Its
bounded result separates hard opening readiness from soft/deferred module work
and returns optional canonical mutation cards for
`progressive.publish_skeleton`, `progressive.request_opening_pack`, the sole
`progressive.fulfill_host_work` receiver, `progressive.project_opening`, and an
initial `state.move_scene` with
`defer_initial_progressive_on_enter=true`. Cards are conveniences, never a
mandatory Keeper pipeline or a player-action/release gate.

If preparation reports `opening_skeleton_missing` with no source window, treat
its complete `opening_page_candidates` only as bounded selection hints—not
provenance. The host Keeper semantically chooses the shortest sufficient
accepted contiguous current-opening window from `pdf_index`, `review_state`,
`parse_confidence`, and `grep_anchor_preview`. Prefer one page whenever it alone
establishes the playable opening. Three pages is a maximum, never a target:
never pad forward or backward merely to fill it. Include an adjacent page only
when its preview semantically shows that necessary current-opening setup crosses
the page boundary; exclude previews belonging to later travel, overnight beats,
encounters, appendices, or neighboring scenes. This remains advisory live-KP
semantic judgment, never keyword/filename code or a hard gate. Reinvoke
`progressive.prepare_opening` with those
`opening_pdf_indices`. While the skeleton is still missing, it validates that
campaign-bound window and returns only its exact hash-bound
`cached_page_refs[].path` entries. Exact-read only those paths. For the first
`progressive.publish_skeleton` submission, copy the closed
`skeleton_argument_contract.prefilled_template`, replace only its location
placeholders, and omit every optional source-evidenced field. Then reinvoke
`prepare_opening` with the selected `start_location_id` and
`opening_pdf_indices` and continue through its returned cards. Never read a
source manifest, the full module, neighboring or unselected pages, or
appendices; never use Bash, `run_terminal_command`, `find`, `ls`, `rg`,
globbing, directory enumeration, repository search, or speculative page reads.
Semantic selection of the grounded start id/title and final prose remains with
the host Keeper; returned cards are advisory and never create a player-action
or output gate.

The exact opening request uses `kind=partial_opening`, priority 100, and
`request_purpose=foreground_opening_slice`; its durable source scope and worker
packet remain bound to the selected accepted page hashes. That result is
`parse_state=partial`, not deep location or module completeness. This component
returns a closed `result_contract.location_pack`; consume its fixed/copy fields,
empty defaults, row templates, and validator enums exactly when constructing
the pack. Do not search implementation code, tests, fixtures, or expand the
whole module before opening; the host Keeper still judges source-grounded
semantics from only the accepted request pages. This component itself does
**not** provide automatic semantic extraction, autonomous queue draining, host
callback/notification, supervision, or the host task lifecycle; those remain
host orchestration responsibilities below. The queue kick may only materialize
a host request. V1a can skip the complete progressive on-enter hook
for the pristine receipt-bound initial transition, but it does not resume that
deferred work. Installed-host activation, launcher repair, host parity, latency
SLOs, and live-KP acceptance remain separate V2/V3 validation work.

When `prepare_opening` also exposes a pending mechanics-locator plan, the live
KP may semantically choose the shortest sufficient contiguous 1–3-page
appendix/roster window from its meta-only candidate previews and invoke the
`progressive.request_locator_pass` card. Repository code never chooses by
keyword/filename and never widens unknown scope to the cache. The resulting
`idle_warm` packet uses the same background source worker and unchanged
fulfillment path; it is soft/deferred and must not delay opening or player
input.

### Pre-confirmation opening warm start

For a fresh campaign with an accepted source bundle, use the player's character
confirmation interval as real overlap. From the completed `scenario.bind_pdf`
call until the pending-confirmation investigator card is delivered, the main KP
does only this bounded setup work:

1. Invoke `progressive.prepare_opening`. If it reports
   `opening_skeleton_missing` with no source window, choose from its bounded
   meta-only catalog, reinvoke it with the selected page indices, exact-read
   only the returned cached paths, and publish the closed minimal template with
   optional fields omitted on the first submission. This pre-skeleton semantic
   step belongs to the main KP and is intentionally **not** described as
   background work.
2. After publishing, reinvoke `progressive.prepare_opening` with the selected
   `start_location_id` and `opening_pdf_indices`, then use the returned card to
   create one
   `kind=partial_opening`,
   `request_purpose=foreground_opening_slice` request over the exact accepted
   contiguous 1–3-page window. Do not read the full module, neighboring-location
   packets, or appendix/mechanics pages.
3. If and only if host capabilities advertise
   `coc_source_pack_worker_v1=true`, invoke `progressive.claim_host_work` once.
   The serialized claimed packet JSON is the entire child task prompt: add no
   prefix, suffix, transcript, optional-row request, or schema hint. For each
   returned packet, actually spawn the existing
   `coc-source-pack-worker` with `background=true`. On Grok, use the focused
   unqualified user-agent projection of that installed plugin definition; Grok
   0.2.106 suppresses MCPs on the plugin-qualified form. Keep its narrow read
   plus named-submit profile without overriding it to read-only. Keep the real
   host task ID only in volatile host-session
   context—never in module truth, campaign truth, or the worker packet.
4. Deliver the pending player-confirmation character card immediately. Do not
   wait for, repeatedly inspect, or foreground the child result.

Claim transfers the exact packet pages to the child for that attempt. After a
claim, the main KP must not read those claimed packet pages itself, manually
construct their source pack, or fulfill the job from its own semantic reading.
The bounded minimum-skeleton selection happened before the claim and is the
only opening-source semantics retained by the main KP in this interval.

On Grok, the source child submits the complete outer result itself through its
named submit-only MCP, whose server validates and merges without the main KP.
The main KP treats the host completion reminder as notification/liveness only:
never call `get_task_output` or `get_command_or_subagent_output`, wait, poll,
inspect the task, retrieve the pack or compact receipt, or call
`progressive.fulfill_host_work` for that child. The child retains its compact
`coc.source-submit-receipt.v1` final output for audit only. Never claim source
success to the player. A failed submission stays open or leased for existing
recovery; do not repair or retry it. Consume durable availability only later,
through a naturally needed canonical entity or mechanics query (including the
required opening projection), never a reassurance query or poll.

For a host adapter without the named direct-submit transport, retain the exact
R28 fallback. On a later turn inspect the completed task at most once without
blocking, then pass every child-owned `results[i]` unchanged as one
`worker_result=result` object plus exact host runtime timing to
`progressive.fulfill_host_work`. Never extract or retype `job_id`, `pack`, or
`related_packs`, combine legacy explicit fields, reconstruct the result, add
defaults, repair, or retry. Trust fallback success only when `ok=true` and
durable `request_status=fulfilled`. Let unfinished work continue while normal
character flow proceeds.
If the pack is durable by final character confirmation, invoke the returned
projection and initial-move cards directly and open play. Only after that final
confirmation may an unfinished `blocking_micro` opening packet become the
current hard dependency; never broaden its page scope to compensate.

When the host lacks the advertised capability, do not pretend to spawn a child,
invent a Task ID, or claim on behalf of an imaginary worker. Leave the exact
request durable and continue honestly through the foreground source path when
it becomes necessary. This lifecycle belongs to scenario import and the main
KP; `coc-character` owns character semantics and confirmation, not source work.

Grok acceptance for this behavior must run through the focused Keeper launcher
and retain evidence of the real host task ID, background start/completion
metadata, and child-side source-submit receipt without parent task-output
retrieval (or the exact fallback fulfillment receipt on a non-direct adapter).
A `producer` label or a
lease-to-fulfillment duration alone is not proof that a subagent ran.

```bash
# After campaign.create + scenario.bind_pdf + host Tier 0–1 skeleton.json.
# Reuse the asset root returned as result.source_cache.asset_root_id:
uv run --frozen python plugins/coc-keeper/scripts/coc_module_project.py \
  --workspace . skeleton --campaign <id> --asset-root-id <asset>
# After host builds opening deep pack JSON:
uv run --frozen python plugins/coc-keeper/scripts/coc_module_project.py \
  --workspace . opening-deep --campaign <id> --asset-root-id <asset> \
  --pack-json /path/to/opening-deep.json
# After host puts a deep pack for a new location, re-enter or:
uv run --frozen python plugins/coc-keeper/scripts/coc_module_project.py \
  --workspace . on-enter --campaign <id> --scene-id <location-id>
```

During play, `state.move_scene` on a progressive campaign:

1. Enqueues `deepen_location` for the destination (priority 100)
2. Merges the deep pack if already in module-assets
3. Applies the bounded map-neighbor prefetch budget, while structured
   `mentions[]` create source-scoped named-only stubs **without** enqueuing
4. Adds `host_hints` when deep extract is still needed (never fabricates handouts)

For a source-bundle-backed root, skeleton compilation must explicitly record
`start_clock_status` (`source`, `not_authored`, `unresolved`, or
`campaign_override`). `source` also requires `start_clock` plus
`start_clock_source_refs`; this prevents an authored opening time from silently
turning into the era default. Deep/partial packs must cite cached pages through
`source_page_indices`, `source_refs`, or `source_span`. The store canonicalizes
those references and binds every nested clue/NPC/secret row to page hashes.
It also carries page scope along structured `mentions[]` into their named-only
stubs; later deepen requests must use that inherited scope rather than list all
cached pages.

Deep-pack `mentions[]` are indexed as source-scoped named-only stubs on scene
entry, but that internal index does not enqueue host extraction by itself.

Deep-pack presence is deliberately stricter than source relationship:
`npc_ids` and embedded `npcs[]` assert that those people are unconditionally
present in the live scene represented by the pack. Related, historical,
conditional, or merely source-mentioned people belong in structured
`mentions[]`; they do not enter `scene.context` and do not start host work.
When play itself brings an authored or campaign-local NPC into or out of a
scene, the KP records that live overlay with `state.npc_presence` rather than
rewriting module truth or inferring presence from a prior conversation.

**Player dig (not only scene enter):** when the investigator materially pursues
a place/NPC/clue that is only named or stubbed (ask about it, insist, head there
in fiction) **without** a scene move yet, call:

| Tool | When |
|------|------|
| `progressive.request_deepen` | KP dig path: structured `{kind, target_id}` only |
| `progressive.request_mechanics` | Resolve an NPC/item's indexed authored parameters without reparsing its body |
| `progressive.follow_mentions` | Batch structured `[{kind,ref_id,raw_label?,source_page_indices?}]` |
| `progressive.status` | Queue + detached worker status + entity parse_state |
| `progressive.fulfill_host_work` | Submit the host PDF semantic pack for one returned open `job_id` |

`state.record_clue` also follows **structured** `mentions[]` on that clue row
(if present) and enqueues deepen jobs. Never keyword-scan free prose for
mentions. Until the host puts a deep pack, play continues with
`evidence_gap` / `dig_pending` — do **not** fabricate handout or secret bodies.

**Background parallel queue (does not block play):**

- Enqueue paths **kick** a detached worker (`coc_module_queue_worker.py`).
- Worker claims `pending` → `in_flight` in a **thread pool**, merges ready deep
  packs into bound campaigns, and writes `module-assets/<root>/host-work/*.json`
  for missing packs (host PDF skill fulfills; no in-repo PDF parse).
- `awaiting_host_pack` is a queue negative-cache result, not completed semantic
  parsing. `progressive.status`, `scene.context`, and `session.resume` surface
  bounded open requests with cached page refs and the exact fulfillment card.
- The host reads `cached_page_refs` first, opens the original PDF only for
  missing indices, and submits the source-bound pack through
  `progressive.fulfill_host_work`; never hand-edit an entity file.
- The resulting pack carries that request's `host_work_job_id`; `put_entity`
  marks it fulfilled and preserves one source-compile timing receipt across
  idempotent re-puts.
- After `put_entity` deep, merge is re-enqueued at priority 100 and the worker
  is kicked again.
- The queue thread pool only performs repository scheduling/merge work. When
  host capabilities expose `coc_source_pack_worker_v1`, the KP leases up to the
  advertised bounded concurrency through `progressive.claim_host_work` and
  sends each returned exact cached-page packet to a native background
  subagent. On Grok direct submit, the child submits the complete outer result
  and the parent never retrieves its output or calls
  `progressive.fulfill_host_work`; only the non-direct fallback parent forwards
  each completed `results[i]` unchanged.
- Requests are grouped by PDF identity + semantic aspect + exact page set.
  Mechanics jobs use only their `mechanics_index` locator pages; narrative
  profile/body pages must not inflate a blocking appendix lookup.
- Uncached requests are not leased in v1. The host PDF skill prepares the
  smallest exact page window, registers it with
  `progressive.register_source_bundle`, then claims again. Unknown scopes stay
  unresolved and never broaden to the whole cache or PDF.

Tier-1 `mechanics_index` is deliberately a locator, not an eager full parse.
When a source NPC with armed or combat potential is materially present and
conflict is semantically approaching, call `mechanics.ensure` early if its
profile is not ready; this is not for every NPC or every turn, and
non-dependent observation, positioning, or parley may continue. If it returns
`source_work_required`, or `combat.resolve` returns `mechanics_not_ready`,
immediately call `progressive.claim_host_work` and spawn the exact packet as
the unqualified `coc-source-pack-worker` with `background=true`. Never bypass
the exact source request with `rules.roll`, `rules.opposed`, copied stub values,
or a generic profile. The current dependent settlement alone may remain
pending under existing `blocking_micro` semantics; no new narrative or output
gate is created.

All indexed subjects sharing those pages are exposed as `batch_subjects` and
should be fulfilled in the same visual pass. On Grok direct submit, never use
`get_task_output` or `get_command_or_subagent_output`; when the same current or
a later naturally needed action resumes, retry only `mechanics.ensure` or
`combat.resolve` to consume the durable profile. Campaign-local generation is
allowed only for an improvised subject or after an accepted `not_authored`
absence receipt, and its deterministic profile is frozen in campaign state for
reuse.

```bash
uv run --frozen python plugins/coc-keeper/scripts/coc_module_project.py \
  --workspace . request-deepen --campaign <id> \
  --kind location --target-id <id> --title '…' --reason player_dig

# Optional explicit controls:
uv run --frozen python plugins/coc-keeper/scripts/coc_module_reuse.py \
  --workspace . worker-kick --parallel 4
uv run --frozen python plugins/coc-keeper/scripts/coc_module_reuse.py \
  --workspace . worker-status
uv run --frozen python plugins/coc-keeper/scripts/coc_module_reuse.py \
  --workspace . process-queue --campaign <id> --parallel 4
# foreground-only tests: COC_DISABLE_QUEUE_WORKER=1
```

`scene.map` shows KP-only `parse_state` (`toc_only` / `deep` / …). Progressive IR
is marked `progressive: true` and may not pass full
`coc_scenario_compile --validate` until more packs fill multi-route clues.

### Cross-campaign reuse (no re-extract)

```bash
# Link library entry ↔ durable asset root (optional)
uv run --frozen python plugins/coc-keeper/scripts/coc_module_reuse.py \
  --workspace . link-library \
  --canonical-module-id <id> --asset-root-id <asset> --file-sha256 <sha>

# New campaign: reuse skeleton + all deep packs by PDF hash
uv run --frozen python plugins/coc-keeper/scripts/coc_module_reuse.py \
  --workspace . reuse --campaign <new-id> --file-sha256 <sha>

# Drain ready deepen jobs (after host put_entity deep packs)
uv run --frozen python plugins/coc-keeper/scripts/coc_module_reuse.py \
  --workspace . process-queue --campaign <id>
```

`module-library install` stamps `progressive_asset_root_id` when a
`progressive-link.json` exists on the library entry.

Contract: `docs/active-plans/coc-on-demand-module-skeleton.md`.

The **full seven-file cold compile** and `module-library` install paths below
remain the supported path for starters and complete chapter packages.

## Clean-Slate Version Boundary

Scenario manifests/stores, campaign saves, module-library caches, and resume
metadata that will be run, resumed, or installed support exactly the current
schema. A missing, older, newer, or malformed version is `version_mismatch`:
name the affected path, delete that campaign/cache, and start or recompile.

Do not migrate, dual-read, decode through a legacy fallback, remap old IDs, or
preserve IDs from an unsupported artifact. Current-schema materialized views
and transactional backups are crash-safety mechanisms, not compatibility
layers. Historical battle/evaluation reports remain read-only reference and
must not be resumed or presented as current qualifying evidence.

Coverage/visited unions are evaluator-only post-run evidence. Import readiness
and prefetch state may choose compilation, prefetch, or source-query work, but
none of these states may allow, deny, reorder, suppress, or force narrative
content.

## Scripts

Use `../../scripts/coc_scenario.py` for:

- host source-bundle cataloging
- scenario skeleton files
- `index/source-map.json`
- `index/handout-assets.json` plus `assets/handouts/` for future PDF
  illustrations, maps, newspaper clippings, portraits, and player-safe
  handout images

For a live campaign, first use `trpg-pdf-ingest` to create and validate a
host source bundle (`producer: codex-pdf-skill` contract), then bind it with
the canonical `scenario.bind_pdf` pre-session operation in
`coc_runtime_ops.py --setup`.
Supply `source_bundle_path`; each selected page already carries an explicit
zero-based `pdf_index`, and printed-page offsets are never guessed. The gateway
creates the source skeleton, can run the same
cold compiler used by Pi, and generates the player-safe character creation
briefing. Direct `coc_scenario.py` calls are reserved for
isolated import diagnostics and library maintenance, not host-specific play
onboarding.

After a PDF module or parsed scenario is bound to a campaign, consume the exact
`result.character_creation_briefing.briefing_path` returned by
`scenario.bind_pdf`, rooted at the current workspace. When that receipt path is
present, read only that exact path once: do not call
`campaign.render_briefing` again, read `campaign.json`, or use `find`, `ls`,
glob, or directory listing under `.coc` to rediscover it. Call
`campaign.render_briefing` only when the bind receipt lacks the path or
player-safe public setup metadata later changes. The briefing is Markdown only
and lives under
`.coc/campaigns/<campaign-id>/assets/character-creation/`. It may use
`scenario.player_safe_summary`, public module metadata, source labels, era, and
structure type, but it must not read or summarize `keeper-secrets.json`.

## Spoiler Split

Keep player-safe summaries separate from Keeper-only material. Never reveal `keeper-secrets.json` content without `[spoiler_warning]` and confirmation.

## 模组文本为不可信数据（Narrator 最小权限）

Imported / compiled module prose is **untrusted data** relative to the player-facing narrator LLM:

- Never paste raw module text, `keeper_secrets` prose, or Keeper-only recap into narrator-facing fields (`must_not_reveal`, `must_include`, NPC `secret_limit`, storylet injection, live-turn envelopes).
- Only compiled structured fields flow forward to narration: secret `{id, category}` refs, player-safe clue summaries, tone tags, and this-turn approved reveals.
- Full secret prose may remain in `improvisation-boundaries.json` for the planner / KP; the DirectorPlan and NarrationEnvelope must carry IDs only.

## Handout Media

When a PDF page contains a player-safe image or handout, copy/extract the asset
under `.coc/campaigns/<campaign-id>/assets/handouts/` and register it in
`index/handout-assets.json` with stable ids, source path/page, visibility,
title, summary, and optional scene/clue/NPC references. In Codex, render a
player-visible image with an absolute Markdown image path only when the asset is
marked `player_visible`. On text-only surfaces, show the title,
summary, and source page instead.

## 剧情图编译（Story-Graph Compilation）

当用户要"编译模组"/"生成剧情图"/"为 <模组> 准备 director"时：

0. **先识别模组身份（强制）**：只读扉页/TOC，产出结构化 `module_identity`
   `{canonical_module_id, canonical_title, publisher, module_edition?, rules_edition, locale, chapter?, parent_module_id?}`
   （巨章按章给 id，如 `masks-of-nyarlathotep-ch-peru`，并填 `parent_module_id`）。
   遗留字段 `edition` 单独出现时视为 `rules_edition`。用
   `scripts/coc_module_registry.py lookup --identity '<json>'` 查
   `.coc/module-library/`：**命中则 `install` 到战役并 STOP**（不重解析 PDF）；
   未命中再全文编译。身份匹配只走结构化 id / 规范化 alias（title + rules_edition），禁止模糊标题扫描。
1. 用宿主 PDF skill 读取模组 PDF（优先宿主自带；没有则推荐 openai/skills
   开源 `pdf` 工作流），产出逐页 Markdown/资源和 manifest；
   仓库 formatter 校验后只读取该 bundle（巨章只抽本章页）。
2. 判定 structure_type（参考 references/compile-protocol.md 的 7 种原型判定）。
3. 按顺序产出 7 个 JSON 到 campaigns/<id>/scenario/（schema 见 references/story-graph-schema.md）：
   module-meta（含 `module_identity`）/ story-graph / clue-graph / npc-agendas / threat-fronts / pacing-map / improvisation-boundaries
   - **story-graph.json 的 social/investigation 场景必须带 ≥2 条 `affordances`（含语义 `route_type`）；开场场景带 `storylet_tags`。** 详见 references/compile-protocol.md「场景多路线与 storylet 标签」。这让玩家在每个调查/社交场景都有选择权、不被线性推向单一出口。
   - **新编译剧本应显式产出 `scene_edges`（`to` + 结构化 `when` + `kind`）**，不要依赖 `scenes` 数组顺序当线性轨道。详见 story-graph-schema.md 的 unlock 模型。
4. 对 npc-agendas.json 跑 `coc_npc_roles.expand_from_dir`（按 relationship_to_investigators 注入 social_role，详见 references/compile-protocol.md）。
5. 跑 `scripts/coc_scenario_compile.py --validate <dir>` 校验结构完整性。
6. 校验报告的缺漏逐个补，直到 errors 为空。
7. 写 player-safe recap + keeper-only recap。
8. `coc_module_registry.py register` 写入模块库，并把当前 title/locale 记为 alias。

关键约束：每个 critical conclusion 至少 3 条线索路径；keeper_secrets 与 player-safe 物理隔离。

## Product Identity 存储边界

`.coc/module-library/` 可缓存**编译后的结构化索引**（7 文件 JSON 图、identity、LICENSE-note），供同模组异名 PDF / 译本二次命中时跳过解析。

Cache lookup/install requires the exact current schema. On
`version_mismatch`, delete the entry and recompile; never adapt it in place.

- **可入库 / 可缓存：** 结构化 ID、标签、枚举、机制字段、为游玩撰写的 player-safe 摘要、`source_refs`（path + **印刷页**）。
- **不得提交到 git 的源散文：** 从 PDF 原样抄录的模组正文、handout 全文、keeper-secret 叙事段落。Chaosium 等出版社的 Product Identity 留在本地 PDF；registry 注册时会在每个库条目写入 `LICENSE-note.md` 提醒此边界。
- 源 PDF 路径只作本地引用，不要把受版权保护的模组文件推进仓库。

## Epistemic Sidecars

After the seven canonical scenario files validate, a belief-aware compile may
also emit optional `epistemic-graph.json` and `reveal-contracts.json`. Questions
must reference structured clue ids; `reframe` evidence requires a reveal
contract with at least two setup clue refs and non-empty `preserve_as_true`.
Missing or failed sidecars keep the validated current base Scenario IR
playable and never roll it back.

## Artifact-Mediated Epistemic Compilation v2

After the canonical seven-file Scenario IR is green, compile belief-aware
sidecars through an artifact exchange. Deterministic code must not infer module
meaning itself.

```bash
uv run --frozen python plugins/coc-keeper/scripts/coc_epistemic_compile.py request \
  <campaign>/scenario --artifacts-dir <artifacts>

# An LLM semantic evaluator reads epistemic-compile-request.json and writes
# epistemic-compile-result.json with the exact request SHA-256.

uv run --frozen python plugins/coc-keeper/scripts/coc_epistemic_compile.py install \
  <campaign>/scenario \
  <artifacts>/epistemic-compile-request.json \
  <artifacts>/epistemic-compile-result.json
```

The request contains stable IDs, enums, explicitly player-safe summaries,
source locators/confidence, and secret `{id, category}` references. It excludes
raw NPC agenda/fear/secret prose, danger moves/impulses, full-clock outcomes,
Keeper secret prose, and local evidence text.

Installation rejects a stale request hash, wrong evaluator, malformed sidecars,
unknown or duplicate confidence-node IDs, missing reasons for critical questions
or reframe contracts, and any complete-scenario validation error. Successful
installation writes:

```text
epistemic-graph.json
reveal-contracts.json
compile-confidence.json
```

For current-version batch compilation only:

```bash
uv run --frozen python plugins/coc-keeper/scripts/coc_epistemic_compile.py scan <campaign-root>
uv run --frozen python plugins/coc-keeper/scripts/coc_epistemic_compile.py request-all \
  <campaign-root> <artifact-root>
```

A partial sidecar set is reported; it is never silently filled with guessed
semantics. Missing or failed sidecars use the current base Director behavior
until a validated semantic result is installed. Batch commands reject a
version-mismatched campaign rather than migrate or dual-read it.

When a critical source cannot pass the evidence gate, emit a structured source
resolution request and keep the cognitive treatment at `HOLD`; never improvise a
replacement truth.
