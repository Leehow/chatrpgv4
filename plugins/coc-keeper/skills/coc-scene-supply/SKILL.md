---
name: coc-scene-supply
description: Pi-Coc 当前场景与周边预取、source-bound SceneBundle 缓存及素材就绪门控。
---

# 场景供给（Pi-Coc）

适用轨道：`ACTIVE_IMPLEMENTATION_TRACK=pi-coc`。本 skill 只准备 Keeper 的来源素材；它不判断行动、剧情、线索取得、场景顺序或叙事质量。

## 数据面

Pi host 的私有 source coordinator 与 steward preparation 负责把 keeper-only、
source-bound `SceneBundle` 写入 `save/steward-state.json` 的
`domains.scene.bundles`。KP 只消费门控返回的 `data.scene_supply`；本门控不要求
KP 派发、恢复或轮询任务，也不要求 KP 写 bundle。

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
2. `ready`：迁移成功；返回的 `data.scene_supply` 仅 KP 可用，KP 直接据此继续正常游戏。
3. 相邻场景预取完全由 Pi host 私下持有；它不需要 KP 操作，也不改变 KP 对场景、
   行动、线索或叙事的判断。
4. host/steward 将每个可进入的预取结果写成独立 bundle，并以
   `prefetched_from` 标记来源；以后进入该目标时，`cache_hit=true` 表示命中。

## 就绪门控与降级

门控状态只有三种：

- `ready`：使用返回的 keeper-only bundle 继续游戏；相邻预取仍由 host 私下处理。
- `pending_with_live_dispatch`：Pi host 已确认一个真实、受限的私有 dispatch 正在运行。
  KP 不执行额外操作，也不承诺稍后一定可用；目的地保持未建立，只结算与其无关的
  部分，并以纯虚构方式回应玩家。
- `blocked`：不存在可派发的精确任务/能力，或真实 dispatch 已终止但仍没有可用结果。
  立即停止等待；全程留在虚构内，让目的地保持未建立，并提供已经建立且开放的线索。

Pi host 独占本门控的任务与写入生命周期。KP 不派发或恢复 `steward-scene`，不调用或
构造 `coc_dispatch_source_work`，也不调用 `steward.scene_bundle_put`。

只有真实 host dispatch 到达终态后，且 canonical gate 返回来源绑定的 minimal fallback
为 `ready`，Pi 才允许最小降级；KP 只使用返回的场景名、`source_refs` 与已知线索索引。
没有该来源证据时保持 `blocked`，不能以“KP 常识”补全。

门控只验证素材是否可用：不允许、拒绝、重排或压制玩家行动，也不代替 KP 的因果、
节奏和叙事判断。
