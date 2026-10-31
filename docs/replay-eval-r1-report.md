# 固定存档重放评测 R1：实现与 15 回合试跑报告（2026-10-31，北京时间）

分支 `claude/replay-eval-r1`（worktree `chatrpgv4-wt-replay-r1`，基于 `claude/v4-field-defaults` 的 `68712017f`），8 个本地提交，未推送、未合并。用法与归一化口径见 `tests/replay/README.md`。

## 1. 做了什么

| 部件 | 文件 | 说明 |
| --- | --- | --- |
| C0 导出/校验 | `tests/replay/checkpoint.ts` | 历史模式：取 `turn.json` 为 `{turn:N, state:awaiting_player}` 的 sidecar 提交，裁掉之后的 git 对象，重建索引；git 外的状态（模组副本、书骨架 `source-skeletons/`、章节范围、narrate journal、记忆决策、各类呈现缓存、source-reading 库按本战役裁剪、页文转写）按写入时间 ≤ C0 收录，之后写入的列为缺口。`--live` 模式取静止工作区的现状。玩家原话放在 `input.json`，不进种子目录。manifest 记录来源、提交、等级、缺口、每个文件的摘要、RNG 和时钟口径 |
| 最终请求捕获 | `tests/replay/capture-preload.mjs` | 用 `NODE_OPTIONS --import` 挂进 run 的每个 Node 进程（主进程、内核、所有 lane 子进程），包住 Pi 后装的 fetch，记录所有 `before_provider_request` 钩子之后真正发出的请求体和回复字节；鉴权头不落盘。undici 诊断通道交叉核对漏捕获 |
| 录带重放 | 同上 | 按归一化请求体匹配录带，保留原始时延（否则后台准备和 KP 首请求的竞态会换结果）；对不上即记首次分歧并回 400，不硬塞后面的录带；被调用方取消的请求按原样等待取消；录带回复里原 run 的路径改指本 run |
| 恢复一致 | `tests/replay/restore-check.ts` | 同一 C0 恢复两份：文件摘要、内核读接口（campaign.list / table.status / table.capsule rehydrate）一致；A 份写金丝雀，B 份和检查点读不到 |
| 单臂运行 | `tests/replay/run.ts` | CoW 恢复到 `.coc/eval/runs/<run_id>/`，用本 worktree 的 driver 起真实宿主和内核，`COC_KERNEL_SEED=<检查点>/r<n>`（两臂相同）；注入前、回合后各等后台静止 8 秒；**daemon 记录的插件不是 9 个（含 Jev）就拒跑**；结束后按 pid 和工作区路径核实进程全部退出，残留的会被结束并记入结果 |
| 比对 | `tests/replay/compare.ts` | 骰果（含时间档位骰）、回执、机制投影、正文摘要、持久状态逐文件摘要；只去掉列明的挂钟字段和执行身份 |
| 选例/批跑 | `select-cases.ts`、`batch.ts`、`retape.ts` | 按书 × 动作类分层抽样（动作类只看源回合调用了哪些工具，不读文本），加盐摘要排序，可复现 |

内核改了一处（`71ff7c4be`）：位置 Mod 新建地点、特征、感知关系、情境时用随机 UUID 当实体 ID，重放无法比较实体身份。新增 `kernel-ts/ids.ts`：只有设置了 `COC_KERNEL_SEED` 才由种子、回合、调用和名称派生 ID，产品默认行为不变。`tests/extension/location-feature-recovery.test.mjs` 通过；全量测试尚未跑（见第 5 节）。

## 2. 15 个配对情境

来源：Mac 上 `v4-live / live2 / live3 / live3m / v4-old` 五个 worktree 的 1030c–l，共 1251 个已玩回合。每本书各取 5 类（检定 / 行动 / 查阅 / 对话 / 源回合未正常结束）各 1 个，取第 2 回合及以后：

dg：1030c-gkfull t8、1030k-gkminus t4、1030l-gkminus t11、1030e-gkpref t3、1030d-mmready t7  
du：1030i-mmold t7、1030j-gkold t6、1030f-gkpref t3、1030j-mmold t2、1030l-mmminus t11  
ad：1030k-mmnew t7、1030e-gkfields t10、1030e-gkfields t15、1030j-mmnew t13、1030l-mmnew t12

全部是 B 级检查点（历史重建）。

## 3. 结果

### 3.1 恢复一致：15/15

两份恢复的文件摘要和检查点一致，内核读接口回答一致，读操作不写状态，金丝雀没有串到另一份或检查点。

### 3.2 配对试跑（两臂各跑一次，代码 `5ab4df3f2`，同一 C0、同一内核种子）

| 臂 | 模型 | 交付 | 墙钟中位/均值/最大 | 超 60 秒 | 长思考步（>1k token） |
| --- | --- | --- | --- | --- | --- |
| gk | grok-build/grok-4.6 low | 15/15 settled | 59.2 / 62.0 / 97.0 秒 | 7 | 1 |
| mm | minimax-cn/MiniMax-M3.1-Flash-Preview medium | 15/15 settled | 96.2 / 108.7 / 199.1 秒 | 11 | 40 |

同一情境下 mm 比 gk 慢的有 13/15，差值中位数 43.6 秒。作者两臂都是 MiniMax（PipiCOC 设置）。源局里有 3 个回合超时或未交付，这次都正常交付了；但源局跑的是各自当时的代码，这里跑的是 `v4-field-defaults` 的 HEAD，所以这不是同代码对比。

**每臂实际加载的插件（30 次实跑加全部录带重放都一样，开跑前已校验）**：anthropic-cache、codex-relay、deepseek、grok-build-oauth、image-gen、jev（带钥匙）、minimax-enhanced、openai-fast（从 profile 加载）、rerank。全部 102 次 run 都有 Jev（api.typesafe.ai）请求，录带重放里的 Jev 回复来自录带。没有漏捕获的请求（`uncovered` 为 0），没有残留进程。

只是试跑，每臂 15 次，不下质量结论。正文质量和意图处理按项目规矩交给 Codex 盲评，我没有读正文和思考文本。

### 3.3 录带重放（Grok 臂，修复后复测，代码 `fe1d3c228` 加比对口径 `84a10637c`）

**15 个回合中 13 个，骰果、回执、正文和持久状态与实跑完全一致。** 第一轮（修复前）是 8/15。

剩下 2 个不一致，原因都已定位，都是宿主后台 lane 的并发不确定，不是评测器的问题：

- dg-1030d-mmready t7：回合内 NPC 人设 lane 并发展开，送进 lane 的 NPC 内容和原录带对不上（3 处分歧），导致正文、npc-ledger、first-sight 不同；骰果和回执一致。
- du-1030j-gkold t6：回合后记忆抽取和 NPC 日志两个后台任务的结果不同（6 处分歧，都在后台 lane），只影响 events.jsonl；骰果、回执、正文、world 一致。

### 3.4 试跑中发现并已处理的问题

1. **检查点漏了书骨架**：`<工作区根>/source-skeletons/` 不在 `.coc` 下，第一批的 3 个回合因此作废重跑。补上之后 mm 臂首个回合从 126.8 秒降到 50.6 秒，说明漏这一项会严重扭曲计时。
2. **内核实体 ID 随机**：已改成在种子下可注入（见第 1 节）。
3. **后台补跑和 KP 首请求赛跑**：B 级 C0 缺“上一回合提交后的后台写入”，开桌时宿主会补跑，和 KP 抢跑。现在注入前先等后台静止，回合后也等静止再停桌。
4. **录带隔离漏洞**：录下的模型回复带着原 run 的绝对路径，重放时 lane 的 bash 会 cd 进原 run 的工作区。已修。修之前受影响的 3 次录带重放（du-1030i t7 一次、du-1030j-gkold t6 两次），对应的实跑工作区在结果计算完之后可能被写过；这些实跑的 result.json 是在录带重放之前算的，结论不受影响。
5. **提示里的执行身份**：`prompt_cache_key`、lane 的 `<cwd>` 时间戳目录、`run-<uuid>`、`world_revision`（摘要覆盖了回执里的挂钟时间）、mkdtemp 临时目录名。这些都只在录带匹配时归一化，清单写在 `TAPE_NORMALIZATION` 里。

## 4. B 级检查点的已知缺口（manifest 里逐项记录）

- 第 N−1 回合提交后的后台写入（记忆抽取、NPC 日志和台账、first-sight）和第 N 回合一起进下一次提交，拆不开，所以 C0 里没有。
- git 外 C0 之后才写入的文件不收录。共享的 NPC lane attempts、文档呈现缓存、书骨架里后来覆盖写入的放行结果，都按条数列出。
- source-reading 库只存了版本号没存时间，取的是收局时的版本。
- 源局的内核种子没记录，所以原骰果无法复现；重放给两臂用同一个新种子。
- 不冻结挂钟时间。

## 5. 没做或者要你拍板的

- 全量 `test:ext` 和集成测试没跑：leehow-pc 一直忙，amax 不在线。内核这处改动建议交给 Codex 在盒子上跑一遍全量。
- 正文质量和意图的盲评没做（规矩是交给 Codex）。40 个 mm 长思考步也该由 Codex 打开看是在纠结什么。
- 前瞻采集（新跑的局每回合自动留 A 级 C0）还没接进 driver；现在要留 A 级只能停桌后用 `--live` 导出。
- 剩下两个后台 lane 的不确定（NPC 人设展开顺序、回合后记忆和日志），要不要在产品里改成可注入或串行，需要你决定。
- 证据目录 `.coc/eval/runs/` 名义上 12G（CoW 克隆，实际占用小得多）、`checkpoints/` 3.2G，作废的第一批放在 `*-noskeleton`，可以删。

## 6. 证据位置

- 报告行：`.coc/eval/reports/r1-batch1/rows.jsonl`（配对加第一轮录带）、`r1-determinism/`、`r1-determinism2/`
- 检查点：`.coc/eval/checkpoints/r1-batch1/<case>/`，`cases.json` 里有抽样盐和全量清单
- 每次 run：`.coc/eval/runs/<run_id>/result.json`（插件、种子、静止等待、骰果、回执摘要、捕获统计、残留进程）

## 7. 补充（北京时间 17:40）：全量测试与盲评

**全量测试**（Codex 在 Mac 上跑，日志：`.coc/eval/reports/codex-tests/`）：test:ext 6761 个用例、integration 2328 个用例，失败 76 个。
- 其中 1 个是内核改动引入的：apply 预览构造的上下文没有 kernel，`entityId` 读种子时报错（`tests/integration/enhanced-locations.test.ts:161`）。已修（`kernel-ts/ids.ts` 允许 kernel 缺失，按产品原行为随机生成），修完后该文件 29/29 通过。
- 其余失败集中在 18 个文件，原因是 Codex 沙箱禁止监听端口、禁止 mkdtemp、触发 Node 原生断言。我在沙箱外逐个重跑了这些文件，17 个全部通过。
- 剩下的 `ts-kernel-foundation` 1 项是既有失败：`kernel.hello` 比冻结预期多列出已入库的 `content/starters/npc-state-bench`，测试、处理器和预期文件和基线完全相同。

**正文盲评**（Codex 评完之后才按对照表还原两臂，报告：`.coc/eval/reports/r1-batch1/blind/codex-review.md`）：
- 总体偏好：Grok 8、MiniMax 6、持平 1。
- 四项平均分（Grok / MiniMax）：意图处理 4.47 / 4.33，具体信息 3.80 / 4.80，一致与可信 3.80 / 3.13，可读性 3.40 / 3.27。
- MiniMax 给的细节更多，但更常把局部痕迹升级成确定结论，或者替玩家多做动作。每臂只有 15 个样本，只能算描述性比较。

**MiniMax 臂 40 段长思考的成因**：
- 边界指引落不到当前这一步：11 段
- 材料或当前状态不完整、互相冲突：11 段
- 反复权衡、没有停止条件：8 段，但这一类占的 token 最多，约 27%
- 工具参数难以发现：7 段
- 被拒绝后缺少恢复信息：2 段
