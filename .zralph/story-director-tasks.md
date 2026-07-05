
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
