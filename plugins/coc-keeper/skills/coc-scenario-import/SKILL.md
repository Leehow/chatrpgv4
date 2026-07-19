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

**Implemented now (slices 1–3):**

| Step | Tool |
|------|------|
| Init durable root | `coc_module_assets.py init` |
| Store skeleton | `coc_module_assets.py put-skeleton` |
| Project topology → campaign sparse IR | `coc_module_project.py skeleton` |
| Store pages / stubs / queue | `put-page`, `ensure-stub`, `enqueue` |
| Opening deep → campaign IR | `coc_module_project.py opening-deep` |
| Enter scene hot-ring | automatic via `state.move_scene`, or `coc_module_project.py on-enter` |
| Map depth | `scene.map` → `parse_state` / `evidence_gap` per scene |

```bash
# After campaign.create + host Tier 0–1 extract + skeleton.json:
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
3. Stubs + enqueues depth-1 neighbors and structured `mentions[]`
4. Adds `host_hints` when deep extract is still needed (never fabricates handouts)

**Player dig (not only scene enter):** when the investigator materially pursues
a place/NPC/clue that is only named or stubbed (ask about it, insist, head there
in fiction) **without** a scene move yet, call:

| Tool | When |
|------|------|
| `progressive.request_deepen` | KP dig path: structured `{kind, target_id}` only |
| `progressive.follow_mentions` | Batch structured `[{kind,ref_id,raw_label?}]` |
| `progressive.status` | Queue + detached worker status + entity parse_state |

`state.record_clue` also follows **structured** `mentions[]` on that clue row
(if present) and enqueues deepen jobs. Never keyword-scan free prose for
mentions. Until the host puts a deep pack, play continues with
`evidence_gap` / `dig_pending` — do **not** fabricate handout or secret bodies.

**Background parallel queue (does not block play):**

- Enqueue paths **kick** a detached worker (`coc_module_queue_worker.py`).
- Worker claims `pending` → `in_flight` in a **thread pool**, merges ready deep
  packs into bound campaigns, and writes `module-assets/<root>/host-work/*.json`
  for missing packs (host PDF skill fulfills; no in-repo PDF parse).
- After `put_entity` deep, merge is re-enqueued at priority 100 and the worker
  is kicked again.

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

After a PDF module or parsed scenario is bound to a campaign, use the briefing
returned by `scenario.bind_pdf`; `campaign.render_briefing` regenerates it when
public setup metadata changes. The briefing is Markdown
only and lives under
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
