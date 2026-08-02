# 0.5.1a Steward（管家）重构设计

> 状态：已拍板（用户 2026-08-02）。这是 0.5.1a 分支的 canonical 设计，实现以此为准。

## 拍板决策

1. **管家 = 独立 pi RPC 会话**，持续关注 KP↔玩家互动；模型默认同 KP，可配。
2. **不设机械闸**。允许 KP 即兴（跑团特色）；要解决的问题是"KP 完全不看模组"，不是约束即兴。
3. **老管道直接拆除**（locator 自动派发链），不留双跑，避免"没实现的说实现了"。
4. **管家 = host 无关角色**（coc-steward skill + 会话模式约定），Codex/pi 共用语义。
5. 成本不敏感（独立 agent 进程可常驻）。

## 保留（不动）

- 首包自动产 bundle（raw PDF → 1-3 页 + 六问 → bind）
- 快速解析 adopt + 闸门 A（era/place 未落地禁建卡）
- era 降级路建卡（kp_guided_era_adaptive）
- 开场投影 + 放行后 receipt 钉死
- 四硬边界：rules 算术、state 事务、模块只读、finalize 完整性

## 新增

### S1 全量解析（bind 成功后后台执行）

- bind 成功后自动生成一个 `full_parse` job：把整本 PDF 全部页渲染成 markdown 入 module-assets（复用 progressive 车道的 coordinator/queue 机制，单 job，不做逐实体 deepen）。
- 开场**不等**全量（首包+开场页即可开场）。
- 全量完成前，管家只能读已解析页，其余标记"未解析"。
- 完成后，任何后续消费**只读 markdown，永不回 PDF**。

### S2 管家（coc-steward 角色）

- 角色：`plugins/coc-keeper/skills/coc-steward/`（SKILL.md），ruleset 无关、host 无关。
- 会话：独立 RPC 会话（各 host 自行拉起），与 KP 会话分离。
- 输入（不经 KP）：campaign 的 turn 事件、玩家可见叙事、工具流水的**只读投影**。
- 职责：
  1. 持续判断 KP 现在/即将需要哪些模组文本；
  2. 从 markdown 库选段，写**管家交付**记录：段落、页码、why-now、keeper-only/player-safe 标注、预计场景标注；
  3. 维护**小本本**（notebook）：预计场景 → 预剪段落列表，场景真到时即付。
- 输出消费：KP 经工具读取"管家交付"（新读 op / 会话上下文注入）。
- 绝不：改 rules/state 权威值、改模组文本、替 KP 写叙事。

### S3 退役（直接拆）

- `autoDispatchPiSourceScopeLocator` 及其触发/选择/冷却（index.ts）；
- `resolve_source_scope` 的 locator 路径与 `cache_referenced_pdf_indices` 契约（adapter `--run` 仅保留首包 bootstrap 用途）；
- `request_deepen` / deepen host-work 状态机（deepen job 类型；由 S1 full_parse 单 job 替代）；
- `fate_closure_gate`（用户明确不要机械闸；`evidence_gap` 保留为纯信息标记）；
- wire 的 takeover 专有保留逻辑（保留通用投影框架）；
- `references/mcp-operation-contracts.json` 同步重建；
- 退役路径测试删除/改写；保留的通用机制测试不动。

## 语义纪律（代替机械闸）

- KP skill 约定：模组事实以管家交付为准；即兴自由，但即兴不得覆盖管家交付（冲突时管家交付为 canon 候选；controlled improvisation 宪法继续有效）。
- 管家没给的书 = KP 不知道的内容；KP 可问管家，管家可答"未解析/没有"。

## 验证

- **play07（0.5.1a）**：首包→建卡→开场→管家喂书→西尔真面目登场（纯自动、零机械闸、零人工绕过）。
- 全量 pytest + pi smokes 绿。

## 切片

1. S1 全量解析（scripts 为主 + progressive 车道复用）
2. S2 管家角色 + 会话 + 交付/小本本状态 + KP 读取面
3. S3 退役老管道（index.ts/toolbox/契约/测试）
4. S4 play07 真实游玩验证
