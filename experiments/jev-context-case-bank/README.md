# Jev 八类难点：来源绑定的对照题库

这是对此前 PDF 设计库的补齐，不是又一批任意剧情问答。内置模组、真实记录、合成契约测试与 PDF 各自按能证明的事情使用。题库构建阶段没有调用 Jev；后续已执行的真实 API 实验见文末，仍未启动战役或修改生产代码。

完整覆盖矩阵与玩家问法见 `COVERAGE.md`。`builtin.json` 和 `pdf.json` 已保存实际输入臂、Choice 问题、评估侧预期及来源，不再只有“以后可以做 partial/full”的文字建议。一次重复、一次换材料是一个输入臂，不是一道新的独立题。

## 文件

- `builtin.json`：科比特宅的授权／观察／证据方向题，以及明确标注为契约来源的记忆与物品用法题。
- `pdf.json`：同对象用途、跨段合取、上下文保真度、联合去冗余、冲突范围与未知事实题。
- `bank.mjs`：离线数据校验、来源绑定、输入物化、覆盖索引。无模型或内核调用。
- `bank.test.mjs`：来源与结构守卫、成对变量控制、AND／OR 组合检查、评估标签隔离及错误输入负例。
- `live-core.mjs` / `live-run.mjs`：真实 API 实验的策略、评分、配对汇总与证据保存；`live-core.test.mjs` 是无网络机械测试。
- `LIVE-RESULTS-20260921.md` / `.json`：真实结果、负例归因及机器摘要。

原有 `../jev-pdf-player-bank/` 的 30 道问题保留为较广的设计题库。不是把其中每一题都冒充成了本轮已冻结的对照；本轮选取能明确绑定来源和输入变量的切片，加上缺失的内置／历史机制。

## “不能乱设题”如何落实

每条 `source` 都有文件 SHA256、精确定位器和短引文。定位器可以是 JSON Pointer、文本中的唯一引用，或既有 PDF native corpus 的物理页。PDF 还绑定原文档指纹。

- `builtin-module` 是当前模组图的作者内容。
- `live-record` 是实际保存的回合记录；只证明该记录里的话与行为，不自动证明叙事中的所有推断。
- `contract-fixture` 是现存合成测试，不能冒称真实玩家经历或模型成绩。
- `research-report` 是历史报告；缺原始 turn 时不升级成逐字回放。
- `pdf-native` 是原 PDF 的本地逐页抽取，不是重新创作的模组内容。

对照问法和错误刺激可以为实验而编写，但必须标明其性质，且不冒充源文：`verbatim` 保持原字；`faithful-paraphrase`、`lossy-summary` 和 `test-claim` 分别是保真改写、丢信息摘要和有意的测试主张。`source-combination` 只拼接实际引用，不能伪称原书连续段落。

题目不追加一个没有来源的 NPC、秘密、规则数值或战役结算结果。内置内容说什么、历史测试曾断言什么、这次改了哪个输入变量，三者分开。

## 几个刻意保留的区别

1. **事实说全与原文核验是两轴。** 忠实报告可以把所问条件说全，但不因此成为原文；丢条件摘要则连内容都不全。不能把“不是原文”机械等同于“缺事实”。
2. **缓存不是过期。** `cache_only` 中仍是同版本原文，只是没有进入当前角色上下文；物化时不传正文。这是可见性对照，不是声称 Jev 学会了宿主 revision 检查。
3. **同对象不同用途需要真正成对。** 金属甲虫两臂保留相同情境与候选池，只改玩家问地点／触发还是问火焰效果，预期需要的材料随之改变。
4. **联合选择不等于每份都 useful。** 同一池同时放 A、A 的原文重复、A 的忠实改写、B、A+B 组合包及另一种生物的相关背景。充分组合可有多个；A+A 不能代替 A+B。已经有 A 后，整包 A+B 就不是最小补充。
5. **冲突不等于无依据。** “同伴也同时被保护，并非只保护持有人”与原文互斥；凭空加两点护甲则缺乏支持，但不与原有保护条件逻辑互斥。未知只针对已供证据，不推导全书或世界中绝不可能。
6. **源内矛盾也有范围。** 同样的八十／五十英尺牵引绳原文，在问追兵人数时不该挡住答案，在问牵引绳长度时则不能静默择一。比较的是两处绳长，不拿绳长与武器射程硬造矛盾。
7. **状态、授权与检索分开评分。** 记忆撤回、观点归属和门外／室内边界不是静态 PDF 找页题，不合并成一个“检索正确率”。

## 输入与评估隔离

`buildInput(dataset, caseId, armId)` 只返回 `state` 与 `questions`：

- 现有材料和候选材料有不同字段；候选不是已经供给角色的材料。
- 材料 ID 被换成中性别名，`faithful`／`lossy` 等作者标签不暴露。
- `expected`、来源绑定、题型维度、干预说明与正确选料组合不发送。
- 保留实际说话者、回合等必要上下文。来源中的一条说法不自动等于当前世界事实。

`acceptable_additions` 内层数组是 AND，外层是 OR；`[[]]` 表示不需要追加。它只约束本题固定候选池里的允许组合，不宣称穷举所有可能来源。预期标签是据源审定的设计，不是模型已经给出的结果。

有候选选择要求的题会实际发出 `questions.selection`：从固定的组合菜单中选一个。菜单跨臂不变、不是按当前正确答案临时拼出来；材料在选项里改用本请求的中性别名。多种充分组合可对应多个合格 choice id，因此 `expected.answers.selection` 可以是数组，**模型仍只需返回一个 choice id**。

`evaluateAnswers` 接收标准化的 choice-id 字典，对照评估预期，并可从选项还原被选材料。它不解析提供商原始响应，也不执行模型。只答对“材料不足”但选错补料组合会判错，不再用手工塞入一组正确材料冒充选择任务已经可答。

离线物化示例（不发送网络请求）：

```bash
node --input-type=module -e '
import fs from "node:fs";
import {buildInput} from "./experiments/jev-context-case-bank/bank.mjs";
const data = JSON.parse(fs.readFileSync("experiments/jev-context-case-bank/pdf.json"));
console.log(JSON.stringify(buildInput(data, "idol-context-fidelity", "faithful"), null, 2));
'
```

## 校验

```bash
node --test experiments/jev-context-case-bank/bank.test.mjs
```

绑定检查需要本机保留的 `.coc/playtests/` 记录和 `.pi/prototypes/jev-pdf-routing-20260919/corpus.json`。缺失时绑定测试明确显示 skipped，不能说来源验证通过；结构与投影检查仍可单独证明自己的部分。不要为了跑绿生成替代来源或修改旧证据。

这些测试能证明字面来源、数据引用和输入隔离，不能机械证明语义解释正确，也不构成 Jev 准确率、提速、降费或真桌验收。整份 PDF、native corpus 和完整回合日志不复制入题库。

## 本轮复核

冷审确认八类都有实质对照，同时指出两项缺口，现已修正：候选组合预期原先没有对应请求输出，现补入可回答的 selection Choice 与多正确选项评分；火免疫段落原先只有“它们”，现补入绑定真实原文的“金属甲虫群”标题。作者实验说明也已移出模型可见的 situation。

题库落成时针对本库及未修改的旧增量用例执行 35 项检查，35 passed、0 failed、0 skipped；其中题库本身17项。内置／历史24个来源锚点、PDF9个锚点均在本地真实文件完成绑定检查。检查与冷审不等于模型成绩。

## 后续真实 API 实验

已执行的结果见 [LIVE-RESULTS-20260921.md](LIVE-RESULTS-20260921.md)：78次正式请求加11次探针／诊断。联合菜单按全部候选子集机械生成，不使用gold缩小菜单。联合全部题与独立选择题的分母不同，比较请只用同集合 `paired-summary.json`。

```bash
# No API call; checks bindings and prints the frozen request inventory.
node experiments/jev-context-case-bank/live-run.mjs --describe

# Real API calls; requires the securely mounted TYPESAFE_API_KEY.
node experiments/jev-context-case-bank/live-run.mjs --probe --repeat 1 --concurrency 1
node experiments/jev-context-case-bank/live-run.mjs --repeat 2 --concurrency 4
```

每次创建独立运行目录，保存请求、响应、代码与输入指纹；不覆盖旧证据。调用前的attempt记录只证明开始尝试，不证明服务端收到了请求；中断后有attempt无响应者结果与费用未知。完整来源／gold仅在评估文件，不进请求。实测报告没有把事后诊断替换为正式分数，也没有端到端收益或真桌结论。

## 隔离已有上下文门的后续实测

[ISOLATED-RESULTS-20260921.md](ISOLATED-RESULTS-20260921.md) 对照单批联合请求、同响应宿主停止、隔离gate后按需选择。只重测11个选择臂各两遍，正式60次API；两阶段来源判断更好，但新增字节没变、延迟增加。报告另外单列零新增API的事后来源下限检查，不把它冒充正式或盲测成绩。

- `isolated-core.mjs` / `isolated-run.mjs`：投影、控制流、真实调用与配对统计。
- `isolated-analysis.mjs`：已有响应离线重算，以及明确标注的事后source-absence floor。
- `isolated-core.test.mjs`：无网络守卫；不代表模型成绩。

```bash
# No API calls.
node --test experiments/jev-context-case-bank/isolated-core.test.mjs
node experiments/jev-context-case-bank/isolated-run.mjs --describe

# Real API calls; frozen source bindings and securely mounted key required.
node experiments/jev-context-case-bank/isolated-run.mjs --repeat 2 --concurrency 4

# Offline only; preserves formal responses and scores.
node experiments/jev-context-case-bank/isolated-analysis.mjs <run-directory>
```
