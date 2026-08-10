---
name: coc-map-supply
description: Pi-Coc keeper-only PDF 地图、插图与纯图像 handout 的强制检查、外部渲染资产校验及视觉供给。
---

# 地图/图像供给（Pi-Coc）

适用轨道：`ACTIVE_IMPLEMENTATION_TRACK=pi-coc`。本 skill 只保证 KP 能看见有来源的原页图像；它不转写图片、不替 KP 判断地图含义，也不把守秘素材送进玩家通道。

## 为什么必须检查

pdf-inspector native 可能把地图页降成仅标题或图注，且这类页面仍会被标作 native text，**不会**自动进入 `needs_ocr`。所以每个已取得的 native `pages/` 缓存都要先运行确定性清单；不能仅依赖 OCR 队列，也不能因页面有几个文字而跳过。

## 强制检查清单

KP 在拿到 native 页面缓存、并派发 `steward-scene` 前调用 Pi 工具：

```text
coc_map_supply({operation:"detect", pages_dir:"<absolute pages dir>", needs_ocr:[<pdf_index>...]})
```

该检测器标记以下任一页为 `needs_image`：

1. Markdown 标题恰为或以「图 N／地图 N／插图／示意图」命名；
2. 清理 Markdown 标记后的文字密度不超过 80 个字符。

返回的 `needs_ocr_or_image` 是与既有 `needs_ocr` 的去重并集。标题和低密度仅是**强制视觉检查**的确定性信号，不是地图含义、玩家可见性或场景关联的语义判断。

将 `needs_image`、每页 `reasons` 和后续 asset refs 一并给 `steward-scene`。管家据原页、图注和场景上下文确认 `Map{id,caption,page_ref,linked_locations,image_ref}`；不确定关联时保留页引用，不臆造地点。

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
coc_map_supply({operation:"render", pages_dir:"<absolute pages dir>", asset_root_id:"<asset root>", source_pdf_path:"/absolute/module.pdf", needs_ocr:[...]})
```

Pi 只接受输出目录内的 png/jpeg/webp、大小不超过 20 MiB 的图像，计算 SHA-256，并写 `images/map-supply/manifest.json`。外部 command 缺失、失败、JSON 非法、路径逃逸或少页时失败关闭；不得以 OCR 文字、截图描述或 KP 想象代替原图。

## KP 视觉消费与玩家边界

当当前 SceneBundle 的 `maps_ref` / `image_ref` 指向已校验资产，KP 在需要视觉理解时调用：

```text
coc_map_supply({operation:"present", image_ref:".coc/module-assets/<root>/images/map-supply/page-0016.png", caption:"地图 1；守秘人专用"})
```

Pi 用 `display:false` custom message 注入 text + base64 image content。该消息在 KP 模型上下文中可见、TUI 不显示；Pi 的 custom-message 通道和 image content array 是此路径的宿主证据。不要把图像转成玩家消息、handout，或直接复述守秘地图内容。玩家可见内容仍只有 `turn.finalize.rendered_text`。

`display:false` 不是密码学 ACL；同一操作者可访问本地会话/工作区的限制仍须如实说明。

## SceneBundle / steward 记录

Map 的薄 schema：

```json
{"id":"map-page-0016","caption":"地图 1","page_ref":"pdf_index-16","linked_locations":["farmhouse"],"image_ref":".coc/module-assets/<root>/images/map-supply/page-0016.png","source_refs":["module-assets/<root>/pages/0016.md#pdf_index-16"],"secrecy":"keeper_only"}
```

`maps_ref` 可留在 SceneBundle current/neighbor 的可扩展内容中；现有 `steward.domain_put` 和 `steward.scene_bundle_put` 已允许这些字段，不新增 canonical operation 或 archive 条目。图像供给失败应在 scene 域记录失败原因/页引用；KP 等待可用原页，而不是编造地图信息。
