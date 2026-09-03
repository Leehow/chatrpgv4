---
name: coc-steward-parse
description: 在 Pi-Coc 建卡期间异步派发模组解析管家群；管家自读页面缓存并只写 keeper-only steward-state 分域快照。
---

# 后台并行解析（管家群）

仅适用于 **Pi-Coc**。`steward-init` 的 L0 仍由 `coc-module-init` / source-bound
producer 负责；本技能在建卡期间启动非阻塞的其余解析。

## 管家与域

初始波次保持四个 agent：

| agent | 分域 | 本期职责 |
| --- | --- | --- |
| `steward-init` | `init` | L0 的受控镜像/补充；不能替代 Skill 1 门控 |
| `steward-npc` | `npc` | NPC 扮演简介、动机/秘密、数值 |
| `steward-scene` | `scene` | 地点/场景、SceneEdge、地图引用；不做 Skill 3 预取 |
| `steward-rule` | `rule` + `clue` | 附加规则/预警/风格，以及线索、handout、小卡片 |

定义源随仓库发布于 `plugins/coc-keeper/pi/agents/`。`pi-coc` 启动时把受管
`steward-*.md` 同步到仓库根 `.pi/agents/`，这是 pi-subagents 的 project-scope
发现面；不要在用户全局 agent 目录维护另一份。

## KP 派发

L0 已由私有流程投递、但调查员尚在创建时，用 `subagent` **异步**启动
`steward-npc`、`steward-scene`、`steward-rule`。任务必须短，只给 campaign、缓存
目录、必要范围和意图；管家自己读缓存，KP 不复制正文。

调用使用 pi-subagents 的 `workflowScript`，例如一个单域波次：

```js
return runs.run("npc", {
  agent: "steward-npc",
  task: "campaign=<id>; pages_dir=<absolute-pages-dir>; parse the NPC domain and persist its final domain snapshot.",
});
```

把外层 `subagent` 调用设为 `async: true`。同一次建卡的多域波次用
`runs.all([...])` 并行；初始最多三个后台管家。后续同一域请求使用 retained child
的 `resume: "<run-id>"`，不另建无上下文的 agent。

短命令约定：**“派 steward-npc 解析 NPC（缓存：…）”**、**“续派
steward-scene 处理场景 X（缓存：…）”**。命令只表达域、路径和意图，不能携带整页
素材或要求生成玩家文本。

## 写入与消费

管家只可经 canonical CLI 调 `steward.domain_put`：

```bash
uv run --frozen python plugins/coc-keeper/scripts/coc_toolbox.py \
  steward.domain_put --root . --campaign <id> --json '<args>'
```

它原子替换一个域快照，并可附加 `failed_chunks`。`save/steward-state.json` 是
schema v2：保留既有 deliveries/notebook，同时增加 `updated_at`、五个
`domains`（`init/npc/scene/clue/rule`）和 append-only `failed_chunks`。域内容为薄
schema；实体应带 `source_refs`，默认 `secrecy: keeper_only`。

解析结果不是玩家通道。KP 必须通过 `steward.deliveries` / `steward.notebook` 消化
可用的模组文本；`turn.finalize.rendered_text` 仍是唯一玩家出口。

## 等待与完成

`pi-subagents` 的成功后台完成通知是 hidden `subagent-notify`
（`display:false`，`triggerTurn:true`）。它只唤醒 KP 并带紧凑结果摘要；不会把模组
全文注入主会话。若本回合必须收结果，再使用 `await_subagent({ id })`；普通建卡/游玩
不得轮询或无故等待。

本技能不会让玩家等待 NPC、rule 或 clue 解析。`scene` 仅落结构；新场景就绪等待、
当前+邻近预取属于 Skill 3，尚未实现。

## 嵌套协议

页面/章节过大时，管家可为明确的分块启动 2–4 个 sub-subagents。上限固定为两层：
KP → 管家 → chunk。chunk 只写
`<pages_dir>/../steward-work/<domain>/<chunk>.json`，绝不写 steward-state；父管家
等待、读取、去重、聚合后才调用 `steward.domain_put`。chunk 失败重试一次，仍失败则
记录 `failed_chunks` 并以 `partial` 返回已有内容。

若 `subagent` 或 `await_subagent` 在该管家子进程不可用，管家不得伪造并行：串行读缓存
并聚合，或返回明确的 `partial`/失败 chunk 给 KP。
