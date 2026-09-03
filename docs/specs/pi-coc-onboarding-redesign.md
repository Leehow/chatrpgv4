# 开局引导重新设计：独立会话 + 单一所有者

状态：**设计草案，未实现**。2026-09-02 夜。

## 1. 为什么不是继续修

今晚在引导路径上连撞六个卡点，每一个的形状完全相同：**宿主要求 KP 做一件它
没有提供的事**。

| 现象 | 根因 |
|---|---|
| `campaign.create` 被拒 13 次，KP 退回内置 starter 并告诉玩家「你要的模组已就位」 | 类型化表面上包装器把 campaign id 镜像进外层选择器，而闸门要求它缺席 |
| 卡片列出的 `allowed_actions` 全部被拒 | 准入只认 `route.next_operation`，该阶段是 `null`；`allowed_actions` 没有任何消费者 |
| 「派协调器」 | 工具表里没有 `subagent` |
| 「调 coc_capabilities 取任务」 | 工具表里没有 `coc_capabilities` |
| 「派 coc-opening-source-coordinator」 | 该 agent 没被镜像到任何发现路径（该步已整体退休） |
| 协调器渲染完 180 页后 401 | 一个链条别处都不用的 provider，默认值散在 4 处 |

这些不是六个 bug，是一个结构问题的六次显形：**没有任何单一组件拥有「开局引导」
这件事**，于是每个经过的人都在自己那层加一句补丁。

### 量出来的体量

- 引导阶段（`cold_start` / `opening`）可达 **53 个操作**；真正需要的约 10 个。
- 开场 phase **15 个**，判定散在 `opening-setup-machine.ts`（4742 行）与宿主
  扩展的闸门之间。
- 同一个模型默认值出现在 **4 处**：启动器 export、适配器常量、子进程环境白名
  单、以及一个被校验却从不消费的 `model_policy`。改前三处中的任意一处都不
  生效——这是「无人拥有」最直接的证据。
- 引导路径有 **2 条**：`pi-coc` 一条，`web/server-node/server.mjs`
  （L741 `campaign.quick_start`、L853 `scenario.bind_pdf`）自己又走一条。

## 2. 引导实际要做的事

按今晚真实跑通的顺序，只有七步：

1. 玩家选模组（PDF 路径，或内置 starter）
2. PDF → source bundle
3. 建战役
4. 绑定 bundle
5. 建调查员
6. 完成设置 → 交接给游玩

其中 **3、4、6 是确定性写入**（已有契约化操作）；**2 是外部工具**；**1 是一次
选择**；只有 **5** 需要 LLM。

> 2026-09-03 更正：本文初稿在 4 与 5 之间还有一步「源审阅：视觉复核 + 建立
> era/place/fast facts」。那一步已随开场快速事实整条路退休——读原文是
> ModuleGraph 的职责（单脊柱规格 §4.2），引导不读模组，也不派子代理。

也就是说：引导的绝大部分不需要一个自由发挥的 KP，而现在它整个跑在 KP 的会话
形状里。

## 3. 设计

### D1 — 引导是**独立会话**，不是 KP 的一个阶段

一个专用 pi 扩展 + 专用启动入口拥有第 1–7 步。它跑完之后，产出物是一个
`status: ready_for_table` 且带 `setup_handoff` 回执的战役目录，然后**退出**。

KP 会话另起，只会 resume 一个已完成的战役。

**由此可以删掉的东西**（这是这个设计的主要收益）：

- KP 侧 `cold_start` / `opening` 两个 phase 及其全部分支
- `opening-setup-machine.ts` 的 15 个 phase 与硬闸门
- `host-system-setup.md`（464 行）与 `session-roles.json` 的 setup 半边
- 启动器里的角色判定与角色包组装
- 引导期特有的工具表分支（`resolvedWorkingSetHostTools` 的 setup 分支等）

KP 会话不再有「桌子还没开」这个状态，它唯一的入口是 `session.resume` 一个
ready 的战役。**今晚六个卡点里有五个在这个设计下不可能存在**——它们全部来自
引导与游玩共用一套阶段机与工具面。

### D2 — 一个事实一个所有者

引导扩展持有一份**声明式步骤表**，每一步是 `(前置条件, 动作, 回执判据)`：

```
steps:
  - id: choose-source        needs: []                     asks-player: true
  - id: build-bundle         needs: [choose-source]        external: coc-pdf-pipeline
  - id: create-campaign      needs: [choose-source]        op: campaign.create
  - id: bind-source          needs: [build-bundle, create-campaign]  op: scenario.bind_pdf
  - id: briefing             needs: [bind-source]          op: campaign.render_briefing
  - id: create-investigator  needs: [briefing]             op: setup.chargen_run
  - id: complete             needs: [create-investigator]  op: setup.complete
```

**拒绝消息、下一步指示、可用工具、进度显示全部从这张表派生**，不再各写一份。
今晚那四处模型默认值、以及「卡片说 A、闸门认 B」的两处，在这个结构下无法表达。

模型选择同理：**一处**，扩展配置里，子进程一律继承，除非显式指定。

### D3 — 隔离的具体含义

| | 引导会话 | KP 会话 |
|---|---|---|
| 进程 | 独立 pi 进程 | 独立 pi 进程 |
| 系统提示 | 引导专用（短） | 只讲游玩 |
| 工具面 | 约 10 个操作 + subagent | 无 setup 操作 |
| 阶段机 | 上面那张步骤表 | 无 opening/cold_start |
| 模型 | 可与 KP 不同（引导可用便宜模型） | 玩家选的 KP 模型 |
| 交接 | 写出 ready_for_table + handoff 回执 | 只读它 |

**唯一的耦合面是战役目录的 `ready_for_table` 契约**——它今天就已经存在，是这
套东西里唯一值得保留的部分。

### D4 — web/Electron 走同一条

`web/server-node/server.mjs` 目前自己调 `campaign.quick_start` 与
`scenario.bind_pdf`。重新设计后它调引导扩展的同一入口，**不再有第二条路径**。
否则这次重做只是造第三条。

## 4. 分期

- **Stage 1**：写步骤表 + 扩展骨架，用它跑通「内置 starter → ready_for_table」。
  不动现有路径，两条并存，用同一个验收（新战役、零手工干预）对比。
- **Stage 2**：接 PDF 路径（第 2、4、5 步），跑通《他们也没想太多》。
- **Stage 3**：web 入口切过来。
- **Stage 4**：删除 D1 列出的旧物。删除是本设计的**交付物**，不是尾巴——不删
  就是造了第三条路径。前置条件见 §5：建卡方法必须已经在新实现里跑通，删除才
  能开始。

每一 Stage 的验收都是**真玩测**：新战役、零环境覆盖、零手工干预，跑到 KP 能
接第一个玩家回合。今晚的经验是这类缺陷对 8000+ 单元测试不可见。

## 5. 已定的三件事（2026-09-02）

1. **引导会话用与主 agent 相同的模型。** 不为省钱引入第二个模型配置——
   **架构简单优先于高效**。今晚的教训正是一个「为了合适」引入的第二 provider
   把整条链炸掉，且它的默认值散在四处。一个模型，一处配置。
2. **建卡留在引导。** 交接边界保持干净：引导交出的是一个可直接开打的战役。
3. **旧路径直接删，不留回退期。** 但删之前必须先把下面这件东西取出来。

### 删除前的前置条件：先保住沉浸式建卡

旧引导里唯一值得原样带走的是**建卡手感**，它已抽成实现无关的方法文档：
[docs/methods/immersive-character-creation.md](../methods/immersive-character-creation.md)。

新实现照那份文档做，**不要照旧代码做**。要点：一条完成路径三种收尾、第一个问
题只问姓名+职业、绝不向玩家问数值、模组感知的建议用守秘人口吻而非表单、卷入方
式必须挂在本模组的具体开场上、以及命名工艺（含「不要因为桌面语言是中文就默认
中国名」的自查，禁止名字池／随机池代码／关键词判定）。

与写入契约的分界：`setup.chargen_run` / `coc_chargen_delegate` 的字段清单、年
龄骰回执包、`input_mode` 取值属于**确定性写入契约**，不随引导重写而改变，也不
在方法文档范围内。新引导仍然调用同一个写入操作。

## 6. 与既有 spec 的关系

- [pi-coc-module-source-pipeline-unification.md](pi-coc-module-source-pipeline-unification.md)
  的 **Stage G**（开场源审阅通路收回 L0）与本设计的第 5 步同一件事的两侧：
  Stage G 让语义抽取回到 L2，本设计让**谁来调它**有一个所有者。两者可以独立
  推进，但先做 Stage G 会让本设计的第 5 步变成一次纯粹的 subagent 派发。
