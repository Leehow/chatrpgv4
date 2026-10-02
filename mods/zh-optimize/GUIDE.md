# 中文 NPC 表达包维护指南

## 当前定位

当前维护对象是 **mod 1.3.6 / family 7**：full 2122 UTF-8 bytes、brief 1090 bytes，cap 1200；包为 6 habits + 13 interactions，共 19 cards。实现与测试已获授权，使用 Flapcode GPT Luna；已批准的首个合资格精确写作快照请求最多从该次尝试开始等待 800ms。既有同快照必需准备会消耗窗口，过时临时快照不会；窗口由首个合资格请求消耗后不续期。每个输入最多两次尝试，工作上限 1200ms；stale/cancel/缺失 advice 回退，不增加 prose model、judge 或 rewrite。

这是写作前的 advisory selection，不是成文评审或改写。producer 锁定 voice/personality、情绪、关系、玩家行为、listener、risk、有限近期对话、source/current facts、语言、revision 和启用包；selector v7 对当前批次逐人、逐卡作语义判断，并单独处理 register-conflict。Host 最多接受每人一张 habit 与一张 interaction，负责去重、冲突、过期、事实安全、版本绑定和回退；只把实际选中的卡片材料精确物化进既有单一 Keeper/provider 请求，Keeper 起草一次。现有 voice ownership、NPC state、cards 不变。

卡片是有条件的 advisory pattern；pattern 与 grounded examples 不是引文、设定、事实、人物状态、职业或阶级模板。Keeper 仍依据听众、共享知识、当前动作、目的、风险、关系、情绪、面具和原始事实自然作答，也可忽略不合时宜的卡。维护判断必须直接依据来源与当前语境；不得用关键词、姓名、默认值或可执行语义规则替代语义判断。

## 表达边界与限制

指导应明确 NPC 的**即时目的**、与听众的**共享知识**、保持其**立场**，并用**可观察的叙述**承载动作、反应和语气；不要把人物设定、状态、事实、情绪拼成清单。允许自然的正式语体、回应性情绪和较长 speech length；不强制统一短句、拒绝、颗粒词、提问或固定口头禅。来源事实、知识边界和玩家选择权优先；不得补造 lore、身份、承诺或事实，也不得把示例带入场景。

保持 immutable active-world/version locks；缓存键变化使旧结果失效。失败、timeout、cancel、stale、缺 consumer request 或未实际序列化 inclusion 时回退 source/current facts，不持久化为 delivered。维护检查可核对 schema、19-card 包、预算、nullable 选择、版本/过期回退、实际 provider inclusion、voice ownership 和 single-pass wiring；这些不能替代文学或 live 证据。不得添加 state/planner/voice migration、novelquotes/lore、第二 prose judge/rewrite 或自动 rollout。

## 当前证据

权威结果见 [`Chinese NPC Expression Selection — Evidence Report`](../../docs/specs/chinese-npc-expression-selection-evidence.md)；阅读其中的最终结果行，不在此重复运行状态或把有限证据扩大为发布、部署、App acceptance、质量改善或 perfection 证明。报告记录了当前包、800ms policy、limits、19 cards、focused checks、历史测试边界及文学限制。

## 历史记录（HISTORICAL；不是当前义务）

旧 candidate/status 记录包括 mod 1.3.3、零额外等待、待用户批准的 800ms、旧 family6/mod1.3.2 live、812-byte candidate、pending commit、4,334/4,338 red suite 及旧 static screen。它们只作为 previous-candidate evidence 保存；不得当作当前版本、当前政策或当前待办。原提案的质量、held-out、owner、genuine-play、old-world 与 release gates 仍须在原规格中保留并按其历史语境理解，不能因为当前实现已获授权就声称全部 fulfilled。

## 维护原则

保留原始 card name、kind、applies、pattern、grounded examples；示例不是强制台词。中文表达只在确有先后、条件、共享语境或场合差异时调整连接、省略和书面度。不要把每个 NPC 变得简短、友好或顺从；正式、重复或较长回答可能符合来源与立场。任何修订都应只触及本包表达选择边界，并以证据报告和原规格为准。
