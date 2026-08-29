# ModuleGraph → Pi-Coc KP 集成规范

> **Status:** Slice 1 query-integrated / natural-play acceptance partial — deterministic/toolbox/MCP gates and a fresh Pi model-visible exact-discovery → search → semantic-seed → expand probe pass. A natural earned investigation remains blocked by the separate early-output/early-journal behavior documented in [Slice 1 status](../status/module-graph-to-kp-slice1.md); Graph → Scenario IR projection remains pending.
> **ID:** `module-graph-to-kp-integration`
> **Track:** `ACTIVE_IMPLEMENTATION_TRACK=pi-coc`; Codex-host implementation is off-limits.
> **Scope:** accepted ModuleGraph 的 Keeper-only 查询、语言展示边界与单一来源晋升路径；不实现因果任务系统、campaign fact writes、Neo4j 或 GraphRAG。
> **Depends on:** [module-knowledge-graph-extraction.md](module-knowledge-graph-extraction.md), [pi-coc-causal-quest-system.md](pi-coc-causal-quest-system.md).

本文中的 MUST / MUST NOT / SHOULD 是验收要求。

---

## 1. User job

用户要让已经编译好的整套模组知识图谱真正进入 Pi-Coc 的 KP 工作面，而不是停留在离线诊断工具；同时不能把 KP 变成固定流程、把 source graph 当 campaign state，或在图谱中混入用户语言翻译。

成功意味着：

- KP 在一个具体来源疑问出现时，可以通过正常 toolbox/MCP 路径定位图谱候选并展开有限邻域；
- lexical matching 只缩小候选，KP 仍语义判断相关性、适用性、可见性和因果意义；
- ModuleGraph 的 canonical prose 始终保持解析来源的 `source_language`；
- KP 只在最终桌面表达时按 campaign `play_language` 临时本地化，不回写图谱、alias、Scenario IR 或 campaign state；
- keeper-only、revealable 与 player-safe 边界不因查询或翻译改变；
- 图谱缺失、partial、损坏或搜不到内容都不会阻塞 play，也不会被解释为世界中“不存在”；
- 图谱最终成为 source semantic compilation 的单一权威输入，现有 Scenario IR/compiled archive 作为运行时物化视图继续服务已有工具；
- 正常 Pi-Coc KP 能发现和使用该能力，不需要直接读 graph JSON、manifest、module-assets 或调用 shell。

Hollow delivery 包括：

- 只新增 CLI 或测试 harness，正常 KP 不可发现；
- 把整个 ModuleGraph 自动塞进每个 `scene.context`；
- 用关键词命中直接决定 clue relevance、NPC 动机、Quest 完成、秘密揭示或下一幕；
- 让检索工具自动选择一个最高分节点并当成事实；
- 把中文翻译追加进英文 source graph 的 aliases，或把翻译缓存回图谱；
- 新建第二套 Keeper、状态库、历史库、rules shell 或固定 turn pipeline；
- 图谱失败时返回权威空集，导致 KP误判“没有这个人/线索/路线”；
- 同一个新模组同时从 PDF 独立编译 ModuleGraph 和七份 Scenario IR，长期保留两套语义抽取权威。

---

## 2. Confirmed current system and gap

当前已经存在：

- `coc_module_graph.py`：source-bound ModuleGraph v3，支持 immutable generation、manifest validation、lexical search 与 bounded context；
- `scenario.bind_pdf` / progressive module-assets：campaign 与 source asset root 的 canonical binding；
- `coc_toolbox.py`：唯一 KP tool registry、统一 envelope 与 MCP archive；
- `scene.context / clues.query / npc.query`：现有 Scenario IR、compiled archive 与 live state 的正常 Keeper 工作面；
- `play_language`：campaign 的玩家展示语言；
- `state.* / rules.* / Git history`：campaign truth、机械结算与历史权威。

缺口恰为：ModuleGraph 没有注册进 toolbox，KP 只能通过离线 CLI 使用；它也没有明确的语言展示 contract 或对 Scenario IR 的晋升/退休路径。

本阶段优先完成最小 source-context vertical slice，而不是同时重写七份 IR、Director、Quest v2 或 progressive source worker。

---

## 3. Domain model

| Term | Meaning | Authority |
| --- | --- | --- |
| ModuleGraph | 对一个来源模组的 evidence-bound、只读语义编译结果。 | Accepted GraphShards + deterministic build manifest。 |
| Source Graph Candidate | lexical narrowing 返回的候选节点卡；它只是候选，不是语义匹配结论。 | Rebuildable ModuleGraph index。 |
| Source Context | 从一个或多个 exact semantic node IDs 展开的有限 Keeper-only 图邻域。 | ModuleGraph 的只读 projection。 |
| Scenario IR | `story-graph / clue-graph / npc-agendas / ...` 等现有运行时物化视图。 | 在 cutover 前维持当前运行权威；cutover 后由 ModuleGraph projection 生成。 |
| Campaign Canon | 玩家行动、KP 即兴、实际事件、知识、关系、资源和矛盾。 | Canonical state/rules writes + Git-backed history。 |
| Presentation Localization | KP 将 source-language meaning 临时表达为 `play_language` 的行为。 | Live KP semantic judgment；无持久化产物。 |
| Source Gap | Graph 缺失、partial、unresolved 或当前 packet 尚未覆盖的来源范围。 | BuildManifest + coverage；不是 false fact 或 hard gate。 |

关键区分：

```text
authored source truth       -> ModuleGraph
runtime query/material view -> Scenario IR / compiled archive / Source Context
what actually happened      -> campaign state + Git history
what the player hears        -> KP presentation in play_language
```

ModuleGraph 不记录“调查员已经发现”“NPC 当前在场”“Quest 已完成”或即兴正典。Campaign canon 可以改变 authored fact 的当前适用性，但不得改写 source graph。

---

## 4. Single authority and promotion path

选择以下单一路径：

```text
external PDF extraction
  -> accepted page Markdown
  -> ModuleGraph (canonical source semantic compilation)
  -> typed projections
       -> existing Scenario IR
       -> compiled archive
       -> bounded direct Source Context
  -> live state overlays at query time
```

### 4.1 Source authority

新 graph-backed 模组的 source semantic authority MUST 是 ModuleGraph。七份 Scenario IR 在最终 cutover 后 MUST 是可重建物化视图，不再独立阅读 PDF 重新理解一遍。

### 4.2 Staged retirement

本阶段只落 `module.context` 查询 slice，因此暂不声称 Graph → Scenario IR projection 完成。退休顺序为：

1. 先让正常 KP 通过 `module.context` 消费 accepted graph，证明查询、秘密和语言边界；
2. 再逐域实现 Graph → Scenario IR projection，并做 parity evidence；
3. graph-backed campaign 的 projection 达到 exact-current contract 后，禁止再走 direct-PDF 七文件语义编译；
4. starter/历史非 graph-backed 路径保持原状，直到它们单独完成 graph build；不加 dual reader 或迁移器；
5. 最终删除 graph-backed direct-PDF duplicate extraction 分支，而不是永久同时维护两套来源真相。

在第 3 步前，本能力只能标记为 `query-integrated / projection-migration-pending`，不能标记 source pipeline 完全切换。

---

## 5. Deep module and seam

### 5.1 Module Source Context module

新增一个深 **Module Source Context module**，外部只有一个 Keeper interface：

```text
module.context(query? | seed_ids?, depth?, limit?) -> SourceContextResult
```

它隐藏：

- campaign → source asset root 的 canonical resolution；
- BuildManifest、generation 与 graph digest validation；
- graph unavailable / invalid / partial 的区分；
- lexical candidate retrieval；
- exact semantic seed 的有限深度遍历；
- keeper-only projection；
- source refs 的 model-safe sanitization；
- `source_languages` 与 campaign `play_language` 的 presentation contract；
- fixed budgets、排序与稳定错误语义。

删除该 module 会迫使每个 KP caller 重新学习 module-assets 路径、manifest、hash、visibility、语言和遍历细节，因此它具备足够 Depth。

### 5.2 Interface modes

接口不增加显式 `mode` 字段；形状本身决定 mode：

| Arguments | Mode | Result |
| --- | --- | --- |
| neither `query` nor `seed_ids` | `status` | availability、language、coverage、source gaps |
| non-empty `query` only | `search` | bounded candidate cards only |
| non-empty `seed_ids` only | `expand` | bounded graph neighborhood |
| both supplied | invalid request | fail closed；KP semantically chooses seeds after search |

参数 contract：

- `query`: non-empty string，max 240 Unicode scalar values；由 KP 选择 source-language search wording；
- `seed_ids`: 1–8 个唯一 semantic node IDs；
- `depth`: 0–2，默认 1，仅 `expand` 使用；
- `limit`: 1–12，默认 8，仅 `search` 使用；
- no `asset_root_id`、path、hash、manifest ref、campaign state revision 或 audience parameter。

Runtime 通过 current campaign binding 注入 asset root。模型不得选择任意 module-assets root，也没有 player-facing graph mode。

Binding priority is semantic, not path probing: a progressive/source-bound
campaign uses its canonical source root; a complete starter without that root
may reuse its canonical source-backed `handout_asset_root_id`. The operation
never accepts an asset-root argument and never scans unrelated roots.

### 5.3 Illustrative result

```json
{
  "schema_version": 1,
  "mode": "search",
  "available": true,
  "module": {
    "module_id": "module-dust-to-dust",
    "graph_contract_id": "coc.module-graph.v3",
    "build_status": "partial",
    "source_languages": ["zh-Hans"],
    "coverage": {"actors": "accepted", "knowledge": "accepted"},
    "source_gaps": ["structure", "world", "relationships"]
  },
  "presentation": {
    "play_language": "en",
    "localization_required": true,
    "persistence": "none",
    "authority": "keeper-semantic-presentation"
  },
  "candidates": [{
    "node_id": "npc-mary-ann-lassman",
    "node_kind": "npc",
    "name": "玛丽·安·拉斯曼",
    "visibility": "revealable",
    "matched": "name_or_alias"
  }],
  "context": null,
  "authority": {
    "source_truth": "module-graph",
    "campaign_applicability": "live-state-and-kp-judgment",
    "semantic_match": false,
    "hard_gate": false
  }
}
```

Machine digests、grep anchors、opaque generation names 和 raw manifest paths MUST NOT 出现在模型响应中。`source_refs` 只保留 semantic `source_id + pdf_index`；EvidenceSpan ID 可保留，因为它是 semantic ID。

---

## 6. Retrieval law

- Search is lexical candidate narrowing over semantic IDs、canonical names、aliases、summaries和 scalar properties。
- Search score只在同一 result set 内排序；不得解释为“剧情正确率”“NPC真实性”或“下一步优先级”。
- Search MUST NOT 自动展开 top-1 并把它当事实。KP 从候选中语义选择 exact `seed_ids`，然后再 expand。
- Expand 只遍历 source-bound claims/relations；它不结合 live state、不判断当前可行性、不计算 Quest ready/blocked。
- Meaning-bearing decisions remain KP-owned。未来 `causal.context` 可以将 authored graph declarations 与 live facts 组合，但 `module.context` 不抢它的职责。
- Query miss 返回 `not_found_in_compiled_scope`，不是 `does_not_exist`。
- ModuleGraph partial/unresolved 必须随每次结果显式出现，避免空结果被误读为完整世界否定。

本地 substring index 是当前足够实现。Neo4j full-text index或其它存储只有在真实大模组基准证明 JSON 扫描成为瓶颈后才可作为内部 Adapter；其引入不得改变 interface、authority 或返回语义。

---

## 7. Language and presentation law

1. ModuleGraph 中 `name / aliases / summary / reason / properties` 保持 parsed source artifact 的 `source_language`。
2. `module.context` 原样返回这些 source-language meanings；不产生 `localized_text`，不缓存翻译。
3. 每个 response 返回 `source_languages` 与 campaign `play_language`。
4. 当语言不同，KP 在理解来源后以 `play_language` 独立撰写桌面表达；这是 semantic presentation，不是 graph mutation。
5. 翻译结果不得写入 ModuleGraph、aliases、Scenario IR、campaign facts、memory assertions 或 tool receipts，除非另一个现有 domain contract 本来就拥有一份 player-visible localized field。
6. 专有名词可按 KP 判断保留、音译或意译；这种选择属于当前桌面表达，不改变 source identity。
7. Exact handout/document/read-aloud body 不走本接口翻译。它继续由 canonical handout delivery 的 `text / localized_text` contract 管理。
8. Diegetic foreign speech 继续遵守 investigator Language skill 与 `coc-keeper-play` 规范。

如果 `source_languages` 与 `play_language` 不同，KP 应把玩家意图语义转换成 source-language search wording；这种转换由 KP 完成，工具不使用字典、关键词映射或隐藏 LLM。

---

## 8. Secrecy and campaign canon

- `module.context` policy 是 Keeper-only `module_secret` context read；不进入 player hotset。
- Search 可以返回 keeper-only/revealable 候选给 KP，但结果永远不是 reveal receipt。
- Expand 不根据 player guess 自动改变 visibility。正确猜测仍是猜测。
- Player knowledge只由已交付 fiction、clue/state writes、handout delivery和公开机械结果建立。
- Source graph 只说明 authored declaration；live state 对当前 presence、relationship、knowledge、items、clocks、effects 和 scene applicability 拥有优先权。
- 当 campaign canon 与 source declaration 矛盾，保留两者及 provenance；进入现有 contradiction/narrative-debt 机制，不修改 ModuleGraph。
- Graph context 不直接进入 `turn.finalize` deterministic segments，也不授权任何 state write。

---

## 9. Progressive source behavior

Slice 1 的 `module.context` 是纯读操作：

- 不 enqueue source work；
- 不调用、认领或 fulfill progressive jobs；
- 不等待后台解析；
- 不阻塞玩家输入或 scene transition；
- 不因 source gap 自动扩大 PDF/page scope。

当 query/seed 指向 unresolved 范围时，response 只返回 source gap。未来 progressive integration 必须从 exact semantic node/section refs 生成 bounded deepen request，复用既有 steward/source-worker lifecycle；不得以 free-prose query 直接选择 PDF 页。

---

## 10. Normal Keeper discoverability

`module.context` 注册进唯一 `coc_toolbox` registry，并进入 generated MCP contract archive。它不是 hotset；KP 只在一个具体 source question 不能由当前 `scene.context / npc.query / clues.query` 的正常工作集回答时，通过 exact-operation discovery 加载它。

`coc-keeper-play` 必须说明：

- 已有当前 scene working set 足够时不要额外查询图谱；
- source question 具体出现时 exact-discover `module.context`；
- 先 status/search，再由 KP 语义选 seed expand；
- lexical result 不允许/拒绝/排序玩家行动；
- source prose只用于 KP 理解，最终输出按 `play_language` 独立表达；
- graph unavailable/partial 时继续 play，并把未知保持未知。

不得让 Pi prompt 维护另一份行为规范；canonical Skill 是 instruction owner，Pi generated operation contract 只负责暴露 typed tool。

---

## 11. Failure semantics

| Failure | Required behavior |
| --- | --- |
| Campaign has no source asset root | `available=false, status=unbound`; use existing Scenario IR；play continues |
| Asset root has no graph manifest | `available=false, status=not_compiled`; not an empty world |
| Manifest/graph/digest invalid | `available=false, status=invalid`; warning + existing IR fallback；never return authoritative empty facts |
| Build is partial | return exact coverage/missing shards；search only compiled scope |
| Search miss | `not_found_in_compiled_scope`; KP may use current IR, improvise when allowed, or later request deepen |
| Unknown seed | structured `seed_not_found`; no nearest-name auto substitution |
| Too many seeds/depth/limit | `invalid_param`; no silent truncation of requested identity |
| Source/play language differ | return localization contract；KP translates semantically at presentation time |
| Graph conflicts with live state | live state wins current applicability；preserve contradiction evidence |
| Tool unavailable | optional source context absent；no play/output gate |

---

## 12. External precedent

- [W3C RDF 1.1 Concepts](https://www.w3.org/TR/rdf11-concepts/) models a language-tagged string as lexical form plus a well-formed BCP 47 language tag. Our JSON contract stores language at shard/graph scope rather than adopting RDF, but preserves the same canonical-text + language-identity principle.
- [Neo4j full-text indexes](https://neo4j.com/docs/cypher-manual/25/indexes/semantic-indexes/full-text-indexes/) are queried explicitly and return scored matches; the query planner does not silently turn them into graph truth. We likewise expose explicit lexical candidates and leave semantic selection to the KP.

These precedents validate the interface shape, not a database choice。Slice 1 deliberately keeps the existing JSON graph and substring search because no measured requirement justifies Neo4j/Lucene operational cost。

---

## 13. Smallest implementation slice

### Slice 1 — query-integrated source context

Implement only：

1. one `module.context` toolbox operation；
2. campaign-bound graph resolution and validated installation read；
3. status / search / expand modes；
4. model-safe removal of digests/anchors/paths；
5. source-language / play-language presentation contract；
6. partial/gap/unavailable failure semantics；
7. canonical Skill discoverability；
8. generated MCP/policy projection；
9. one normal toolbox test and one Pi exact-discovery/contract test；
10. one fresh Pi-Coc RPC acceptance where KP consults an English source graph and presents the result in Chinese without persisting translation。

Explicit non-goals for Slice 1：

- no Graph → seven-file Scenario IR projector；
- no automatic graph injection into `scene.context`；
- no `causal.context` / Quest v2 implementation；
- no graph-derived state writes；
- no progressive enqueue from query text；
- no Neo4j、Lucene、embedding、vector DB 或 GraphRAG；
- no player graph endpoint；
- no source-language translation cache。

### Later slices

- Slice 2：exact scene/entity binding cards and graph-derived Scenario IR projection for one domain；
- Slice 3：projection parity across the seven IR files and compiled archive；
- Slice 4：disable direct-PDF duplicate semantic compile for graph-backed campaigns；
- Slice 5：integrate authored causal declarations with future `causal.context`，without moving live facts into ModuleGraph。

---

## 14. Deterministic validation

Tests MUST prove：

- campaign chooses the bound graph root; model cannot pass an arbitrary root/path；
- status distinguishes unbound、not_compiled、invalid、partial、complete；
- query/seed are mutually exclusive and bounded；
- search returns candidates but never auto-selects/expands top-1；
- expand requires exact semantic IDs and is depth/node bounded；
- keeper-only/revealable rows are never projected as player-known；
- graph context contains no SHA、grep anchor、generation name or local path；
- `source_languages` and `play_language` always appear；
- no translation is written anywhere；
- partial/miss never becomes authoritative absence；
- ModuleGraph invalidity does not mutate or replace Scenario IR；
- operation is strict read-only, Keeper-only, `module_secret`, and not a hotset tool；
- MCP contract archive and Pi policy projection are current；
- existing graph compiler, plugin metadata and opposite-track non-regression tests stay green。

Tests MUST NOT infer source relevance, translation quality, player intent or disclosure correctness by keyword assertions。

---

## 15. Product acceptance

Component success is not product success。Slice 1 acceptance uses a fresh exact-current-schema Pi-Coc workspace：

1. bind a real parsed source bundle and accepted ModuleGraph to a fresh campaign；
2. campaign `play_language=zh-Hans` while graph source is English；
3. Pi-Coc RPC starts with Grok as KP；
4. one natural player asks about a graph-backed person/fact not present in the current compact working set；
5. KP exact-discovers and invokes `module.context`，semantically chooses a candidate，then expands it；
6. KP responds naturally in Chinese，without tool/graph jargon and without revealing an unearned secret；
7. inspect campaign artifacts to prove no Chinese translation was written into ModuleGraph、Scenario IR、state、memory or Git source records；
8. preserve all run evidence。Do not export a battle report unless the run reaches a natural ending。

Shared-files + component tests without this path remain `unintegrated`。

---

## 16. Exact implementation impact and authorization boundary

The smallest Slice 1 needs these shared plugin files：

- add `plugins/coc-keeper/scripts/coc_operation_module_graph.py`；
- edit `plugins/coc-keeper/scripts/coc_toolbox.py` to compose that operation module；
- edit `plugins/coc-keeper/scripts/coc_operation_policy.py` to register the `module` Keeper context domain；
- minimally deepen `plugins/coc-keeper/scripts/coc_module_graph.py` so an installed read returns validated graph + manifest metadata；
- edit `plugins/coc-keeper/skills/coc-keeper-play/SKILL.md` for canonical discoverability/localization behavior；
- regenerate `plugins/coc-keeper/references/mcp-operation-contracts.json` and `plugins/coc-keeper/pi/lib/operation-policy.generated.ts`；
- edit `docs/specs/pi-coc-module-ownership.json` and its architecture count test so the new operation cell has one owner；
- add focused tests under `tests/`。

It does **not** need to edit campaign state schemas、rulesets、turn finalization、Git history、Codex-host adapters/prompts、Scenario IR schemas or existing quest runtime。

All listed `plugins/coc-keeper/` kernel/registry/Skill files are cross-track shared scope under repository law。Implementation must not begin until the user explicitly authorizes those exact shared changes for `ACTIVE_IMPLEMENTATION_TRACK=pi-coc`。

---

## 17. Completion contract for Slice 1

“ModuleGraph 已接入 KP 查询面”只在以下全部成立时可说：

1. `module.context` 通过唯一 toolbox registry 与 generated MCP contract 可发现；
2. interface、authority、secrecy、language 与 failure contracts 均有 deterministic tests；
3. normal toolbox path reads a campaign-bound accepted graph without direct file access by the KP；
4. machine integrity fields never进入 model response；
5. graph partial/miss/corrupt 不阻塞 play 或伪装世界否定；
6. final player prose由 KP 按 `play_language` 表达，graph canonical prose 未改变；
7. fresh Pi-Coc RPC/Grok Keeper 路径真实调用该 operation；
8. preserved evidence proves no secret leak、no translation persistence、no state/rules/history authority drift；
9. Graph → Scenario IR projection仍诚实标记 pending，未冒充 source pipeline 已完成切换。

---

## 18. Slice 2 — graph-backed The Haunting starter cutover

### 18.1 Job and scope

The built-in `the-haunting` starter is the first complete projection slice.
Its authored source is the visually reviewed Keeper Rulebook window at PDF
indices 446–462. The committed starter graph becomes the semantic source of
truth; the existing Scenario IR files remain generated materialized views for
the current runtime. This slice includes scenes, clues, NPCs, threats, pacing,
improvisation boundaries, quests, handout metadata, and image/media assets.

The cutover is systemic rather than a one-off overwrite:

1. a generic starter graph projection module validates and materializes the
   current Scenario IR documents from graph-owned projection records;
2. any starter carrying the projection contract installs those materialized
   views instead of copying independently authored JSON;
3. committed materialized views must byte-semantically equal a fresh graph
   projection, so drift fails tests and installation;
4. later starters may use the same contract without adding another installer.

### 18.2 Three storage layers

```text
committed structured graph
  -> English-only semantic facts + projection records + asset metadata
  -> no source-verbatim handout bodies or copyrighted image bytes

generated committed Scenario IR
  -> current runtime materialized views
  -> reproducible from the graph, never an independent source authority

local ignored module-assets root
  -> validated source pages, exact handout bodies, image bytes, hashes
  -> `.coc/module-assets/the-haunting-keeper-rulebook-40th-full-v1/`
```

The repository may commit structured facts, semantic summaries, IDs, source
page refs, and asset roles. Chaosium source prose, boxed text, handout bodies,
maps, and illustration bytes stay in the local ignored asset root. The open
derivative fallback may remain playable when those local bytes are absent,
but on this installation the validated graph/source root is preferred.

### 18.3 Runtime projection contract

The module node owns one
`coc.module-graph-runtime-projection.v1` declaration. Each projected document
has root metadata, its array collection name when applicable, and ordered
semantic node IDs. Every referenced node carries one English-only
`runtime_record`; the deterministic projector reconstructs the exact document.

This projection payload is runtime shape, not a second truth store: it lives
inside the graph node/property model, is hash-bound with the graph, and can be
discarded and regenerated together with the graph. Cross-entity meaning still
uses graph relations. The projector never reads PDF text or infers semantics.

### 18.4 Asset and handout graph

Asset bytes remain external resources whose exact identity is owned by the
validated source-bundle manifest. The graph carries semantic usage only:

- `asset` node: semantic asset ID, media type, source page, visibility,
  presentation role, and optional player-delivery asset ref;
- `handout` node: information-card identity, kind, player visibility,
  source page refs, clue/scene applicability, and optional linked image asset;
- `depicts`: image/illustration → portrayed scene, actor, object, or concept;
- `contains`: source page/document → asset or handout;
- `supports`: handout → clue/conclusion;
- `discoverable-at` / `delivered-by`: authored access routes;
- source bundle manifest, never the graph, owns paths, hashes, media bytes,
  and existence.

This follows the same separation used by the W3C Web Annotation body/target
model and IIIF Presentation annotations: an external media body is associated
with a semantic target, while the resource itself remains independently
identified and authoritative. We reuse the principle, not JSON-LD or a IIIF
server.

All 17 source pages and their 18 MinerU image regions are represented. The two
reviewed player assets (Chapel symbol and combined Investigator Map) are
separate player-safe delivery assets. Decorative, Keeper-map, threat, and
antagonist illustrations remain Keeper-only and are never treated as player
handouts merely because they occur in the source.

### 18.5 Language and handout boundary

- Committed graph and generated Scenario IR retain English source/authoring
  language. `localized_text` caches and Chinese aliases are not stored in the
  graph-backed projection.
- Pregen character display layers are not parsed module source and remain
  outside this cutover.
- Local source handout packs retain English exact text only. KP presentation
  translates semantically to campaign `play_language` at delivery time; no
  translation is written back to graph, IR, entity packs, memory, or history.
- Exact source text remains Keeper-only until a canonical handout/clue delivery
  earns it. Asset linkage never acts as a reveal receipt.

### 18.6 Install and fallback behavior

`coc_starter.install_starter` MUST:

1. validate the committed graph and runtime projection;
2. project the Scenario IR into the unpublished campaign generation;
3. install the graph into the campaign workspace's canonical asset root if an
   identical or newer exact-current graph is not already installed;
4. preserve an existing validated local source/asset/entity store and never
   delete or overwrite its bytes;
5. use the open derivative JSON copy path only for starters without a graph
   projection contract, or fail closed on a corrupt graph-backed starter.

No active campaign is migrated or overwritten. New quick-start/install calls
use the graph-backed projection; historical campaign evidence remains intact.
The complete 17-page source uses a versioned asset root distinct from any
historical partial extraction, so source-page drift is never resolved by
overwriting an old campaign's cached page evidence.

### 18.7 Validation and acceptance

Deterministic tests must prove:

- projection output equals every committed materialized Scenario IR document;
- installer uses graph projection and installs a validated graph generation;
- graph and generated IR contain no CJK module translation cache;
- all projected record IDs exist once and all projection node refs resolve;
- every asset/handout node binds an allowed source page and semantic asset ref;
- local source registration preserves 17 pages, 20 reviewed assets, and 10
  English-only handout/map packs without committing their bytes;
- missing local media leaves structured asset gaps but does not corrupt the
  starter or invent delivery content;
- an expanded `module.context` neighbourhood larger than the MCP hot budget
  keeps bounded semantic nodes, claims, relations, source pages, visibility,
  completeness, and language policy while dropping duplicated Scenario-IR
  runtime records; it must never collapse to identity-only when the requested
  relationship itself fits;
- Keeper/player visibility and normal handout delivery tests remain green.

Product acceptance uses a fresh `the-haunting` quick start on latest mainline,
proves `module.context` reads the complete graph, verifies at least one earned
source-backed information card plus one player image delivery, and confirms
Chinese table presentation without persistent translation.
