# 开局引导实现规格（一次实现）

状态：**待实现**。2026-09-02 定。设计依据见
[pi-coc-onboarding-redesign.md](pi-coc-onboarding-redesign.md)（问题分析与三项
决定），建卡手感见
[immersive-character-creation.md](../methods/immersive-character-creation.md)。

本文件是**可照着建的实现规格**：组件、契约、步骤表、错误语义、删除清单、验收。
不分期，一次做完再切换。

---

## 0. 一句话

引导是一个**独立 pi 会话**，由一个仓库自有扩展驱动一张**声明式步骤表**，跑完
写出 `status: ready_for_table` + `setup_handoff` 的战役目录后退出；KP 会话只
resume 已完成的战役，**不再拥有任何 setup 阶段**。

## 1. 组件

| 新增 | 路径 | 职责 |
|---|---|---|
| 引导扩展 | `plugins/coc-keeper/pi/extensions/onboarding/index.ts` | 步骤表求值、工具面、指示与拒绝文本 |
| 步骤表 | `plugins/coc-keeper/pi/extensions/onboarding/steps.ts` | 唯一事实源（见 §3） |
| 入口 | `plugins/coc-keeper/pi/bin/pi-coc-setup` | 独立启动器 |

**不新增**任何 canonical 操作。引导只调用既有的确定性写入（§2）。

模型：**与主 agent 同一个**。启动器接受 `--model` / `--thinking` 并原样传给
pi，扩展内部不再有任何模型常量、env 默认或 provider 分支。这条是硬约束——
今晚炸链的 deepseek 默认值曾散在四处。

## 2. 引导调用的既有操作（契约取自 mcp-operation-contracts.json）

```
setup.invoke  { kind, payload, [campaign], [root] }
  kind ∈ campaign.create | scenario.bind_pdf | campaign.link_investigator
       | campaign.render_briefing
setup.quick_start            required: scenario_id
                             props: campaign_id, pregen_id, title, decision_id
setup.adopt_source_facts     required: campaign_id, facts
setup.investigator_contract  required: campaign_id
setup.chargen_run            required: campaign_id, investigator_id, name,
                                       occupation_name
                             optional: age, assignment_priority, backstory,
                                       equipment, interest_skill_names,
                                       key_connection, luck, occupation_label,
                                       occupation_skill_names, own_language
setup.complete               required: campaign_id, decision_id
```

**`campaign.create` 与 `setup.quick_start` 是 pre-campaign**：调用时该战役尚不
存在，因此传输层的 campaign 选择器必须缺席（沿用既有
`isPreCampaignFreshCreation`）。

## 3. 步骤表：唯一事实源

```ts
type Step = {
  id: string;
  needs: readonly string[];          // 前置步骤 id
  done: (s: OnboardingState) => boolean;   // 回执判据，读战役目录，不读内存
  run:  { kind: "ask_player" }             // 由 KP 与玩家对话
      | { kind: "operation"; op: string; args: (s) => object }
      | { kind: "subagent"; agent: string; task: (s) => string }
      | { kind: "external"; hint: string };  // 人/CLI 做，引导只等
  tools: readonly string[];          // 该步允许的工具
  say:  (s: OnboardingState) => string;    // 玩家可见的下一步说明
};
```

**从这张表派生、不得另写一份的东西**：

- 当前允许的工具集（`pi.setActiveTools`）
- 任何拒绝消息（「现在该做 X，因为 Y 还没完成」）
- 进度显示
- 玩家可见的下一步提示

> 今晚失败的六个卡点里，五个是「卡片说 A、闸门认 B」或「让 KP 调一个它没有的
> 工具」。在这个结构里两者都表达不出来：工具面与说辞同源。

### 3.1 步骤

已实现于 `plugins/coc-keeper/pi/extensions/onboarding/steps.ts`。下表是那张表
的现状，不是它的另一份来源——**表变了就改这里，不要让两份并存**。

| id | needs | action | done 判据（读磁盘） |
|---|---|---|---|
| `choose-source` | — | ask_player | 玩家给出 starter id 或 bundle 路径 |
| `build-bundle` | choose-source | external `coc-pdf-pipeline` | bundle 目录存在于工作区 |
| `create-campaign` | choose-source | operation（starter 走 `setup.quick_start`，否则 `campaign.create`） | `campaign.json` 存在 |
| `bind-source` | build-bundle, create-campaign | operation `scenario.bind_pdf` | `scenario/scenario.json` 存在 |
| `briefing` | bind-source | operation `campaign.render_briefing` | `character_creation.briefing_path` 存在 |
| `create-investigator` | briefing | operation `setup.chargen_run`（随步注入方法文档） | `party.json` 含调查员 |
| `complete` | create-investigator | operation `setup.complete` | `status == ready_for_table` 且有 `setup_handoff` |

`starter` 分支跳过 build/bind 两行。

**bind 与 briefing 之间没有任何读原文的步骤，这是刻意的。** 读模组是
ModuleGraph 编译器的职责；步骤表的单元测试断言没有任何一步携带
`adopt_source_facts` / `subagent` / `capabilities` 类工具，也没有 `subagent`
动作，防止那份工作悄悄长回引导里。

写实现时相对本节初稿改掉的四处，每一处都是初稿里藏着的缺陷：

- **`source-review` 整行删掉。** 初稿把它抄自旧 opening 机器。它读 3 页答 6 个
  字段，而单脊柱规格 §4.2 里读原文是 ModuleGraph 的职责——这一步与图谱脊柱是
  互斥的，不是它的前置。（曾经短暂地把「复核+采纳」合成一行来解一个死锁：拆开
  时两行读同一个磁盘事实，复核行永远不 `done` 而采纳工具永远不在面上。整行删掉
  之后这个问题连同它一起消失。）
- **`link` 行删掉。** `setup.chargen_run` 是 create + link + render_card 一把
  锁做完，所以那一行在正常路径上永远不会成为当前步。
- **`create-investigator` 调 `setup.chargen_run`。** 初稿写的
  `coc_chargen_delegate` 是宿主扩展的 setup-role 工具，引导不加载宿主，够不着。
- **方法文档随步投送，不给路径。** 引导会话没有 `read` 工具，所以「照
  `docs/methods/...` 做」指向一份它打不开的文件——与「指令点名一个面上没有的
  工具」是同一个缺陷。

另有一条 `readyForTable` 短路：交接回执压过所有上游回执。`setup.complete` 本身
拒绝不完整的战役，所以它的回执就是上游全做过的证据——否则老路径建的战役会被要求
回去补渲染一份简报，给一张已经在玩的桌子。

### 3.2 建卡步骤照方法文档做

`create-investigator` 的对话行为**完整照**
[immersive-character-creation.md](../methods/immersive-character-creation.md)：
一条完成路径三种收尾、第一个问题只问姓名+职业、绝不问数值、模组感知建议用守秘
人口吻、卷入方式挂本模组开场、命名工艺与自查。

该步的系统提示**直接内联那份方法文档**，不要复述——复述就是第二个副本。

## 4. 隔离

| | 引导会话 | KP 会话 |
|---|---|---|
| 进程 | `pi-coc-setup` | `pi-coc` |
| 工具面 | 每步 ≤6 个（见步骤表） | 无任何 setup 操作 |
| 阶段机 | 步骤表 | 无 opening / cold_start |
| 系统提示 | 引导专用 | 只讲游玩 |
| 交接 | 写 `ready_for_table` + `setup_handoff` | 只读 |

`setup_handoff` 既有形状（实测）：

```
schema_version, campaign_id, decision_id, completed_at,
investigator_ids, opening_projection_ref, lane_interrupted_at_handoff
```

**这是两个会话之间唯一的耦合面。** 引导不向 KP 传递任何进程内状态。

## 5. 失败语义

三类，各自的处置**必须不同**——今晚的教训是把它们混成一类会锁死桌子：

1. **玩家还没给** → 问一次，只问缺的那条。
2. **外部产出者失败**（bundle 构建）→ 记录回执，**说清是哪个子进程、什么模型、
   什么错**，允许重试同一步；不推进，也不改写已完成步骤。（源审阅子代理已随
   开场快速事实一起退休，见 §6。）
3. **确定性写入被拒** → 这是契约违反，把操作返回的可行动信息**原样**转给 KP，
   不降级成通用错误。

任何步骤都**不得**在失败时静默退回另一条路径（今晚 KP 退回内置 starter 并告
诉玩家「你要的模组已就位」，战役里装的是别的模组）。玩家可见文本必须与
`campaign.json.title` 一致。

## 6. 删除清单

### 已删除（2026-09-03）

- `plugins/coc-keeper/pi/prompts/host-system-setup.md`（464 行）。它携带的
  不变量各自有了归属：宪法块改为「有且只有一份载体」；游玩专属指引「不许出现在
  setup 提示词」改为「不许出现在引导提示词」；system-instruction 协议只归宿主
  提示词。**引导提示词不带宪法块**，这一条现在是断言——那 23656 字符讲的是游玩
  工具面，引导会话一样都没有。
- `plugins/coc-keeper/pi/lib/opening-setup-machine.ts` 4742 行 → 125 行惰性壳
  （方法惰性化、状态面保留成空容器，`trackOpeningDispatch` 是活机制搬回）

- **开场六项快速事实整条路**：引导步骤表里的 `source-review`、
  `setup.adopt_source_facts` / `coc_capabilities` / subagent 派工的工具面、
  引导会话加载的 subagent 包。理由不是「引导不需要它」，而是**它本身与图谱脊柱
  冲突**：它读 3 页答 6 个字段，而单脊柱规格 §4.2 的正向路径里，读原文是
  ModuleGraph 的职责，七份 IR 是它的确定性投影。这一步是我照旧 opening 机器
  抄进新表的，不是重写的产物。
- `coc_session_role.py`
- `session-roles.json` 的 `setup` 半边
- 启动器的角色判定与角色包组装；`pi-coc` 现在只开 `ready_for_table` / `active`，
  否则 exit 3 并打印 `pi-coc-setup --campaign <id>`
- exit-42 交接重启循环、`queueSetupHandoffExit`
- 宿主扩展里全部 8 处 `=== "setup"` 判断、`allowExactFreshSetup`、
  `exactStartupFresh*` 四个谓词、`startupResumeGate` 的 `fresh_setup` 相位
- **入口封死**：`sessionRoleFromEnv` 拒绝 `setup` 并告警，`effectiveTypedRole`
  默认改为 `play` —— setup 角色在运行时不可能再出现
- `web/server-node/session-handoff.mjs` 里 shell 调那个 CLI → 改为直接读
  `campaign.json`

### 未删除（下一批）

- `plugins/coc-keeper/pi/lib/opening-setup-machine.ts`（4742 行 / 93 方法）。
  宿主里只有 32 个方法被引用、共 51 处调用；**另外 61 个方法零消费者**。
  setup 角色已不可达，所以这 51 处大部分是确定的死代码。
- ~~操作策略里 `cold_start` / `opening` 两个 phase~~ —— **这条写错了，不删。**
  `opening` 是游玩宿主 resume 之后、`evidence.table_opening` 之前的活阶段（实测
  工作集就是 `play:opening:acting`）；`cold_start` 是「裸跑、无战役」那条路。
  它们解锁的 18 + 50 个操作声明里，setup 那批已经被角色 ACL 挡死，删 phase 要
  改 68 处声明而收益为零。
- `web/server-node/server.mjs` 里自建战役/绑定的两处（L741、L853）→ 改为调用
  引导入口

**不删**：所有 canonical 写入操作、`coc-pdf-skill-adapter`（属 Stage G）、
`coc-character` 技能里的写入契约部分。

## 7. 验收（全部为真玩测）

每条都要求**新战役、零环境变量覆盖、零手工干预**：

1. **starter 路径**：`pi-coc-setup` → `ready_for_table`，KP 会话 resume 后接住
   第一个玩家回合。
2. **PDF 路径**：《他们也没想太多》从 bundle 到 `ready_for_table`，且
   `campaign.json.era == "roman"`、`place` 为源材料值、两者 `status == "source"`
   （今晚已验证这条链本身可通）。
3. **建卡手感**：空收尾（「其余全由你定」）一回合出完整草稿且不追问；部分收尾
   最多问 3 个、一次一个；全程零数值提问。
4. **隔离**：KP 会话的工具表**不含任何 setup 操作**；引导进程退出后战役仍可玩。
5. **单一路径**：web 入口与 `pi-coc-setup` 走同一实现，`server.mjs` 不再自建
   战役。
6. **回归**：`tests/test_pi_package.py`、`test_pi_steward_agents.py`、
   `test_subagent_agent_resolution.py` 全绿；已知的 109 个既有失败不增加。

单元测试覆盖步骤表求值（前置、done 判据、工具面派生）与失败三分类；**但验收以
真玩测为准**——今晚六个致命缺陷对 8000+ 单元测试全部不可见。

## 8. 与 Stage G 的关系

[pi-coc-module-source-pipeline-unification.md](pi-coc-module-source-pipeline-unification.md)
的 Stage G 把开场语义抽取收回 L2。做完之后，本规格的 `source-review` 步退化成
一次纯粹的 subagent 派发（不再有适配器内部那次 LLM 读原文）。两者可独立推进；
先做 Stage G 会让本实现更简单，但不构成阻塞。
