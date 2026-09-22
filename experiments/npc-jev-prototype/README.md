# NPC Jev 原型诊断

这是用于回答设计问题的实验代码，不接入生产 NPC 层，不是真桌玩测，不修改正式战役。

问题：相同情境下，稳定性格或具体关系经历是否改变真实 Jev 的评分和 Choice？宿主先隔离知识后，模型能否避免编造、理解否定、允许自然结束，并在候选不足时交回 Keeper？带工具 Pi 能否把选择演成不同人物，并依据同一份已保存人格生成重逢片段？

## 运行

从仓库根使用 Node 24。Jev key 通过已有统一 Jev 扩展 resolver 读取，以 `EXT_JEV_APIKEY` 注入当前进程（源码兼容变量也只由该 resolver 处理），不要写入本目录、命令参数、HTML 或证据文件。

1. `node experiments/npc-jev-prototype/author.mjs personas .pi/prototypes/npc-jev/<fresh-author-dir>`
2. `node experiments/npc-jev-prototype/run.mjs .pi/prototypes/npc-jev/<fresh-author-dir>/personas.json .pi/prototypes/npc-jev/runs`
3. 为生成台词与重逢样例，新建独立目录，将步骤 2 的 `render-input.json` 复制为其中的 `input.json`，运行 `node experiments/npc-jev-prototype/author.mjs render <fresh-render-dir>`。
4. `node experiments/npc-jev-prototype/render.mjs <run-directory> <fresh-render-dir>/performances.json`
5. 双击运行目录里的 `prototype.html`，无需服务、联网或 key。页面只浏览实际测过的输入与输出，不为任意新输入伪造模型结果。

作者默认用隔离的 `.pi/coc-agent` 下配置的 `xai/grok-4.6`。可显式设置 `NPC_PROTOTYPE_MODEL=grok-build/grok-4.6` 使用项目已有 provider 扩展。作者运行保留工具事件和模型用量；只有真实 read/write 工具调用及有效输出才算作者任务成功。

## 固定输入与测量

- `inputs.json` 是本原型创作的诊断材料，含三种有描述的性格、一种待补全人物、六个情境及明确的知情关系。候选由实验者提供；原型不证明自动候选生成质量。
- `evaluation.json` 在调用前确定宽松预期和差分假设，不发送给模型。符合预期并非人物心理学的客观真值。
- `run.mjs` 使用现有生产 Jev adapter 和 TaskLease；每次调用保留实际 request、原始 response、规范化结果、分数、耗时与用量。没有隐式重试。
- 12 个情境变体各跑两次；第二次反转候选与调度顺序。三个性格案例另做去性格对照，两个关系案例另做去经历对照，共 34 次请求。
- 同一 NPC 视角下多个候选的三个评分维度与 Choice 合批，但 Choice 不依赖同批分数。不同视角使用不同请求。
- 不可知事实在请求形成前由宿主按显式 knowers 排除。这个结果证明本原型的输入隔离，不证明 Jev 看过秘密后也不会泄漏。
- 所有原始结果保留；不可用与不符合预期的样本不删除、不改金标准补成通过。

## 原型边界

固定微情境、两次有关联的顺序复测不能建立泛化准确率或可靠 p95。没有 Keeper-only 完整回合对照，不能宣称更快或更好玩。HTML 的状态变化演示不证明正式存档、事务、恢复或准入安全。生成片段是待评审样例，不是世界事实；没有伪造收据和期间回合。

后续只有经真实产品路径验收的结论才进入生产。当前项目要求在最新产品分支工作，本实验保留在未接线的 `experiments/`，不创建或切换另一分支，不自动提交、推送或发布。
