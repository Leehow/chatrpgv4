---
name: coc-map-supply
description: Pi-Coc PDF 地图、插图与纯图像 handout 的强制检查、外部渲染资产校验、守秘图 KP 视觉供给与玩家可见地图原文卡。
---

# 地图/图像供给（Pi-Coc）

适用轨道：`ACTIVE_IMPLEMENTATION_TRACK=pi-coc`。本 skill 只保证 KP 能看见有来源的原页图像；它不转写图片、不替 KP 判断地图含义，也不把守秘素材送进玩家通道。

## 候选页从哪里来

上游在语义审阅页面后，以结构化 `candidate_pdf_indices` 指出需要原图视觉供给的页。这个判断是语义编译结果；不得由标题关键词、正则、文字密度或 Markdown 片段替代。`needs_ocr` 仍是 producer 给出的独立技术清单，不代表页面是地图、玩家 handout 或 Keeper 图。

## 结构化候选检查

KP 收到候选页后调用 Pi 工具验证这些页确实存在于已接受的 `pages/` 缓存：

```text
coc_map_supply({operation:"detect", pages_dir:"<absolute pages dir>", candidate_pdf_indices:[<pdf_index>...], needs_ocr:[<pdf_index>...]})
```

返回的 `needs_image` 只是已验证存在的结构化候选页；`needs_ocr_or_image` 是它与既有 `needs_ocr` 的去重并集。候选页缺失时失败关闭。检测器不读取页面正文，也不判断地图含义、玩家可见性或场景关联。

将 `needs_image`、每页 `reasons=structured_candidate_ref` 和后续 asset refs 一并给 `steward-scene`。管家据原页、图注和场景上下文确认 `Map{id,caption,page_ref,linked_locations,image_ref}`；不确定关联时保留页引用，不臆造地点。

## 渲染与资产

仓库不解析或渲染 PDF。配置一个绝对路径、可执行的外部 producer：

```bash
export COC_MAP_RENDER_COMMAND=/absolute/path/to/map-page-renderer
```

它从 stdin 接收一条 JSON：

```json
{"schema_version":1,"operation":"render_pages","source_pdf_path":"/absolute/module.pdf","pdf_indices":[16],"output_dir":"/absolute/workspace/.coc/module-assets/<root>/images/map-supply"}
```

并只在 stdout 返回一条 JSON：

```json
{"schema_version":1,"status":"ok","images":[{"pdf_index":16,"path":"/absolute/.../images/map-supply/page-0016.png"}]}
```

KP 调用：

```text
coc_map_supply({operation:"render", pages_dir:"<absolute pages dir>", candidate_pdf_indices:[...], asset_root_id:"<asset root>", source_pdf_path:"/absolute/module.pdf", needs_ocr:[...]})
```

Pi 只接受输出目录内的 png/jpeg/webp、大小不超过 20 MiB 的图像，计算 SHA-256，并写 `images/map-supply/manifest.json`。外部 command 缺失、失败、JSON 非法、路径逃逸或少页时失败关闭；不得以 OCR 文字、截图描述或 KP 想象代替原图。

## KP 视觉消费与玩家边界

当当前 SceneBundle 的 `maps_ref` / `image_ref` 指向已校验资产，KP 在需要视觉理解时调用：

```text
coc_map_supply({operation:"present", image_ref:".coc/module-assets/<root>/images/map-supply/page-0016.png", caption:"地图 1；守秘人专用"})
```

Pi 用 `display:false` custom message 注入 text + base64 image content。该消息在 KP 模型上下文中可见、TUI 不显示；Pi 的 custom-message 通道和 image content array 是此路径的宿主证据。不要把守秘图像转成玩家消息、handout，或直接复述守秘地图内容。玩家可见内容仍只有 `turn.finalize.rendered_text` 与已交付的原文卡（见下节）。

`display:false` 不是密码学 ACL；同一操作者可访问本地会话/工作区的限制仍须如实说明。

## 玩家可见地图卡（原文卡路径）

`maps_ref` 的既有语义是 keeper_only：`present` 仅供 KP 视觉消费，这条边界不变。玩家可见地图不再由 KP 转述，而是走原文信息卡路径：一张 `kind:"map"` 且 `image_ref` 指向已校验 map-supply 资产（或 bundle 资产相对路径）的 handout 条目，带 `source_refs` 与语义化的 `when_to_deliver`，与手稿/朗读卡共用同一交付机制（`state.deliver_handout`）。判定"这页图是玩家应得的地图"是页义/场景语义判断；结构化候选只授权校验/渲染页引用，不构成卡识别或交付决定。

交付后，玩家经交付投影看到地图图面；KP 叙述只做 framing（在哪里、由谁得到），不复述图像内容。守秘地图（守秘人专用标注、未揭示布局）仍只走 `present`，永不进入 handout。

`COC_MAP_RENDER_COMMAND` 未配置或渲染失败时不阻塞、不伪造：降级为无图文字卡——标题 + caption + 页面 Markdown 中逐字可溯源的文字描述（`text` 逐字摘录、`source_refs` 必填）；外部渲染可用后可再补 `image_ref`。缺图不构成玩家获得该地图信息的额外门槛。

## SceneBundle / steward 记录

Map 的薄 schema：

```json
{"id":"map-page-0016","caption":"地图 1","page_ref":"pdf_index-16","linked_locations":["farmhouse"],"image_ref":".coc/module-assets/<root>/images/map-supply/page-0016.png","source_refs":["module-assets/<root>/pages/0016.md#pdf_index-16"],"secrecy":"keeper_only"}
```

`maps_ref` 可留在 SceneBundle current/neighbor 的可扩展内容中；现有 `steward.domain_put` 和 `steward.scene_bundle_put` 已允许这些字段，不新增 canonical operation 或 archive 条目。当一张地图的语义是玩家可见（而非 keeper_only）时，它同时是一张 `kind:"map"` 的原文卡（见「玩家可见地图卡」），经交付通道到达玩家；SceneBundle 的 Map 记录仍负责 KP 侧来源与关联。图像供给失败应在 scene 域记录失败原因/页引用；KP 等待可用原页，而不是编造地图信息。
