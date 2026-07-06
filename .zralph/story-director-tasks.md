
### V2/V3/V4/V5 结果
- V2 人煎百味编译完成（hub_sandbox，2 critical 结论各 6 routes，0 errors）
- V3 血色公路前2幕 probe 编译完成（hybrid_mega，用 scene_layer 建模沙盒+时间线，2 critical 结论各 5 routes，0 errors）
- V4 harness profiles（10个：haunting 5 + renjian 3 + xuese 2）+ save fixtures + character 全部就位
- V5 smoke 跑通：**10/10 profiles passed**
  - director override 正确触发（stuck→RECOVER, fumble→PRESSURE）
  - keeper secret 隔离 100%
  - structure_weight 差异可见（branching REVEAL=1.08 vs sandbox/mega=0.9）
  - 修复 1 个健壮性 bug（threat-fronts current_segments:null → director 崩溃，commit 6f8c9df）

### 阶段 2 结论
director 在 3 种结构原型的真实模组上产出合理 DirectorPlan，deterministic planner 的"灵魂"可被机读验证。

---

## 阶段 3：端到端叙事 handoff 验证

### 已完成
- coc_narration_contract.py（8 项 narration-readiness 检查 + CLI），10/10 smoke artifacts 全通过
- 手动跑 The Haunting 开场第 1 轮（01-archive-first），narrator 按 DirectorPlan 写出合规中文叙事
- narration contract 8/8 PASS

### 发现的 3 个真实 handoff 缺口（v1.1 候选，非阻塞）
1. **clue_type 推断不准**：director 把 delivery="Handout 1 直接给"的 clue 标为 obscured，触发不必要的 Spot Hidden。根因：generate_director_plan 的 _select_clue_policy 硬编码 clue_type="obscured"，不读 clue-graph 的 delivery 字段。
2. **must_include 始终为空**：narrator 在复杂线索回收时缺锚点。根因：generate_director_plan 没填 must_include。
3. **无 events/memory 写回指令**：spec Section 6 第7步要求写 events/director-notes/memory，但 plan 不指导写什么。

### v1.1 修复优先级
- 高：#1（clue_type 精确化）— 影响每轮检定准确性
- 中：#2（must_include）— 影响复杂场景叙事质量
- 低：#3（events 写回）— 可由 keeper-play SKILL.md 自行处理，不必进 plan
