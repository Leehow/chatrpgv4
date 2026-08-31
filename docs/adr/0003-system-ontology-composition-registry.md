# 0003. 用 composition registry 连接分立图谱权威面

- Status: Accepted
- Date: 2026-08-31
- Track: `ACTIVE_IMPLEMENTATION_TRACK=pi-coc`

## Context

生产代码已经拥有互相独立的 ModuleGraph、RuleGraph、campaign state、resolver /
subsystem、Director advisory 和 finalization/output-context 机制。它们的局部合同能够
分别证明节点、规则、状态或输出的正确形状，却没有一个机器可检查的系统层说明：

- 一个模组来源中的 mechanics declaration 具体采用哪个规则语义；
- RuleDecision 读取哪些来源事实或 live-state fact；
- RuleDecision 声明哪个 Capability，由哪个执行 registry 兑现，并可能产生哪些
  RuleGraph Effect；
- Director/Text 可以读取什么，以及它们永远不能获得什么权威；
- 某类生产图谱根本不存在时，系统应如何诚实表达缺口。

直接把所有实体复制进一个 mega-graph 会制造新的真相源，并诱导一个 universal
graph interpreter 越过现有 resolver、subsystem、state、Keeper 与 finalization
边界。只写文档又不能阻止错误 graph kind、悬空引用、authority escalation 或循环
依赖进入生产。

## Decision

增加一个版本化、closed-schema 的 system ontology contract 与一个生产 registry：

1. Contract 只登记 graph kind、authority plane、typed relation 约束与 registry
   JSON Schema。ModuleGraph/RuleGraph 的 node ontology 继续只由各自原合同定义；
   system contract 通过 contract id 引用它们，不复制枚举或节点体。
2. Registry 只保存 semantic reference、production artifact/runtime registry locator
   与 typed relation。artifact node 仍从原图解析；live-state fact 只允许使用
   RuleGraph 已登记 condition path；Capability 必须同时命中 RuleGraph declaration
   和 ruleset resolver 的 `public_api_index()`。
3. Deterministic validator 先做 Draft 2020-12 closed-schema validation，再检查 graph
   kind、semantic-id grammar、artifact/registry existence、relation source/target kind、
   RuleGraph 原生 `invokes` / `emits` 证据、condition-path 使用、authority violation
   与 exact-reference cycle。
4. ModuleGraph 的 authored declaration 只能在其 `module_rule_ref` 与目标
   RuleGraph Rule/Decision semantic id 精确一致时声明 `uses-rule`；仅因某规则可能在
   后续条件中触发，不构成直接采用关系。ModuleGraph 不能直接调用执行器或写 state。
   RuleGraph 只声明 decision、requirement、capability 与 effect；实际执行仍由
   resolver/subsystem，实际变更仍由 state transaction 完成。
5. Director 只可通过 `grounded-by` 读取 scene/rule/effect/fact，且始终 advisory。
   Text/finalization 只可通过 `renders-settled-output` 展示已 settled 的 effect/fact，
   没有 rules、execution 或 state authority。
6. 目前没有 source-controlled production DirectorGraph 或 TextGraph artifact。
   Coverage ledger 将两者明确记为 `absent-production-artifact`；不以代码文件、收据
   或测试 fixture 冒充一张已存在的图。
7. 当前 production The Haunting ModuleGraph 使用 `module.haunting.*` 模组专属规则
   identity，而 production RuleGraph 目前只有 healing family，没有匹配的
   Rule/Decision identity。因此 Module→Rule coverage 明确记录
   `no-proven-instance`，不以弱地板伤害“可能导致 0 HP”为由伪造 `uses-rule`。

本 slice 给 production CoC7 healing RuleGraph 增补其合同本来支持、但 production
artifact 缺失的 Effect nodes 与 `emits` relations。它们引用已有 source evidence，
不复制 resolver 实现，也不改变 healing settlement 行为。

## Why a registry, not a universal interpreter

Registry 回答“这个语义引用由谁拥有、能否解析、允许怎样连接”；它不回答“如何运行
这张图”。执行算法留在拥有确定性语义和事务边界的现有模块中：

- ModuleGraph：authored truth；
- RuleGraph：rules ontology；
- resolver/subsystem：deterministic execution；
- state：canonical mutation；
- Keeper：semantic judgment and fiction；
- Director：advice；
- Text/finalization：presentation completeness。

这与 SHACL 将 validation shapes 和被验证 data graph 分离、且要求 validation 不修改
输入图的做法一致；我们采用相同的“约束层不夺取数据/执行权威”原则，但保持项目现有
JSON artifacts，不引入 RDF backend。JSON Schema Draft 2020-12 提供 closed structural
validation；跨 artifact existence、authority 与 cycle 则由小型 deterministic
validator 完成。

参考：

- [JSON Schema Draft 2020-12](https://json-schema.org/draft/2020-12)
- [W3C SHACL](https://www.w3.org/TR/shacl/)

## Consequences

- 生产 composition 可以在 CI 中 fail closed，而不产生新的模型可编辑真相源。
- 新图谱类型必须先声明 authority plane、availability 和 allowed relations；缺失图谱
  作为可验证事实存在，不再靠猜测。
- 增加 relation 时必须提供真实 semantic endpoint；production artifact/registry
  存在时悬空引用会失败；Module→Rule 还必须验证 authored `module_rule_ref` 与目标
  RuleGraph semantic id 相等。
- system registry 不提供 traversal-to-action、自动裁决、自动 state mutation 或固定
  KP pipeline。需要执行新规则时，仍应扩展其 owning RuleGraph/resolver/subsystem
  垂直切片，而不是给本 registry 加解释器。

## Rejected alternatives

- **一个 mega-graph**：复制多个 ontology 和 authority，形成第二 KP/规则运行时。
- **只靠自由文本约定**：不能检测错误 target、悬空引用、authority escalation 或环。
- **把 Director/Text 代码文件当成图**：代码或 receipt 的存在不等于 production
  machine graph artifact，会伪造当前完成度。
- **在 registry 内复制 node bodies**：会与 ModuleGraph/RuleGraph 漂移，并违反它们
  各自的 single-authority contract。
