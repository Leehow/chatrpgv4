# Domain Docs

工程技能在探索代码库前先读这些；本仓库是单上下文（single-context）布局。

## 先读

- `Agents.md`：项目唯一完整规则源（重构边界、玩测禁令、语义问题不许硬编码、打包落点）。
- `CONTEXT.md`：项目术语表。输出里出现领域概念时用它定义的词。
- `docs/adr/`：触及某区域前读该区域的 ADR；与 ADR 冲突要明说，不许默默覆盖。
- `docs/kernel-rpc.md`：内核 RPC 契约。§编号是稳定标识符，改语义写新节并标注「amends §N」，不重排。
- `docs/specs/`：特性 spec 与工单。

这些文件缺失时静默继续，不要建议先建。

## 术语

用 `CONTEXT.md` 里的词。需要的概念不在表里，要么是在发明项目不用的语言（重想），要么是真空缺
（记给 `/domain-modeling`）。
