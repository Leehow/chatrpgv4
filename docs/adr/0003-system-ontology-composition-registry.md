# 0003. 用 composition registry 连接分立图谱的权威面

- Status: Accepted（2026-08-31），v2 沿用并第一次被运行时读取（2026-09-06，契约 §13.4）
- Track: pi-coc v2

## Context

ModuleGraph、RuleGraph、战役状态、执行器、Director、文本层各有局部合同，能各自证明节点、规则、状态或输出的形状，却没有一个机器可检查的系统层说明：模组的机制声明采用哪条规则语义；一个规则决策读哪些事实、声明哪个能力、可能产生哪些效果；Director 与文本层能读什么、永远拿不到什么权威。把一切复制进一张大图会制造新的真相源；只写文档又拦不住错误的图种类、悬空引用与权威越级。

## Decision

一个版本化、closed-schema 的 system ontology contract 与一个生产 registry（v2：`content/ontology/system-ontology.json`）：

1. Contract 只登记图种类、权威面、有类型的关系约束；各图的节点本体仍由各自合同定义，system contract 只引用其 id。
2. Registry 只保存语义引用、产物定位与有类型的关系；节点从原图解析，live-state 事实只能用 RuleGraph 已登记的条件路径，能力必须同时命中 RuleGraph 声明与执行器的公开索引。
3. 确定性校验：图种类、语义 id 语法、产物存在、关系两端种类、权威越级、精确引用环。
4. Director 只能经 `grounded-by` 读 scene/rule/effect/fact，且始终 advisory；文本层只能经 `renders-settled-output` 展示已结算的效果与事实。

## v2 的运行时用法

- `table.open` 加载并校验注册表（141 引用、156 关系全部解析到规则图、Director 图、文本图、事实路径与执行器能力），对不上报 `campaign_not_ready`。
- `grounded-by` 供胶囊 `director.grounded_by` 的依据链，以及 `resolve` 在 `needs_choice` 时按 Director 节拍收窄候选（交集恰一个直接结算，`decision_source: "director"`）；显式 `decision` 永远不被推翻。
- `may-emit-effect` 以 `Ontology.effect_ids()` 暴露，留给「每个状态效果恰交代一次」的确定性检查。
- Director 没有写侧：采纳与否由回合收据推断（§13.7），不设登记工具。

## Consequences

- DirectorGraph 与 TextGraph 从旧树逐字节带入（`content/director/`、`content/craft/`），摘要复核；打分的每个数都来自图，代码里没有字面量。
- 权威面划分是运行时事实，不只是文档：Director 建议进胶囊，规则决策由 RuleGraph 运行时判，状态由内核事务写。
