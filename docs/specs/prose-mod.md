# 文笔 Mod：一个包承担全部文风，基底只留接口

日期：2026-09-25。Status: `ready-for-agent`（W1–W3 并行；W4 由 lead 做；W5 真桌由 lead 持桌）。

用户裁定 2026-09-25：「我就是想要优化文笔，让他写出来的东西不是那种拼装句子一样的东西，也不是看不懂的 ai 味句子，而是表达清晰且有逻辑的句子、段落的文章。如果能消融的消融，能用的你单独摘出来，之后复用……我就是希望能用一个文笔 mod 来实现这样的功能（没有 mod 的时候保持一个干净整洁，只有足以供各类 mod 使用的接口）。」实现 worker 用 opus；其余决定交给 lead。

基线 `0.9.5a@95df22a6d`。集成分支 `claude/prose-mod-20260925`，worktree `/Users/haoli/leehow/code/chatrpgv4-wt-prose-mod`。契约先行：每个切片的契约改动写进 `docs/kernel-rpc.md`，节号只增不改。

## 1. 问题

09-24 合入的三个 commit（`1db633d52`、`27cdf9974`、`95df22a6d`）把文风做成了一套选卡机器，量出来是零收益，还带进两个退步：

- **零收益。** 48 张英文方法卡、每回合一次 Jev 分类选一张注入。它自己的对照（`.coc/evaluations/craft-reference-20260924/`：B/A 3:2:1、C/B 2:2:2、真实 Jev 的 D 组 2:2:2）与合入后的真桌（`luna-prose-quality-zhhans2`，20 回合里 19 回合参考进了真实出站请求，读者仍列出同样的缺陷）都是平手；`prose-quality-followup/closeout` 自记「目标未达成」。每回合 240–520 ms 挂在 compose 步的投影路径上。
- **退步一：口吻面具没了。** `kernel-ts/voice/jobs.ts:73` 的门只认 `npc-voice` 锁 enabled；统一后它默认关，没人接手。新战役 20 回合 `voices: []`，两个包的 dossier 都空。09-16 做出的「去名字认人 41/41」那层能力被静默删掉。
- **退步二：beat 差异化没了。** `content/craft/beat-directives.json` 从 11 条具体祈使句压成 4 条抽象许可句，11 个 beat 全部同一组；Director 的 beat 对文风不再有任何影响。
- **最难看的缺陷：回执式复述。** 「你把去处说死了：第二天去罗克斯伯里疗养院……」「你把要去的地方说清楚了：……」（`.coc/playtests/unified-expression-cont-20260925`）。uptake 在三个产出方（keeper.md、floor 行、宿主 steer）都写成「让世界收到玩家的话」，模型执行成「先复述玩家的话」。
- **形状错了。** 35KB 的英文律法加每回合五份 brief 约 5.5KB，文风部分不到 5%，而且全是「允许/不必/可选」。同一个 deepseek-v4.1-flash/low，在被告知「你仍然是在扮演这些人的守秘人，新措辞不等于新事实」后写出了像样的中文场景（`original-b-e2e-20260925` 地窖段，**零参考**）。上限不是模型，是提示的形状与比例。

文风行为今天散在八处：keeper.md 第 26 段（四义务）、第 30 段（开场配额）、第 19 段（上下文不是文样）、`content/craft` 的行、`mods/narration-craft`、npc-voice 车道、宿主 `FLOOR_STEER`、narration-audit 的 intelligibility 规则。

## 2. 裁定

1. **一个文笔 mod。** id 保留 `narration-craft`，发布 2.0.0。它拥有全部「怎么写」：主指令与 brief、按 beat 的文风表、回合地板、NPC 口吻（含生成车道的启用）、`coarse_language`、`density_guide`。旧版本字节按 §26 冻结不动。
2. **基底只留机器必须精确的东西加接口。** 四条法则、七个动词、marker 与 say 记号、第二人称、正文不带系统事实、不出菜单、玩家自主权（不替调查员想、说、做）、澄清免费。接口：`contributes.instructions`/`brief`（§30.7）、`contributes.vocabulary`（§28.7）、`voices` 段与 `npc.voice.generation.v2`、新的 `contributes.style`（§3）。**无 mod 时**：`style` 只有 `language` 与 `register`；`voices` 为空；无地板行；宿主 steer 机制不变，其文案不含文风指导；narration-audit 的可读性门不变（它是可读性不是文风）。
3. **消融。** Jev 选卡整条：代码、两个 capability、`mods.craft.read`、遥测 `lane: craft`、契约 §30.7b–d 标记退役、测试。`content/craft/beat-directives.json` 删除；text-graph 的 `craft-directive`、`style-axis`、`review-rule` 节点与其 `advises` 关系删除（`play-register` 留作 register 校验，`segment-type` 留作本体引用）。
4. **摘出复用。** 口吻车道 owner 动态解析，任何声明 `npc.voice.generation.v2` 的包都能启用它；`contributes.style` 让任何包按 beat 贡献文风行。48 张卡与来源研究归档到 `docs/archive/`，不进运行时。
5. **本轮不做。** 玩家语言的整段示范（受 §16.1 与 2026-09-09 的 i18n 裁定约束，另开 spec）；narrate 步的模型路由；keeper-pacing 与地板重复的 handoff 句（follow-up）。

## 3. 接口 `context.style.v1`（W3）

### 3.1 贡献形状

`mod.json`：`requires` 含 `"context.style.v1"`；`contributes.style` 是包内 JSON 文件路径，须在 `package_files` 里。贡献而不声明能力，或声明能力而不贡献，都 `invalid`（与 §28.7 词表同规则）。

`style.json`：

```json
{
  "schema_version": 1,
  "axes": ["<line>", "..."],
  "directives": {"<id>": {"full": "<line>", "brief": "<line>"}},
  "beats": {"<BEAT>": ["<id>", "..."]},
  "floor": ["<line>", "..."]
}
```

- `axes` 0–6 行；`floor` 0–4 行；每行非空字符串，≤ 240 字节。
- `directives` 的 id 匹配 `^[a-z][a-z0-9-]{0,63}$`，`full` 与 `brief` 都必填。
- `beats` 必须恰好覆盖 Director 图的每个 beat（`DirectorGraph.load(context).beats`），每个 beat 最多 4 个 id，id 必须存在于 `directives`。
- 行是英文，与所有包指令一样（§16.1）；内核不检测语言。

**校验在目录加载时（`mods.list` / catalog），不在回合里。** 除形状外，内核用胶囊自己的序列化算两个投影的大小：每个 beat 的 brief 形态 ≤ 1536 字节，全量形态（所有 id 的 `full` 行）≤ 2048 字节；超出即拒绝该包版本，报错点名 beat 与超出的字节数。这样 `truncated` 永远不会含 `style`（2026-09-15 的静默截断不再可能）。

**同一时刻只能有一个启用的 style 提供者。** `mods.configure` 启用第二个时 `invalid_params`，消息点名已有的那个；目录里两个默认开启的提供者，目录本身 `invalid`。

### 3.2 投影

`capsule.style` = `{language, register}` ∪（有提供者 ? `{axes, directives: [{id, line}], floor}` : `{}`）。一个进程的第一回合送全部 id 的 `full` 行（今天的 `styleFull`），之后送该 beat 的 id 与 `brief` 行；预算常量不变（`SLICE3_BUDGETS.style` 1536，全量 2048）。

`TextGraph.style()` 只剩 language 与 register；`TextGraph.load` 不再读 `beat-directives.json`；text-graph 的 craft 节点与关系删除，`text-graph-manifest.json` 的计数跟着改。`kernel-ts/read/content.ts` 里 `axisLines`、`directiveLines`、`briefDirectiveLines`、`floorLines`、`beats` 的读取删除。

### 3.3 过渡

W3 发布 `narration-craft` 1.9.0：只是把今天 `beat-directives.json` 的六轴、四指令（full 与 brief）、四地板行**逐字**搬进 `style.json`，`requires` 加 `context.style.v1`，`contributes.style`，`package_files` 加它。于是 W3 结束时模型看到的 `style` 与今天逐字节相同，默认行为不变；改写正文是 W4 的事。

### 3.4 测试

- `tests/kernel/test_capsule_nine.py`：style 用例重写为四条：默认提供者第一回合全 id、之后按 beat；`mods.configure` 关掉提供者后 `style` 只剩两个字段且 `truncated` 无 `style`；夹具包 brief 超 1536 在目录加载时被拒并点名 beat；两个提供者被拒。
- `tests/kernel/test_turn_floor.py`：地板行改从提供者读；加「无提供者则无 floor」。
- `tests/kernel/test_capsule_module.py` 与任何读 `beat-directives.json` 的用例改到新接口。
- `tests/extension/craft-style-coherence.test.mjs` 删除；`keeper-prose-contract.test.mjs` 改到接口。
- 夹具包放 `tests/fixtures/`（复制最小包再改），不改 `mods/` 下别的包。

### 3.5 契约

新节 `## 137. context.style.v1 ...`（编号取当时最后一节加一），写清形状、校验时机、投影、单提供者规则；§13.6 与 §34 各追加一段日期标注的指向。

## 4. 口吻车道 owner 动态解析（W2）

**规则。** 车道 owner = 启用中的、声明 `npc.voice.generation.v2` 的包；统一包（`isUnifiedExpression`）优先，其次旧 `npc-voice` 锁；两个都关则 `voice.job` 无任务（不是错误）。写回的记录盖 owner 的 `mod:`；`isVoicePresentationField` 接受任一 owner；命名空间、generation digest、`established` 判断、job 文件路径都跟 owner 走。旧 npc-voice 锁的行为逐字节不变（路径、digest、错误文案）。统一包的 job 路径用 owner id 前缀，不与旧路径混用。

`jobs.ts` 的函数只收 `world`；owner 的「是否声明生成能力」由 W2 决定怎么带进来（在 `lock()` 时盖到锁上，或在 `voice/index.ts` 解析目录后传入），约束是：车道扩展 `extensions/npc-voice/index.ts` 不改；`content/setup/npc-voice.md` 仍是车道指令，位置不动。

**交接。** 显式升级时 `handoverVoiceState` 已把旧 v2 卡拷进统一包 dossier；owner 切到统一包后 `established` 读统一包命名空间，这些人不重生成。

**测试。** `tests/kernel/test_voice.py` 按 owner 参数化，旧 owner 的既有断言原样通过；新增：夹具统一包（复制 `mods/narration-craft`，`requires` 加 `npc.voice.generation.v2`，版本改成夹具版本）启用的新战役，第一次 commit 后 `voice.job` 发出任务包，`voice.submit` 写进统一包 dossier 并出现在 `voices` 段；旧 v2 卡交接后不重生成。`tests/extension/unified-voice.test.mjs:337` 那条「not enabled」断言改成「无 owner 则无任务」。真包的 `requires` 由 W4 加。

**契约。** §40.7 追加日期标注段落写 owner 规则；§30.7e 追加一句：「统一路径不启动新车道」的说法由 2026-09-25 用户裁定推翻。

## 5. Jev 选卡退役（W1）

**保留为惰性名**：两个 capability 名与 `contributes.craft_reference` 键在 `kernel-ts/read/mods.ts` 里继续被接受、不起作用，否则冻结在 1.5.0–1.7.1 的旧战役打不开也升不了（W1 实测；契约 §30.7f）。

**删除**：`runtime/craft/`、`runtime/jev/craft-reference-domain.ts`、`extensions/table/craft-reference.ts`、`extensions/table/craft-runtime.ts`、`kernel-ts/mods/craft-package.ts`、`kernel-ts/mods/craft-reference.ts`；`kernel-ts/read/mods.ts` 的两个 capability、`validateCraftContribution`、`contributes` 白名单里的 `craft_reference`、`keys.push` 里的它；`kernel-ts/read/context.ts` 与 `kernel-ts/handlers.ts` 的 `mods.craft.read`；胶囊 `mods.craft_reference` 字段；`extensions/table/context-runtime.ts` 里全部 craft 钩子（`CraftReferenceRuntime`、`coc:run-craft`、`craftEpoch`、`craft.project`、`pendingProvider.craft`、`observedCraftEnabled`、`craft_settled`；**保留** `briefingKey`，它修的是 provider 变更后 brief 复用的问题）；`runtime/jev/hybrid-engine.ts` 的 `prepareRunCraft`、`craftInput`、`craftAttempted`、announce 里的 `craft: 'run'`；`kernel-ts/mods/index.ts` 的导出。

**包**：发布 `narration-craft` 1.8.0：删 `cards.en.json`、`starter-ids.json`、`craft-reference.json`，`contributes.craft_reference`、`settings.reference_mode` 与其 schema、`requires` 里的 `context.craft-reference.v2`；`agent.md`/`brief.md` 正文不动（W4 重写）；CHANGELOG 记一条。

**归档**：`docs/archive/craft-reference-cards-v2/` 放 `cards.en.json`、`starter-ids.json` 与一页 README（为什么退役、证据目录在哪、卡片结构可复用于将来的示范设计）。

**测试**：删 `tests/extension/craft-reference-*.test.mjs` 与 `craft-reference-test-kit.mjs`；`jev-pacing-mod-alignment`、`mod-package-boundary`、`unified-voice`、`context-policy`、`mods-panel-status` 里引用 craft 的断言改掉；`tests/kernel` 里引用 `mods.craft.read`、`craft_reference`、包文件清单的用例改掉；`craft-mod-guidance.test.mjs` 不动（W4 处理）。

**契约与 spec**：§30.7 下追加 `### 30.7f 退役（2026-09-25）`，写明 b–d 三节的机制已删除、原因与证据；`docs/specs/craft-reference-mod.md` 与 `unified-expression-mod.md` 的 Status 行改为指向本 spec。

## 6. 基底瘦身与 2.0.0（W4，lead）

**keeper.md 搬走的段落**（按 `95df22a6d` 的段落）：

| 段 | 首句 | 去向 |
|---|---|---|
| 19 | `The capsule, memory, recent history ... never prose samples` | 「上下文是事实不是文样、不抄字段句」进 mod；「不把工具结果、枚举、字段名念给玩家」是沉浸法则，留在第 25 段 |
| 26 | `The turn the player gets puts the spotlight back` | 四义务与停点进 mod；「不替调查员想、说、做」「不出菜单」「澄清免费」留基底 |
| 30 | `Opening the table` | 流程（look、接建卡、narrate）留；「orientation before atmosphere、一句房间一个手势」进 mod |
| 31 | `... when the same point comes back, they move -- give a little, refuse harder, or change the subject` | 这一句删；立场一致性进 mod |
| 20 | `**style** is this table's language, register, and a craft reminder for this beat` | 改为「以及启用的包贡献的文风行」 |

**2.0.0 的内容**（lead 亲自写，用 09-15 验证过有效的写法：短、正向、祈使、按 beat 分行；完整口语句、长短交替、每个人都想要点什么；不写「允许/不必/可选」）：

- `agent.md`：一页。段落主题固定：这一回合写什么（回应而非复述；从世界的回答开始）；句子与段落（完整关系、长短交替、一段一个焦点、不拼装字段句、不抽象悬念套式）；在场的人怎么说话（面具与三组问答的用法、立场一致、位置不因换词而动）；场景与细节（按 beat 的重心）；开场；停点；粗话与密度设置。
- `brief.md` ≤ 1000 字节（§30.7 全部 brief 合计 ≤ 5000）。
- `style.json`：六轴改成祈使句；指令按 beat 真正分组（REVEAL/PRESSURE/CHOICE/SUBSYSTEM/CHARACTER/RECOVER/CUT/ADVANCE/MONTAGE/DEEPEN/PAYOFF 各自的重心）；四条地板行，uptake 改成「世界回答，不复述」。
- `mod.json`：`requires` 含 `context.style.v1`、`npc.voice.generation.v2`、`npc.voice.consolidation.v1`、词表两键、`context.npc.v1`、`mods.package-files.v1`；`conflicts: ["npc-voice"]`；`settings` 只剩 `coarse_language`、`density_guide`。

**测试**：`test_mod_order`、`test_mod_vocabulary`、`test_mod_director_text`（5000 上限）、`craft-mod-guidance.test.mjs` 改到 2.0.0；新增「关掉 narration-craft 后基底干净」用例：`style` 两字段、`voices` 空、brief 里没有文风包。

## 7. 验收（W5，lead 持桌）

- **真产品路径。** `tests/play/driver.py start --model opencode-go/deepseek-v4.1-flash`，thinking low，新战役、the-haunting、pregen、`--play-language zh`。lead 当玩家一句一回，不用脚本，不用 `kp_settle_turn`。
- **A/B 两桌，同一串 15 句玩家输入。** A：基底 `95df22a6d`；B：集成分支。可以并发（工作区、战役、run id 不重叠）。
- **预注册六类缺陷，开桌前写死**：回执式复述（复述玩家的话或已结算物件）；规则复读（NPC 重复权限/边界句）；全称重复（同一物件全称三次以上）；抽象悬念套式（「安静并没有让那里显得空无一物」一类）；NPC 任务提示腔（把去处当菜单报）；硬译搭配与关系不清的句子。
- **盲读**：sonnet 读者，去标签打散，按六类计数并写整体偏好，允许平手；lead 自己再通读一遍原文。结论只说「B 在哪几类少了、哪几类没变」，不说「文笔达标」。
- **口吻**：B 桌见过三个人以后 `voices` 非空；`tests/play/voice_lineup.py build/judge` 去名认人。
- **机械**：`style` 无截断；brief 合计 ≤ 5000；关掉 mod 后一桌两回合验证基底干净。
- 证据留在 `.coc/playtests/prose-mod-*/`，不删。

## 8. 切片与依赖

```
W1 jev-craft-retire ─┐
W2 voice-owner ──────┼→ lead 集成（合并、mod.json 手合、全套件在 leehow-pc 跑）→ W4 2.0.0 + keeper.md 瘦身 → 套件 → W5 真桌
W3 style-contract ───┘
```

W1/W2/W3 各自从 `claude/prose-mod-20260925` 开 worktree 与分支 `claude/prose-mod-w<N>-20260925`，只跑定向测试（自己改的文件），全套件由 lead 在 leehow-pc 跑。分票见 [prose-mod-tickets.md](prose-mod-tickets.md)。
