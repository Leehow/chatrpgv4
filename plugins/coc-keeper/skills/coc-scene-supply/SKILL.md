---
name: coc-scene-supply
description: Pi-Coc 当前场景与周边预取、source-bound SceneBundle 缓存及素材就绪门控。
---

# 场景供给（Pi-Coc）

适用轨道：`ACTIVE_IMPLEMENTATION_TRACK=pi-coc`。本 skill 只准备 Keeper 的来源素材；它不判断行动、剧情、线索取得、场景顺序或叙事质量。

## 数据面

场景管家将 keeper-only、source-bound `SceneBundle` 写入
`save/steward-state.json` 的 `domains.scene.bundles`，只能通过：

```bash
uv run --frozen python plugins/coc-keeper/scripts/coc_toolbox.py steward.scene_bundle_put --root . --campaign <id> --json '<JSON>'
```

每个 bundle 的 `current` 必须有 `id`、`name`、`source_refs`；`neighbors[]`
中的每个条目含 `scene` 与 `edge`。`SceneEdge` 是
`from/to/kind(next|if|timeline|clue|fail_loop)/condition_text`，还必须携带
`provenance` 与 `source_refs`。目录邻接、同父子、if 链路和时间线是机器可召回
依据；叙事暗线使用 `semantic_inference` provenance，不能无出处补写。

首次 scene 域解析必须写：

```json
{"scene_supply":{"enabled":true,"source_cache_path":"<pages_dir>"}}
```

## 进入与预取

1. Pi 在 `state.move_scene` 前读取 `steward.scene_supply(scene_id)`。
2. 有完整 bundle 时才迁移；返回的 `data.scene_supply` 仅 KP 可用。
3. 迁移成功后，KP 以短命令 resume/dispatch `steward-scene`，预取当前场景的：
   目录相邻节点、同父地点子节点、if 边、时间线下一步，以及管家有来源依据的语义暗线。
4. 将每个可进入的预取结果也写成独立 bundle，带 `prefetched_from`。进入该目标时
   `cache_hit=true` 即为命中。
5. 任务过大时可按地点/时间线/if/地图或章节切 2–4 个子任务；仅管家聚合后写
   bundle，深度最多 KP → 管家 → 子代理。

## 就绪门控与降级

当完整 bundle 未就绪，Pi 拒绝本次 `state.move_scene`，KP 只向玩家发送：

> 场景载入中……

随后派发或 resume `steward-scene`、等待完成信号，并重试同一迁移。不得在此期间
即兴叙述目的地、补写线索或结算目的地后果。

一次完成等待后仍无完整 bundle，且 `steward.scene_supply` 明确存在
`fallback_available` 时，Pi 才允许最小降级：仅来源绑定的场景名、`source_refs` 与已知
线索索引。没有该来源证据时继续失败关闭，不能以“KP 常识”补全。

门控只验证素材是否可用：不允许、拒绝、重排或压制玩家行动，也不代替 KP 的因果、
节奏和叙事判断。
