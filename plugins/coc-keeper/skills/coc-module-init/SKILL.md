---
name: coc-module-init
description: 为 Pi-Coc 的 raw PDF 模组形成阻塞建卡最小包 L0；L0 就绪前不得请求调查员构建契约或编造模组建卡信息。
---

# 模组初始化（L0 建卡最小包）

适用：Pi-Coc 的 PDF 绑定模组。该技能由私有 opening-review 文档生产者执行；主 KP 不自行翻找 PDF、页码或缓存。

## 何时可以建卡

只有 `setup.adopt_source_facts` 的回执同时满足：

- `character_creation_unblocked: true`
- `module_init_ready: true`（当该字段存在）

才可调用 `setup.investigator_contract`。该契约成功即表示当前
`keeper_only` L0 已通过 source-bound 门控；Pi 随后私下投递完整 L0 给 KP。
可用它向玩家说明合适的时代、地点、调性、预设调查员和建卡修正，但不得直接
泄露守秘人信息。

若门控未通过，不要猜测预设卡、年代修正、开场钩子或 handout；遵循回执/门控的明确指引。

## 软定位原则

建卡信息的位置不固定。生产者应先用 grep/find 在当前页面缓存中以“预设、建卡、角色、年代、人数、难度、适合、职业、技能、警告”等锚点定位候选处，再阅读上下文并进行语义判断。

- 锚点仅用于定位，不能作为关键词硬判据。
- 不假设“前 N 页”或固定附录页；封面、目录和空白页可能占位。
- 锚点不足时，可小范围核对开篇与文末上下文；缺失内容写 `null` 或 `[]`，不得补写。
- 不在此阶段解析 NPC 数值、线索网、场景供给或地图；那些属于后续 Skill。

## L0 结构

`save/module-init.json` 是 source-review 绑定的 `keeper_only` 状态，核心为：

```json
{
  "schema_version": 1,
  "secrecy": "keeper_only",
  "module_meta": {
    "title_zh": null,
    "title_en": null,
    "authors": [],
    "translator": [],
    "era": null,
    "locale": null,
    "party_size": null,
    "duration_hint": null,
    "tone_tags": [],
    "mythos_entities": [],
    "campaign_hooks": [],
    "warnings": [],
    "safety_notes": null,
    "structure_type": null
  },
  "pregens": [],
  "opening_hooks": [],
  "chargen_deltas": [],
  "opening_handouts": []
}
```

这是薄 schema：上述字段必须存在，但 `module_meta` 和实体记录允许模组特有扩展字段。该状态还绑定当前 scenario、PDF 身份、bundle hash、opening-review generation 与 receipt digest；来源重绑后旧 L0 不得放行建卡。
