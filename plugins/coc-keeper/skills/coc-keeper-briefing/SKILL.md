---
name: coc-keeper-briefing
description: Pi-Coc 常驻守秘人轻量索引；以 L0/L1 导航替代正文常驻。
---

# 常驻 KP 索引（Pi-Coc）

`coc-keeper-briefing` 是 Pi host 从当前战役的
`save/steward-state.json` 生成的守秘人专用上下文卡。它只包含：

- 模组一行简介、风格一行与**内容预警**；
- `init/npc/scene/clue/rule` 的就绪状态；
- 场景与 NPC 的 L1 索引（`id`、一句摘要、最多两个 `source_refs`）。

它不读取或投放 L2 正文、readaloud、keeper notes、handout body、数值、
属性、技能、武器、SAN 或其他未白名单字段。

## 注入与可见性

Pi extension 在以下时机生成并以 `pi.sendMessage({display:false})` 注入：

1. 带 `--campaign` 的会话启动；
2. 成功 `session.resume` 后；
3. 成功 `steward.domain_put` 或 `steward.scene_bundle_put` 后。

卡片 `customType` 为 `coc-keeper-briefing`，仅供 KP 模型可见；它不是玩家
transcript，也不应进入 `turn.finalize` 文案。`display:false` 是 TUI 隐藏而非
密码学 ACL；外部玩家客户端仍必须只转发 finalize 文案。

## KP 用法

1. 把预警保留在上下文中，按安全边界处理内容。
2. 先看场景/NPC 索引确定实体和引用位置。
3. 需要因果、扮演、正文或数值时，再通过 `steward.deliveries`、
   `steward.notebook` 或 SceneBundle 按需取回。
4. 不把索引当作全文、数值或已向玩家揭示的事实；玩家猜测仍只是猜测。

## 刷新语义

采用**整张替换式刷新**，不是追加增量：每次成功域写入后，从当前
steward-state 重新生成一张有上限的完整轻量卡。这样状态能回退/失败，索引
能去重，且不会随长期会话累积增量上下文污染。旧卡是会话历史；新卡是当前
导航快照，KP 以最新卡为准。

地图/图像不在本 skill 范围内；可由后续地图供给在 L1 索引中增加引用 seam，
但不得把图像或 OCR 正文塞入常驻卡。
